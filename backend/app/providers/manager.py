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
from .clients import (NominatimClient, OpenMeteoElevationClient, OpenTopographyClient,
                      OpenWeatherClient, OverpassClient, RailRadarClient, haversine_m)

_BROWSER_PROVIDERS = {
    "maptiler": ("MapTiler", "Vector basemap + rail overlay (browser key)"),
    "geoapify": ("Geoapify", "Reverse geocoding of the live position (browser key)"),
}
_SERVER_PROVIDERS = {
    "railradar": ("RailRadar", "Live train telemetry: position, speed, delay"),
    "openweather": ("OpenWeather", "Current weather → ETA severity"),
    "opentopography": ("OpenTopography", "COP30 point elevation at the live fix"),
    "overpass": ("Overpass OSM", "Mapped rail for track snapping (keyless)"),
    "openmeteo": ("Open-Meteo", "Keyless batch elevation profiles"),
    "nominatim": ("Nominatim", "Keyless halt geocoding for stop weather"),
}


class ProviderManager:
    def __init__(self):
        self.railradar = RailRadarClient()
        self.weather = OpenWeatherClient()
        self.topography = OpenTopographyClient()
        self.overpass = OverpassClient()
        self.openmeteo = OpenMeteoElevationClient()
        self.nominatim = NominatimClient()
        self._lock = threading.RLock()
        self._cache: dict[str, tuple[float, object]] = {}
        self._observed: dict[str, dict] = {}
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
        return rows[:limit]

    def _configured(self, key: str) -> bool:
        return {
            "railradar": self.railradar.configured,
            "openweather": self.weather.configured,
            "opentopography": self.topography.configured,
            "overpass": True, "openmeteo": True, "nominatim": True,
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
    def _cached(self, key: str, ttl: float, loader):
        now = time.time()
        with self._lock:
            hit = self._cache.get(key)
            if hit and now - hit[0] <= ttl:
                return copy.deepcopy(hit[1])
        value = loader()
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
        def load():
            self._mark("nominatim")
            try:
                value = self.nominatim.geocode(f"{name} railway station")
            except Exception as exc:
                self._mark("nominatim", ok=False, error=str(exc))
                return None
            if value:
                self._mark("nominatim", ok=True)
            return value
        return self._cached(f"geo:{name}", config.GEOCODE_CACHE_SECONDS, load)

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
