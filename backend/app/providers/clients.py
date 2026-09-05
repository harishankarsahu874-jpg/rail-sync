"""Adapters for RailRadar, OpenWeather, OpenTopography and Overpass OSM.

Each adapter translates a provider-specific response into a small RailSync shape.
The rest of the application never needs to know provider field names.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone

from .http import ProviderRequestError, get_json, post_form_json


class RailRadarClient:
    name = "RailRadar"

    def __init__(self, api_key: str, base_url: str, timeout: float):
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def live_train(self, number: str, *, force: bool = False) -> dict:
        if not self.configured:
            raise ProviderRequestError(self.name, "RAILRADAR_API_KEY is not configured")
        payload = get_json(
            self.name,
            f"{self.base_url}/trains/{number}/live",
            params={
                "authoritative": "true" if force else "false",
                "haltsOnly": "true",
                "includeCoordinates": "true",
            },
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=self.timeout,
        )
        if payload.get("success") is False:
            err = payload.get("error") or {}
            raise ProviderRequestError(self.name, err.get("message", "request failed"))
        data = payload.get("data", payload)
        if not isinstance(data, dict):
            raise ProviderRequestError(self.name, "missing live train payload")
        return data


class OpenWeatherClient:
    name = "OpenWeather"

    def __init__(self, api_key: str, base_url: str, timeout: float):
        self.api_key = api_key.strip()
        self.base_url = base_url
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def current(self, lat: float, lng: float) -> dict:
        if not self.configured:
            raise ProviderRequestError(self.name, "OPENWEATHER_API_KEY is not configured")
        p = get_json(
            self.name,
            self.base_url,
            params={"lat": round(lat, 5), "lon": round(lng, 5), "units": "metric", "appid": self.api_key},
            timeout=self.timeout,
        )
        weather = (p.get("weather") or [{}])[0]
        main = p.get("main") or {}
        wind = p.get("wind") or {}
        rain = p.get("rain") or {}
        snow = p.get("snow") or {}
        weather_id = _number(weather.get("id"), 800)
        rain_mm = _number(rain.get("1h"), 0.0) + _number(snow.get("1h"), 0.0)
        wind_ms = _number(wind.get("speed"), 0.0)
        visibility_m = _number(p.get("visibility"), 10_000.0)
        clouds = _number((p.get("clouds") or {}).get("all"), 0.0)
        severity = weather_severity(weather_id, rain_mm, wind_ms, visibility_m, clouds)
        observed = p.get("dt")
        return {
            "provider": self.name,
            "place": p.get("name") or "Track section",
            "condition": weather.get("description") or weather.get("main") or "Unknown",
            "condition_code": int(weather_id),
            "temperature_c": round(_number(main.get("temp"), 0.0), 1),
            "feels_like_c": round(_number(main.get("feels_like"), _number(main.get("temp"), 0.0)), 1),
            "humidity_pct": round(_number(main.get("humidity"), 0.0)),
            "pressure_hpa": round(_number(main.get("pressure"), 0.0)),
            "visibility_km": round(visibility_m / 1000.0, 1),
            "wind_kmh": round(wind_ms * 3.6, 1),
            "rain_mm_h": round(rain_mm, 1),
            "cloud_pct": round(clouds),
            "severity": severity,
            "observed_at": datetime.fromtimestamp(observed, timezone.utc).isoformat() if observed else None,
            "fetched_at": time.time(),
        }


def weather_severity(weather_id: float, rain_mm: float, wind_ms: float, visibility_m: float, clouds: float) -> float:
    """Convert OpenWeather observations to the ETA model's 0..1 weather input.

    This deterministic score is intentionally published and explainable:
    condition class supplies the base; rain, high wind and low visibility add
    bounded penalties. It is not another opaque model.
    """
    wid = int(weather_id)
    if 200 <= wid < 300:       # thunderstorm
        base = 0.68
    elif 300 <= wid < 400:     # drizzle
        base = 0.24
    elif 500 <= wid < 600:     # rain
        base = 0.34
    elif 600 <= wid < 700:     # snow
        base = 0.55
    elif 700 <= wid < 800:     # fog, dust, smoke
        base = 0.32
    elif wid == 800:           # clear
        base = 0.02
    else:                      # clouds
        base = 0.04 + 0.10 * min(1.0, clouds / 100.0)
    rain_term = min(0.25, max(0.0, rain_mm) / 24.0)
    wind_term = min(0.20, max(0.0, wind_ms - 7.0) / 35.0)
    visibility_term = min(0.25, max(0.0, 10_000.0 - visibility_m) / 32_000.0)
    return round(min(1.0, base + rain_term + wind_term + visibility_term), 3)


class OpenTopographyClient:
    name = "OpenTopography"

    def __init__(self, api_key: str, base_url: str, dataset: str, timeout: float):
        self.api_key = api_key.strip()
        self.base_url = base_url
        self.dataset = dataset
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def elevation(self, lat: float, lng: float) -> dict:
        if not self.configured:
            raise ProviderRequestError(self.name, "OPENTOPOGRAPHY_API_KEY is not configured")
        p = get_json(
            self.name,
            self.base_url,
            params={
                "longitude": round(lng, 6),
                "latitude": round(lat, 6),
                "dataset": self.dataset,
                "API_Key": self.api_key,
            },
            timeout=self.timeout,
        )
        elevation = _extract_elevation(p)
        if elevation is None:
            raise ProviderRequestError(self.name, "response did not contain an elevation value")
        datum = _first_value(p, ("verticalDatum", "vertical_datum", "datum", "verticalCrs", "vertical_crs"))
        return {
            "provider": self.name,
            "elevation_m": round(elevation, 1),
            "dataset": self.dataset,
            "vertical_datum": datum or ("EGM2008" if self.dataset in {"COP30", "COP90"} else None),
            "fetched_at": time.time(),
        }


class OverpassClient:
    name = "Overpass OSM"

    def __init__(self, endpoint: str, timeout: float):
        self.endpoint = endpoint
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return True

    def nearby_rail(self, lat: float, lng: float, radius_m: int = 4000) -> dict:
        radius = max(300, min(int(radius_m), 10_000))
        # Keep the public query deliberately small: named stations/halts plus a
        # count of nearby railway ways. No nationwide route scrape.
        query = f"""
[out:json][timeout:12];
(
  nwr(around:{radius},{lat:.6f},{lng:.6f})[\"railway\"~\"station|halt\"];
  way(around:{radius},{lat:.6f},{lng:.6f})[\"railway\"~\"rail|narrow_gauge\"];
);
out center tags 80;
""".strip()
        p = post_form_json(self.name, self.endpoint, form={"data": query}, timeout=self.timeout)
        stations, ways = [], 0
        for el in p.get("elements") or []:
            tags = el.get("tags") or {}
            railway = tags.get("railway")
            if el.get("type") == "way" and railway in {"rail", "narrow_gauge"}:
                ways += 1
                continue
            if railway not in {"station", "halt"}:
                continue
            center = el.get("center") or {}
            plat = el.get("lat", center.get("lat"))
            plng = el.get("lon", center.get("lon"))
            if plat is None or plng is None:
                continue
            stations.append({
                "osm_id": f"{el.get('type', 'node')}/{el.get('id')}",
                "name": tags.get("name:en") or tags.get("name") or tags.get("ref") or "Unnamed rail stop",
                "railway": railway,
                "operator": tags.get("operator"),
                "network": tags.get("network"),
                "lat": round(float(plat), 6),
                "lng": round(float(plng), 6),
                "distance_km": round(_haversine(lat, lng, float(plat), float(plng)), 2),
            })
        stations.sort(key=lambda x: x["distance_km"])
        return {
            "provider": self.name,
            "radius_m": radius,
            "railway_way_count": ways,
            "stations": stations[:12],
            "fetched_at": time.time(),
            "copyright": "© OpenStreetMap contributors",
        }


def _extract_elevation(payload: dict) -> float | None:
    candidates = [
        payload.get("elevation"),
        payload.get("value"),
        (payload.get("data") or {}).get("elevation") if isinstance(payload.get("data"), dict) else None,
        (payload.get("result") or {}).get("elevation") if isinstance(payload.get("result"), dict) else None,
    ]
    for value in candidates:
        if isinstance(value, dict):
            value = value.get("value", value.get("elevation"))
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    # Future-proof against minor response-envelope changes, but only follow keys
    # whose name explicitly contains "elev" so latitude is never misidentified.
    stack = [payload]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            for key, value in item.items():
                if "elev" in str(key).lower() and isinstance(value, (int, float)) and not isinstance(value, bool):
                    return float(value)
                if isinstance(value, (dict, list)):
                    stack.append(value)
        elif isinstance(item, list):
            stack.extend(item)
    return None


def _first_value(payload, keys):
    if not isinstance(payload, dict):
        return None
    for key in keys:
        if payload.get(key) is not None:
            value = payload[key]
            return value if isinstance(value, (str, int, float)) else None
    for value in payload.values():
        if isinstance(value, dict):
            found = _first_value(value, keys)
            if found is not None:
                return found
    return None


def _number(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _haversine(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
