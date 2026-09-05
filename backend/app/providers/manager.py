"""Provider orchestration, caching and graceful fallback for RailSync.

Network I/O runs outside the simulation lock. RailRadar can re-anchor a train's
position/delay, OpenWeather updates the active track section, OpenTopography and
Overpass enrich a clicked map location. Every call is cached and every failure is
reported as provider status instead of taking down the demo.
"""
from __future__ import annotations

import bisect
import copy
import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from .. import config
from .clients import OpenTopographyClient, OpenWeatherClient, OverpassClient, RailRadarClient
from .http import ProviderRequestError


_PROVIDER_INFO = {
    "railradar": ("RailRadar", "Live train telemetry"),
    "maptiler": ("MapTiler", "Interactive vector map"),
    "openweather": ("OpenWeather", "Live weather → ETA severity"),
    "opentopography": ("OpenTopography", "Point elevation (COP30)"),
    "geoapify": ("Geoapify", "Reverse geocoding on map click"),
    "overpass": ("Overpass OSM", "Nearby rail infrastructure"),
}


class ProviderManager:
    def __init__(self):
        self.railradar = RailRadarClient(
            config.RAILRADAR_API_KEY, config.RAILRADAR_BASE_URL, config.PROVIDER_TIMEOUT_SECONDS)
        self.weather = OpenWeatherClient(
            config.OPENWEATHER_API_KEY, config.OPENWEATHER_URL, config.PROVIDER_TIMEOUT_SECONDS)
        self.topography = OpenTopographyClient(
            config.OPENTOPOGRAPHY_API_KEY, config.OPENTOPOGRAPHY_URL,
            config.OPENTOPOGRAPHY_DATASET, config.PROVIDER_TIMEOUT_SECONDS)
        self.overpass = OverpassClient(config.OVERPASS_URL, config.PROVIDER_TIMEOUT_SECONDS)
        # Persisted cache entries are credential-scoped. A newly supplied or
        # rotated invalid key must never inherit another key's successful data.
        self._rail_cache_tag = _credential_tag(config.RAILRADAR_API_KEY)
        self._weather_cache_tag = _credential_tag(config.OPENWEATHER_API_KEY)
        configured = {
            "railradar": self.railradar.configured,
            "maptiler": bool(config.VITE_MAPTILER_API_KEY),
            "openweather": self.weather.configured,
            "opentopography": self.topography.configured,
            "geoapify": bool(config.VITE_GEOAPIFY_API_KEY),
            "overpass": True,
        }
        self._status_lock = threading.RLock()
        self._status = {}
        for key, (label, purpose) in _PROVIDER_INFO.items():
            browser = key in {"maptiler", "geoapify"}
            self._status[key] = {
                "label": label,
                "purpose": purpose,
                "configured": configured[key],
                "active": bool(configured[key] and browser),
                "mode": "browser" if configured[key] and browser else (
                    "ready" if key == "overpass" else "fallback"),
                "last_attempt": None,
                "last_success": None,
                "error": None,
                "calls_this_run": 0,
                "records": 0,
            }
        self._cache_lock = threading.RLock()
        self._cache_path = config.PROVIDER_CACHE_PATH
        self._cache = self._load_cache(self._cache_path)
        self._state = None
        self._eta_engine = None
        self._refresh_lock = threading.Lock()

    # --------------------------------------------------------------- lifecycle
    def start(self, state: dict, eta_engine, stop_event: threading.Event):
        self._state = state
        self._eta_engine = eta_engine
        self.publish_status()

        def loop():
            next_weather = 0.0
            next_rail = 0.0
            # Wait until the first simulator snapshot is published; API startup
            # itself must never depend on an external provider.
            if stop_event.wait(1.0):
                return
            while not stop_event.is_set():
                now = time.time()
                if self.weather.configured and now >= next_weather:
                    try:
                        self.sync_weather()
                    except Exception as exc:
                        self._mark_error("openweather", exc)
                    next_weather = now + config.OPENWEATHER_POLL_SECONDS
                if self.railradar.configured and config.RAILRADAR_AUTO_SYNC and now >= next_rail:
                    try:
                        self.sync_railradar()
                    except Exception as exc:
                        self._mark_error("railradar", exc)
                    next_rail = now + config.RAILRADAR_POLL_SECONDS
                stop_event.wait(1.0)

        threading.Thread(target=loop, name="railsync-providers", daemon=True).start()

    # --------------------------------------------------------------- status API
    def public_status(self) -> dict:
        with self._status_lock:
            data = copy.deepcopy(self._status)
        active_real = sum(1 for k, v in data.items() if k != "overpass" and v["active"])
        configured_real = sum(1 for k, v in data.items() if k != "overpass" and v["configured"])
        return {
            "mode": "hybrid" if active_real else "simulation_fallback",
            "active_real": active_real,
            "configured_real": configured_real,
            "items": data,
        }

    def publish_status(self):
        if self._state is None:
            return
        value = self.public_status()
        with self._state["lock"]:
            self._state["providers"] = value

    def _mark_attempt(self, key: str):
        with self._status_lock:
            row = self._status[key]
            row["last_attempt"] = time.time()
            row["calls_this_run"] += 1
            row["error"] = None
        self.publish_status()

    def _mark_success(self, key: str, records: int | None = None):
        with self._status_lock:
            row = self._status[key]
            row["last_success"] = time.time()
            row["active"] = True
            row["mode"] = "live" if key not in {"maptiler", "geoapify"} else "browser"
            row["error"] = None
            if records is not None:
                row["records"] = records
        self.publish_status()

    def _mark_error(self, key: str, exc: Exception):
        text = str(exc).replace("\n", " ")[:260]
        with self._status_lock:
            row = self._status[key]
            row["active"] = False
            row["mode"] = "degraded" if row["configured"] or key == "overpass" else "fallback"
            row["error"] = text
        self.publish_status()

    # -------------------------------------------------------------- RailRadar
    def sync_railradar(self, number: str | None = None, *, force: bool = False) -> dict:
        if not self.railradar.configured:
            raise ProviderRequestError("RailRadar", "RAILRADAR_API_KEY is not configured")
        if self._state is None or self._eta_engine is None:
            raise RuntimeError("provider manager is not started")
        with self._state["lock"]:
            numbers = [number] if number else list(self._state["trains"])
            unknown = [n for n in numbers if n not in self._state["trains"]]
        if unknown:
            raise ValueError(f"unknown train {unknown[0]}")

        # A refresh lock prevents a UI click and auto-sync from spending quota
        # on the same train at the same time.
        results = []
        with self._refresh_lock:
            for train_number in numbers:
                key = f"railradar:{self._rail_cache_tag}:{train_number}"
                try:
                    data, cached = self._cached(
                        key,
                        0 if force else config.RAILRADAR_CACHE_SECONDS,
                        lambda n=train_number: self._railradar_call(n, force=force),
                    )
                    summary = self._apply_railradar(train_number, data)
                    summary["cached"] = cached
                    results.append(summary)
                except Exception as exc:
                    self._mark_error("railradar", exc)
                    results.append({"train": train_number, "applied": False, "error": str(exc)})
        applied = sum(1 for x in results if x.get("applied"))
        if applied:
            self._mark_success("railradar", applied)
        return {"provider": "RailRadar", "requested": len(numbers), "applied": applied, "trains": results}

    def _railradar_call(self, number: str, *, force: bool) -> dict:
        self._mark_attempt("railradar")
        return self.railradar.live_train(number, force=force)

    def _apply_railradar(self, number: str, data: dict) -> dict:
        status = str(data.get("status") or "unknown").lower()
        is_live = bool(data.get("isLive", status == "running"))
        loc = data.get("currentLocation") or {}
        delay = _as_float(data.get("delayMinutes"), 0.0)
        route = [r for r in (data.get("route") or []) if isinstance(r, dict)]
        now = time.time()
        provider_updated_at = _provider_timestamp(data.get("lastUpdatedAt"), now)
        coordinate = _railradar_coordinate(loc)
        provider_age = max(0.0, now - provider_updated_at)
        summary = {
            "train": number,
            "provider_status": status,
            "is_live": is_live,
            "delay_min": round(delay, 1),
            "provider_age_s": round(provider_age),
            "coordinate_available": coordinate is not None,
            "applied": False,
        }

        with self._state["lock"]:
            t = self._state["trains"][number]
            t["railradar"] = {
                "status": status,
                "is_live": is_live,
                "start_date": data.get("startDate"),
                "last_updated_at": data.get("lastUpdatedAt"),
                "provider_age_s": round(provider_age),
                "delay_min": round(delay, 1),
                "bearing_deg": loc.get("bearingDegrees"),
                "actual_position": loc.get("isActualPosition"),
                "position_source": loc.get("positionSource"),
                "coordinate_available": coordinate is not None,
                "exceptions": [x.get("message") for x in (data.get("exceptions") or [])
                               if isinstance(x, dict) and x.get("message")][:4],
                "fetched_at": now,
            }
            # Preserve the demo service when today's real journey is not running.
            # The provider status is still visible, but a completed/not-started
            # response cannot replace a moving train with a misleading position.
            if status != "running" or not is_live:
                return summary
            if provider_age > config.RAILRADAR_POSITION_TTL_SECONDS:
                summary["stale"] = True
                return summary

            raw_distance, real_total = _railradar_distance(data, route)
            if real_total <= 0:
                return summary
            fraction = max(0.0, min(0.999999, raw_distance / real_total))
            mapped_pos = fraction * t["km"][-1]
            leg = max(0, min(len(t["km"]) - 2, bisect.bisect_right(t["km"], mapped_pos) - 1))
            t["pos"] = max(t["km"][leg], min(mapped_pos, t["km"][leg + 1] - 1e-6))
            t["leg"] = leg
            t["at_station"] = False
            t["dwell_left"] = 0.0
            speed = _as_float(loc.get("speedKmh"), t["speed"])
            if speed >= 0:
                t["speed"] = speed

            # Align the simulator trip epoch so clock - scheduled_position_time
            # exactly equals RailRadar's measured delay. The existing ETA model
            # can then continue from a real anchor without changing its formula.
            t["epoch"] = 0.0
            base_sched = self._eta_engine._sched_time(t)
            t["epoch"] = self._state["clock"] - delay - base_sched
            t["delay"] = delay
            t["last_station_code"] = t["stops"][leg]
            t["last_station_time"] = self._state["clock"] - 1.0
            t["telemetry_source"] = "railradar"
            t["telemetry_updated_at"] = provider_updated_at
            t["telemetry_fetched_at"] = now
            t["telemetry_position"] = coordinate
            t["telemetry_anchor"] = {
                "route_fraction": round(fraction, 5),
                "raw_distance_km": round(raw_distance, 1),
                "provider_total_km": round(real_total, 1),
            }
            summary.update(
                applied=True,
                route_fraction=round(fraction, 4),
                mapped_position_km=round(t["pos"], 1),
                speed_kmh=round(t["speed"], 1),
                position_mode="provider_coordinate" if coordinate else "route_distance",
            )
        return summary

    # ------------------------------------------------------------- OpenWeather
    def sync_weather(self) -> dict:
        if not self.weather.configured:
            raise ProviderRequestError("OpenWeather", "OPENWEATHER_API_KEY is not configured")
        if self._state is None:
            raise RuntimeError("provider manager is not started")
        from ..sim import state as sim_state

        with self._state["lock"]:
            points = []
            for number, t in self._state["trains"].items():
                lat, lng = sim_state.latlng(t)
                seg_key = (t["stops"][t["leg"]], t["stops"][t["leg"] + 1])
                points.append((number, lat, lng, seg_key))

        results = {}
        # Six trains, at most four concurrent requests; rounded-coordinate cache
        # collapses trains sharing the same weather cell.
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = {pool.submit(self.current_weather, lat, lng): (number, seg_key)
                    for number, lat, lng, seg_key in points}
            for future in as_completed(jobs):
                number, seg_key = jobs[future]
                try:
                    results[number] = (future.result(), seg_key)
                except Exception:
                    continue

        with self._state["lock"]:
            for number, (weather, seg_key) in results.items():
                t = self._state["trains"].get(number)
                seg = self._state["segments"].get(seg_key)
                if not t or not seg:
                    continue
                t["weather_live"] = weather
                seg.base_w = weather["severity"]
                seg.weather_source = "openweather"
                seg.weather_updated_at = weather["fetched_at"]
                if seg.front_left <= 0:
                    seg.w = seg.base_w
        if results:
            self._mark_success("openweather", len(results))
        return {"provider": "OpenWeather", "updated_trains": len(results)}

    def current_weather(self, lat: float, lng: float) -> dict:
        key = f"weather:{self._weather_cache_tag}:{round(lat, 2):.2f}:{round(lng, 2):.2f}"
        data, _ = self._cached(
            key, config.OPENWEATHER_CACHE_SECONDS,
            lambda: self._weather_call(lat, lng),
        )
        return data

    def _weather_call(self, lat: float, lng: float) -> dict:
        self._mark_attempt("openweather")
        try:
            value = self.weather.current(lat, lng)
        except Exception as exc:
            self._mark_error("openweather", exc)
            raise
        self._mark_success("openweather")
        return value

    # ---------------------------------------------------------- map intelligence
    def geo_context(self, lat: float, lng: float, radius_m: int = 4000) -> dict:
        jobs = {"osm": lambda: self.nearby_rail(lat, lng, radius_m)}
        if self.weather.configured:
            jobs["weather"] = lambda: self.current_weather(lat, lng)
        if self.topography.configured:
            jobs["terrain"] = lambda: self.elevation(lat, lng)

        out = {
            "coordinates": {"lat": round(lat, 6), "lng": round(lng, 6)},
            "weather": _unavailable("OPENWEATHER_API_KEY is not configured")
                       if not self.weather.configured else None,
            "terrain": _unavailable("OPENTOPOGRAPHY_API_KEY is not configured")
                       if not self.topography.configured else None,
            "osm": None,
        }
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(loader): name for name, loader in jobs.items()}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    out[name] = {"available": True, "data": future.result()}
                except Exception as exc:
                    out[name] = _unavailable(str(exc))
        out["providers"] = self.public_status()
        return out

    def elevation(self, lat: float, lng: float) -> dict:
        # ~1 km cache cells plus persisted cache protect OpenTopography's daily
        # point-query quota while retaining useful track-level terrain context.
        key = f"elevation:{config.OPENTOPOGRAPHY_DATASET}:{round(lat, 2):.2f}:{round(lng, 2):.2f}"
        data, _ = self._cached(key, config.ELEVATION_CACHE_SECONDS,
                               lambda: self._elevation_call(lat, lng))
        return data

    def _elevation_call(self, lat: float, lng: float) -> dict:
        self._mark_attempt("opentopography")
        try:
            value = self.topography.elevation(lat, lng)
        except Exception as exc:
            self._mark_error("opentopography", exc)
            raise
        self._mark_success("opentopography")
        return value

    def nearby_rail(self, lat: float, lng: float, radius_m: int) -> dict:
        radius = max(300, min(int(radius_m), 10_000))
        key = f"overpass:{round(lat, 2):.2f}:{round(lng, 2):.2f}:{radius}"
        data, _ = self._cached(key, config.OVERPASS_CACHE_SECONDS,
                               lambda: self._overpass_call(lat, lng, radius))
        return data

    def _overpass_call(self, lat: float, lng: float, radius_m: int) -> dict:
        self._mark_attempt("overpass")
        try:
            value = self.overpass.nearby_rail(lat, lng, radius_m)
        except Exception as exc:
            self._mark_error("overpass", exc)
            raise
        self._mark_success("overpass", len(value.get("stations") or []))
        return value

    # ------------------------------------------------------------- manual API
    def refresh(self, provider: str, train: str | None = None, force: bool = False) -> dict:
        key = provider.strip().lower()
        if key == "railradar":
            return self.sync_railradar(train, force=force)
        if key == "openweather":
            return self.sync_weather()
        raise ValueError("provider must be railradar or openweather")

    # ------------------------------------------------------------------- cache
    def _cached(self, key: str, ttl: float, loader):
        now = time.time()
        with self._cache_lock:
            row = self._cache.get(key)
            if row and ttl > 0 and now - row.get("saved_at", 0) <= ttl:
                return copy.deepcopy(row["data"]), True
        value = loader()
        with self._cache_lock:
            self._cache[key] = {"saved_at": now, "data": value}
            self._prune_cache(now)
            self._save_cache()
        return copy.deepcopy(value), False

    @staticmethod
    def _load_cache(path: Path) -> dict:
        try:
            value = json.loads(path.read_text())
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_cache(self):
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._cache_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._cache, separators=(",", ":")))
            tmp.replace(self._cache_path)
        except OSError:
            pass  # cache persistence is an optimisation, never a boot dependency

    def _prune_cache(self, now: float):
        if len(self._cache) <= 500:
            return
        keep = sorted(self._cache.items(), key=lambda kv: kv[1].get("saved_at", 0), reverse=True)[:350]
        self._cache = dict(keep)


def _credential_tag(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12] if value else "none"


def _provider_timestamp(value, fallback: float) -> float:
    if not value:
        return fallback
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        stamp = parsed.timestamp()
        # Provider clocks a few seconds ahead should not produce negative age.
        return min(fallback, stamp) if stamp > 0 else fallback
    except (TypeError, ValueError, OverflowError):
        return fallback


def _railradar_coordinate(location: dict) -> dict | None:
    raw = location.get("coordinates") or {}
    lat = _as_float(raw.get("lat", raw.get("latitude")), float("nan"))
    lng = _as_float(raw.get("lng", raw.get("lon", raw.get("longitude"))), float("nan"))
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (abs(lat) < 1e-9 and abs(lng) < 1e-9):
        return None
    return {
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "actual": bool(location.get("isActualPosition")),
        "source": location.get("positionSource") or "provider",
    }


def _railradar_distance(data: dict, route: list[dict]) -> tuple[float, float]:
    loc = data.get("currentLocation") or {}
    progress = max(0.0, min(1.0, _as_float(loc.get("segmentProgress"), 0.0)))
    prev = data.get("previousHalt") or {}
    nxt = data.get("nextHalt") or {}
    d0, d1 = _as_float(prev.get("distance"), -1), _as_float(nxt.get("distance"), -1)

    if d0 < 0 or d1 <= d0:
        seq = int(_as_float(loc.get("sequence"), 0))
        idx = next((i for i, r in enumerate(route) if int(_as_float(r.get("sequence"), -1)) == seq), -1)
        if idx >= 0:
            d0 = _as_float(route[idx].get("distance"), 0)
            if idx + 1 < len(route):
                d1 = _as_float(route[idx + 1].get("distance"), d0)
            else:
                d1 = d0
    raw = d0 + progress * max(0.0, d1 - d0) if d0 >= 0 else 0.0
    train = data.get("train") or {}
    total = _as_float(train.get("distance"), 0.0)
    if total <= 0:
        total = max((_as_float(r.get("distance"), 0.0) for r in route), default=0.0)
    return max(0.0, raw), max(0.0, total)


def _as_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _unavailable(reason: str) -> dict:
    return {"available": False, "reason": reason.replace("\n", " ")[:260]}
