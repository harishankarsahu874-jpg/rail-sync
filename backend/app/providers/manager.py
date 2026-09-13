"""Provider orchestration: caching, track snapping, journey assembly.

Network I/O is always cached and always partial-success: a missing or
rejected key becomes a visible provider status + null field, never an HTTP 500
and never a crash. The journey view is assembled server-side so the browser
makes ONE request per refresh.
"""
from __future__ import annotations

import copy
import threading
import time

from .. import config
from .clients import (NominatimClient, OpenMeteoElevationClient, OpenMeteoGeocoder,
                      OpenTopographyClient, OpenWeatherClient, OverpassClient,
                      PhotonGeocoder, RailRadarClient, WikimediaClient, haversine_m)

_HALT_SUFFIXES = (" JN", " JUNCTION", " CENTRAL", " CANTT", " CITY", " ROAD", " STATION")

_BROWSER_PROVIDERS = {
    "maptiler": ("MapTiler", "Vector basemap + rail overlay (browser key)"),
    "geoapify": ("Geoapify", "Reverse geocoding of the live position (browser key)"),
}
_SERVER_PROVIDERS = {
    "railradar": ("RailRadar", "Live train telemetry: position, speed, delay"),
    "openweather": ("OpenWeather", "Current weather → ETA severity"),
    "opentopography": ("OpenTopography", "COP30 point elevation at the live fix"),
    "overpass": ("Overpass OSM", "Mapped rail for track snapping (keyless)"),
    "openmeteo": ("Open-Meteo", "Keyless batch elevation profiles + geocoding fallback"),
    "nominatim": ("Nominatim", "Keyless halt geocoding for stop weather"),
    "photon": ("Photon", "Keyless last-resort halt geocoding"),
    "wikimedia": ("Wikimedia", "Keyless station photos (Commons) + summaries (Wikipedia)"),
}


class ProviderManager:
    def __init__(self):
        self.railradar = RailRadarClient()
        self.weather = OpenWeatherClient()
        self.topography = OpenTopographyClient()
        self.overpass = OverpassClient()
        self.openmeteo = OpenMeteoElevationClient()
        self.nominatim = NominatimClient()
        self.geoom = OpenMeteoGeocoder()
        self.photon = PhotonGeocoder()
        self.wikimedia = WikimediaClient()
        self._lock = threading.RLock()
        self._cache: dict[str, tuple[float, object]] = {}
        self._observed: dict[str, dict] = {}
        self._enrich: dict[str, dict] = {}
        self._enriching: set[str] = set()
        self._status = {}
        for key, (label, purpose) in {**_SERVER_PROVIDERS, **_BROWSER_PROVIDERS}.items():
            configured = self._configured(key)
            self._status[key] = {
                "label": label, "purpose": purpose, "configured": configured,
                "mode": "browser" if key in _BROWSER_PROVIDERS else ("ready" if configured else "fallback"),
                "calls": 0, "last_success": None, "error": None,
            }

    # ------------------------------------------------------------------ status
    def observe(self, number: str, name: str):
        """Remember trains confirmed RUNNING by RailRadar during this boot.

        RailRadar has no fleet-list endpoint and the free sandbox quota forbids
        polling everything, so the 'running now' strip grows opportunistically
        from journeys users actually open. Honest by construction.
        """
        with self._lock:
            self._observed[str(number)] = {"number": str(number), "name": name,
                                           "last_seen": time.time()}

    def observed(self, limit: int = 12) -> list[dict]:
        with self._lock:
            rows = sorted(self._observed.values(), key=lambda r: r["last_seen"], reverse=True)
        out = []
        for row in rows[:limit]:
            item = dict(row)
            live = self._peek(f"live:{item['number']}")
            if isinstance(live, dict):
                loc = live.get("currentLocation") or {}
                coords = loc.get("coordinates") or {}
                lat = coords.get("lat", coords.get("latitude"))
                lng = coords.get("lng", coords.get("lon", coords.get("longitude")))
                nxt = live.get("nextHalt") or {}
                item.update({
                    "lat": lat, "lng": lng,
                    "progress": round(max(0.0, min(1.0, float(loc.get("segmentProgress") or 0.0))), 3),
                    "delay_min": live.get("delayMinutes"),
                    "next_name": str(nxt.get("name") or nxt.get("stationName") or ""),
                    "pos_km": live.get("currentLocation", {}).get("distance"),
                })
            out.append(item)
        return out

    # ------------------------------------------------------- async enrichment
    def enrichment(self, number: str, max_age: float = 240.0) -> dict | None:
        with self._lock:
            row = self._enrich.get(str(number))
        if row and time.time() - row["at"] <= max_age:
            return copy.deepcopy(row)
        return None

    def start_enrichment(self, number: str, halts: list[dict], max_age: float = 240.0) -> None:
        """Fire-and-forget background pass for the SLOW providers.

        The journey endpoint returns instantly with live telemetry + timetable
        + RF ETA; snapping, weather, halt geocoding and elevation profiles land
        a few seconds later and the frontend upgrades itself on its next poll.
        """
        number = str(number)
        with self._lock:
            if number in self._enriching:
                return
            row = self._enrich.get(number)
            if row and time.time() - row["at"] <= max_age:
                return  # fresh enough; gaps refill on the next cycle
            self._enriching.add(number)
        thread = threading.Thread(target=self._enrich_worker, args=(number, halts),
                                  daemon=True, name=f"enrich-{number}")
        thread.start()

    def _enrich_worker(self, number: str, halts: list[dict]) -> None:
        try:
            live = self._peek(f"live:{number}")
            if not isinstance(live, dict):
                return
            position = self.position_for(live)
            weather = self.weather_at(position["lat"], position["lng"]) if position else None
            cop30 = self.cop30_at(position["lat"], position["lng"]) if position else None
            geo: dict[str, dict] = {}
            for halt in halts:  # committed coords first; geocoders fill gaps
                if halt.get("lat") is not None:
                    geo[str(halt["seq"])] = {"lat": halt["lat"], "lng": halt["lng"]}
                    continue
                try:
                    got = self.geocode_halt(halt["name"])
                except Exception:  # noqa: BLE001
                    got = None
                if got:
                    geo[str(halt["seq"])] = got
            halt_wx: dict[str, dict] = {}
            upcoming = [h for h in halts if not h.get("passed")]
            for halt in upcoming[:3]:
                got = geo.get(str(halt["seq"]))
                if got:
                    wx = self.weather_at(got["lat"], got["lng"])
                    if wx:
                        halt_wx[str(halt["seq"])] = wx
            profile = {"points": [], "elevations": []}
            if position and upcoming:
                anchors = [(position["lat"], position["lng"])]
                anchors += [(geo[str(h["seq"])]["lat"], geo[str(h["seq"])]["lng"])
                            for h in upcoming[:3] if str(h["seq"]) in geo]
                if len(anchors) >= 2:
                    points = _densify(anchors, max_points=12)
                    profile = {"points": [{"lat": round(a, 5), "lng": round(b, 5)} for a, b in points],
                               "elevations": self.elevation_profile(points)}
            with self._lock:
                self._enrich[number] = {"at": time.time(), "position": position,
                                        "weather": weather, "cop30": cop30,
                                        "geo": geo, "halt_wx": halt_wx, "profile": profile}
        except Exception:  # noqa: BLE001 - enrichment must never kill the worker
            pass
        finally:
            with self._lock:
                self._enriching.discard(number)

    def position_for(self, live: dict) -> dict | None:
        """Live fix, honestly snapped to mapped OSM rail when inside the guard."""
        loc = live.get("currentLocation") or {}
        coords = loc.get("coordinates") or {}
        lat = coords.get("lat", coords.get("latitude"))
        lng = coords.get("lng", coords.get("lon", coords.get("longitude")))
        try:
            lat, lng = round(float(lat), 6), round(float(lng), 6)
        except (TypeError, ValueError):
            return None
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return None
        if str(live.get("status") or "").lower() != "running":
            return None
        snap = self.snap_to_rail(lat, lng)
        inside = snap is not None
        return {
            "lat": round(snap["lat"], 6) if inside else lat,
            "lng": round(snap["lng"], 6) if inside else lng,
            "snapped": inside,
            "offset_m": snap["offset_m"] if inside else None,
            "source": "osm_track_snap" if inside else "provider_raw",
            "raw_lat": lat, "raw_lng": lng,
            "track": snap["track"] if inside else None,
        }

    def _peek(self, key: str):
        with self._lock:
            hit = self._cache.get(key)
        return copy.deepcopy(hit[1]) if hit else None

    def _configured(self, key: str) -> bool:
        return {
            "railradar": self.railradar.configured,
            "openweather": self.weather.configured,
            "opentopography": self.topography.configured,
            "overpass": True, "openmeteo": True, "nominatim": True, "photon": True,
            "wikimedia": True,
            "maptiler": True, "geoapify": True,  # browser keys ship in the bundle
        }[key]

    def public_status(self) -> dict:
        with self._lock:
            items = copy.deepcopy(self._status)
        live = [k for k, v in items.items() if v["mode"] == "live"]
        return {"mode": "hybrid" if live else "degraded",
                "live_providers": len(live), "items": items}

    def _mark(self, key: str, *, ok: bool | None = None, error: str | None = None):
        with self._lock:
            row = self._status[key]
            row["calls"] += 1
            if ok:
                row["mode"] = "live" if key not in _BROWSER_PROVIDERS else "browser"
                row["last_success"] = time.time()
                row["error"] = None
            elif ok is False:
                row["mode"] = "degraded"
                row["error"] = (error or "request failed")[:200]

    # ------------------------------------------------------------------- cache
    def _cached(self, key: str, ttl: float, loader, *, store_none: bool = True):
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
            if hit and now - hit[0] <= ttl:
                return copy.deepcopy(hit[1])
        value = loader()
        if value is None and not store_none:
            return None
        with self._lock:
            self._cache[key] = (now, copy.deepcopy(value))
            if len(self._cache) > 800:  # simple LRU-ish prune
                for old in sorted(self._cache, key=lambda k: self._cache[k][0])[:300]:
                    self._cache.pop(old, None)
        return value

    # ---------------------------------------------------------------- providers
    def live(self, number: str, *, force: bool = False) -> dict:
        def load():
            self._mark("railradar")
            try:
                data = self.railradar.live(number, force=force)
            except Exception as exc:
                self._mark("railradar", ok=False, error=str(exc))
                raise
            self._mark("railradar", ok=True)
            return data
        return self._cached(f"live:{number}", 0 if force else config.JOURNEY_CACHE_SECONDS, load)

    def weather_at(self, lat: float, lng: float) -> dict | None:
        if not self.weather.configured:
            return None
        def load():
            self._mark("openweather")
            try:
                value = self.weather.current(lat, lng)
            except Exception as exc:
                self._mark("openweather", ok=False, error=str(exc))
                return None
            self._mark("openweather", ok=True)
            return value
        return self._cached(f"wx:{round(lat, 2)}:{round(lng, 2)}", config.WEATHER_CACHE_SECONDS, load)

    def cop30_at(self, lat: float, lng: float) -> dict | None:
        if not self.topography.configured:
            return None
        def load():
            self._mark("opentopography")
            try:
                value = self.topography.elevation(lat, lng)
            except Exception as exc:
                self._mark("opentopography", ok=False, error=str(exc))
                return None
            self._mark("opentopography", ok=True)
            return value
        return self._cached(f"cop30:{round(lat, 3)}:{round(lng, 3)}", config.ELEVATION_CACHE_SECONDS, load)

    def elevation_profile(self, points: list[tuple[float, float]]) -> list[float | None]:
        def load():
            self._mark("openmeteo")
            try:
                return self.openmeteo.profile(points)
            except Exception as exc:
                self._mark("openmeteo", ok=False, error=str(exc))
                return [None] * len(points)
        key = "prof:" + ":".join(f"{a:.3f},{b:.3f}" for a, b in points)
        return self._cached(key, config.ELEVATION_CACHE_SECONDS, load)

    def geocode_halt(self, name: str) -> dict | None:
        clean = name
        for suffix in _HALT_SUFFIXES:
            clean = clean.replace(suffix, "")
        clean = clean.strip().title()
        attempts = (
            ("nominatim", lambda: self.nominatim.geocode(f"{name.title()} railway station")),
            ("openmeteo", lambda: self.geoom.geocode(clean)),
            ("openmeteo", lambda: self.geoom.geocode(name.title())),
            ("photon", lambda: self.photon.geocode(f"{clean} railway station India")),
        )
        def load():
            for label, attempt in attempts:
                try:
                    value = attempt()
                except Exception as exc:  # noqa: BLE001
                    self._mark(label, ok=False, error=str(exc))
                    continue
                if value:
                    self._mark(label, ok=True)
                    return value
            return None
        # failures are NOT cached: a later enrichment pass can still fill gaps
        return self._cached(f"geo:{name}", config.GEOCODE_CACHE_SECONDS, load, store_none=False)

    # --------------------------------------------------------- station media
    def station_info(self, code: str, name: str) -> dict:
        """Photo + encyclopedia summary for a station, keyless, long-cached."""
        def load():
            image, summary = None, None
            pretty = name.title().replace(" Jn", " Junction")
            try:
                image = self.wikimedia.image(f"{pretty} railway station India")
                if image:
                    self._mark("wikimedia", ok=True)
            except Exception as exc:  # noqa: BLE001
                self._mark("wikimedia", ok=False, error=str(exc))
            for title in (f"{pretty} railway station", f"{pretty} Junction railway station", pretty):
                try:
                    summary = self.wikimedia.summary(title)
                except Exception:  # noqa: BLE001
                    summary = None
                if summary:
                    break
            if image or summary:
                return {"image": image, "summary": summary}
            return None
        return self._cached(f"station:{code}:{name}", 7 * 86400, load, store_none=False) \
            or {"image": None, "summary": None}

    # ------------------------------------------------------------- track snap
    def snap_to_rail(self, lat: float, lng: float) -> dict | None:
        """Project a raw provider fix onto the nearest mapped OSM rail way.

        Returns None when nothing is inside SNAP_GUARD_METERS — the UI then
        honestly shows the raw fix instead of a fake snap.
        """
        def load():
            self._mark("overpass")
            try:
                ways = self.overpass.rail_ways(lat, lng, config.SNAP_GUARD_METERS)
            except Exception as exc:
                self._mark("overpass", ok=False, error=str(exc))
                return None
            best = None
            for way in ways:
                point, distance = _project_to_polyline(lat, lng, way["coordinates"])
                if point and (best is None or distance < best["offset_m"]):
                    best = {"lat": point[0], "lng": point[1], "offset_m": round(distance, 1),
                            "way": way["osm_id"], "track": way["coordinates"]}
            if best:
                self._mark("overpass", ok=True)
            return best
        return self._cached(f"snap:{round(lat, 4)}:{round(lng, 4)}", config.SNAP_CACHE_SECONDS, load)


def _densify(anchors, max_points=12):
    if len(anchors) < 2:
        return anchors
    per_leg = max(1, (max_points - len(anchors)) // (len(anchors) - 1) + 1)
    points = []
    for i in range(len(anchors) - 1):
        a, b = anchors[i], anchors[i + 1]
        for step in range(per_leg):
            t = step / per_leg
            points.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    points.append(anchors[-1])
    return points[:max_points]


def _project_to_polyline(lat, lng, coords):
    best_point, best_dist = None, float("inf")
    for i in range(len(coords) - 1):
        a, b = coords[i], coords[i + 1]
        point = _project_segment(lat, lng, a, b)
        dist = haversine_m(lat, lng, point[0], point[1])
        if dist < best_dist:
            best_point, best_dist = point, dist
    return best_point, best_dist


def _project_segment(lat, lng, a, b):
    """Flat-earth projection is fine at <2 km scales."""
    ax, ay = a[1], a[0]
    bx, by = b[1], b[0]
    px, py = lng, lat
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy or 1e-12
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return (ay + t * dy, ax + t * dx)
