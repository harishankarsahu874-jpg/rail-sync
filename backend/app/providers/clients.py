"""Provider adapters: one class per external API.

Each adapter translates a provider-specific response into a small RailSync
shape so the rest of the app never learns provider field names. Every adapter
degrades through ProviderRequestError; the manager turns those into visible
"fallback" statuses instead of crashes.
"""
from __future__ import annotations

import math
import time
from datetime import datetime, timezone

from .. import config
from .http import ProviderRequestError, get_json, post_form_json


# --------------------------------------------------------------------- RailRadar
class RailRadarClient:
    """Live Indian train telemetry: position, speed, delay, route halts."""

    name = "RailRadar"

    def __init__(self):
        self.api_key = config.RAILRADAR_API_KEY
        self.base_url = config.RAILRADAR_BASE_URL.rstrip("/")

    @property
    def configured(self):
        return bool(self.api_key)

    def live(self, number: str, *, force: bool = False) -> dict:
        if not self.configured:
            raise ProviderRequestError(self.name, "RAILRADAR_API_KEY is not configured")
        payload = get_json(
            self.name,
            f"{self.base_url}/trains/{number}/live",
            params={"authoritative": "true" if force else "false",
                    "haltsOnly": "true", "includeCoordinates": "true"},
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=config.PROVIDER_TIMEOUT_SECONDS,
        )
        if payload.get("success") is False:
            raise ProviderRequestError(self.name, (payload.get("error") or {}).get("message", "request failed"))
        data = payload.get("data", payload)
        if not isinstance(data, dict):
            raise ProviderRequestError(self.name, "missing live payload")
        return data


# ------------------------------------------------------------------- OpenWeather
class OpenWeatherClient:
    """Current weather at a coordinate; converted to a 0..1 ETA severity."""

    name = "OpenWeather"

    def __init__(self):
        self.api_key = config.OPENWEATHER_API_KEY

    @property
    def configured(self):
        return bool(self.api_key)

    def current(self, lat: float, lng: float) -> dict:
        if not self.configured:
            raise ProviderRequestError(self.name, "OPENWEATHER_API_KEY is not configured")
        p = get_json(self.name, config.OPENWEATHER_URL,
                     params={"lat": round(lat, 5), "lon": round(lng, 5),
                             "units": "metric", "appid": self.api_key},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        weather = (p.get("weather") or [{}])[0]
        main, wind = p.get("main") or {}, p.get("wind") or {}
        rain = (p.get("rain") or {}).get("1h", 0.0) + (p.get("snow") or {}).get("1h", 0.0)
        wind_ms = _num(wind.get("speed"))
        visibility_m = _num(p.get("visibility"), 10_000)
        clouds = _num((p.get("clouds") or {}).get("all"))
        wid = int(_num(weather.get("id"), 800))
        return {
            "provider": self.name,
            "place": p.get("name") or "Track section",
            "condition": weather.get("description") or weather.get("main") or "Unknown",
            "condition_code": wid,
            "temperature_c": round(_num(main.get("temp")), 1),
            "feels_like_c": round(_num(main.get("feels_like"), _num(main.get("temp"))), 1),
            "humidity_pct": round(_num(main.get("humidity"))),
            "wind_kmh": round(wind_ms * 3.6, 1),
            "rain_mm_h": round(rain, 1),
            "cloud_pct": round(clouds),
            "visibility_km": round(visibility_m / 1000, 1),
            "severity": weather_severity(wid, rain, wind_ms, visibility_m, clouds),
            "observed_at": datetime.fromtimestamp(p.get("dt", 0), timezone.utc).isoformat() if p.get("dt") else None,
            "fetched_at": time.time(),
        }


def weather_severity(wid: int, rain_mm: float, wind_ms: float, visibility_m: float, clouds: float) -> float:
    """Explainable 0..1 weather input for ETA reasoning (published, not opaque)."""
    if 200 <= wid < 300:
        base = 0.68
    elif 300 <= wid < 400:
        base = 0.24
    elif 500 <= wid < 600:
        base = 0.34
    elif 600 <= wid < 700:
        base = 0.55
    elif 700 <= wid < 800:
        base = 0.32
    elif wid == 800:
        base = 0.02
    else:
        base = 0.04 + 0.10 * min(1.0, clouds / 100.0)
    rain_term = min(0.25, max(0.0, rain_mm) / 24.0)
    wind_term = min(0.20, max(0.0, wind_ms - 7.0) / 35.0)
    visibility_term = min(0.25, max(0.0, 10_000.0 - visibility_m) / 32_000.0)
    return round(min(1.0, base + rain_term + wind_term + visibility_term), 3)


# --------------------------------------------------------------- OpenTopography
class OpenTopographyClient:
    """COP30 point elevation — the 'premium' DEM cross-check."""

    name = "OpenTopography"

    def __init__(self):
        self.api_key = config.OPENTOPOGRAPHY_API_KEY
        self.dataset = config.OPENTOPOGRAPHY_DATASET

    @property
    def configured(self):
        return bool(self.api_key)

    def elevation(self, lat: float, lng: float) -> dict:
        if not self.configured:
            raise ProviderRequestError(self.name, "OPENTOPOGRAPHY_API_KEY is not configured")
        p = get_json(self.name, config.OPENTOPOGRAPHY_URL,
                     params={"longitude": round(lng, 6), "latitude": round(lat, 6),
                             "dataset": self.dataset, "API_Key": self.api_key},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        value = _find_elevation(p)
        if value is None:
            raise ProviderRequestError(self.name, "response had no elevation value")
        return {"provider": self.name, "dataset": self.dataset,
                "elevation_m": round(value, 1), "fetched_at": time.time()}


# ------------------------------------------------------- Open-Meteo (keyless)
class OpenMeteoElevationClient:
    """Keyless batch elevation (Copernicus DEM) for whole-section profiles."""

    name = "Open-Meteo Elevation"

    configured = True  # keyless by design

    def profile(self, points: list[tuple[float, float]]) -> list[float | None]:
        if not points:
            return []
        p = get_json(self.name, config.OPEN_METEO_ELEVATION_URL,
                     params={"latitude": ",".join(f"{lat:.5f}" for lat, _ in points),
                             "longitude": ",".join(f"{lng:.5f}" for _, lng in points)},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        values = p.get("elevation")
        if not isinstance(values, list):
            raise ProviderRequestError(self.name, "no elevation array")
        return [round(v, 1) if isinstance(v, (int, float)) else None for v in values]


# ------------------------------------------------------------- Overpass (keyless)
class OverpassClient:
    """Keyless OSM queries: real mapped rail near a fix (for track snapping)."""

    name = "Overpass OSM"

    configured = True

    def rail_ways(self, lat: float, lng: float, radius_m: int = 1500) -> list[dict]:
        radius = max(300, min(int(radius_m), 4000))
        query = f"""
[out:json][timeout:12];
way(around:{radius},{lat:.6f},{lng:.6f})["railway"~"rail|narrow_gauge"];
out geom 60;
""".strip()
        # Public Overpass instances are best-effort: try the primary, then a
        # well-known community mirror before declaring the snap unavailable.
        endpoints = [config.OVERPASS_URL, config.OVERPASS_MIRROR_URL]
        last_error = None
        for endpoint in endpoints:
            if not endpoint:
                continue
            try:
                p = post_form_json(self.name, endpoint, form={"data": query},
                                   timeout=config.OVERPASS_TIMEOUT_SECONDS)
                break
            except ProviderRequestError as exc:
                last_error = exc
        else:
            raise last_error or ProviderRequestError(self.name, "no overpass endpoint")
        ways = []
        for el in p.get("elements") or []:
            geom = el.get("geometry") or []
            if len(geom) < 2:
                continue
            ways.append({
                "osm_id": f"way/{el.get('id')}",
                "coordinates": [[round(g["lat"], 6), round(g["lon"], 6)] for g in geom],
            })
        return ways


# --------------------------------------------------------- Nominatim (keyless)
class NominatimClient:
    """Keyless geocoding of halt names so stops get coordinates + weather."""

    name = "Nominatim"

    configured = True

    def geocode(self, query: str) -> dict | None:
        p = get_json(self.name, config.NOMINATIM_URL,
                     params={"q": query, "format": "jsonv2", "limit": 1,
                             "countrycodes": "in"},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        if not isinstance(p, list) or not p:
            return None
        row = p[0]
        return {"lat": round(float(row["lat"]), 6), "lng": round(float(row["lon"]), 6),
                "display": row.get("display_name", "")}


class WikimediaClient:
    """Keyless station photos (Commons) + encyclopedia summaries (Wikipedia)."""

    name = "Wikimedia"

    configured = True

    def image(self, query: str) -> dict | None:
        p = get_json(self.name, "https://commons.wikimedia.org/w/api.php",
                     params={"action": "query", "format": "json", "generator": "search",
                             "gsrsearch": f"filetype:bitmap {query}", "gsrnamespace": 6,
                             "gsrlimit": 4, "prop": "imageinfo", "iiprop": "url|size",
                             "iiurlwidth": 1000},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        pages = (p or {}).get("query", {}).get("pages") or {}
        for page in sorted(pages.values(), key=lambda r: r.get("index", 99)):
            info = (page.get("imageinfo") or [{}])[0]
            thumb = info.get("thumburl")
            if thumb and (info.get("width") or 0) >= 500:
                return {"url": thumb, "page": f"https://commons.wikimedia.org/wiki/{page.get('title', '').replace(' ', '_')}",
                        "title": str(page.get("title", "")).replace("File:", "")}
        return None

    def summary(self, title: str) -> str | None:
        p = get_json(self.name, f"https://en.wikipedia.org/api/rest_v1/page/summary/{title.replace(' ', '_')}",
                     params={}, timeout=config.PROVIDER_TIMEOUT_SECONDS)
        if not isinstance(p, dict) or p.get("type") != "standard":
            return None
        extract = (p.get("extract") or "").strip()
        return extract or None


class PhotonGeocoder:
    """Keyless komoot Photon — last-resort halt geocoder (rare names)."""

    name = "Photon"

    configured = True

    def geocode(self, query: str) -> dict | None:
        p = get_json(self.name, "https://photon.komoot.io/api/",
                     params={"q": query, "limit": 1, "lang": "en"},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        features = (p or {}).get("features") or []
        if not features:
            return None
        coords = features[0].get("geometry", {}).get("coordinates") or []
        if len(coords) < 2:
            return None
        props = features[0].get("properties", {})
        return {"lat": round(float(coords[1]), 6), "lng": round(float(coords[0]), 6),
                "display": f"{props.get('name', '')}, {props.get('state', '')}"}


class OpenMeteoWeatherClient:
    """Keyless weather fallback with the SAME shape as OpenWeather.

    Demo-day insurance: if the OpenWeather key ever hits quota, the weather
    panels and the RF severity input keep working off Open-Meteo.
    """

    name = "Open-Meteo Weather"

    configured = True

    _WMO = {
        0: (800, "clear sky"), 1: (801, "mainly clear"), 2: (802, "partly cloudy"),
        3: (804, "overcast"), 45: (450, "fog"), 48: (451, "depositing rime fog"),
        51: (500, "light drizzle"), 53: (501, "drizzle"), 55: (502, "dense drizzle"),
        56: (503, "freezing drizzle"), 57: (504, "dense freezing drizzle"),
        61: (500, "slight rain"), 63: (501, "rain"), 65: (502, "heavy rain"),
        66: (503, "freezing rain"), 67: (504, "heavy freezing rain"),
        71: (600, "slight snow"), 73: (601, "snow"), 75: (602, "heavy snow"),
        77: (611, "snow grains"), 80: (520, "rain showers"), 81: (521, "rain showers"),
        82: (522, "violent rain showers"), 85: (620, "snow showers"),
        86: (621, "heavy snow showers"), 95: (200, "thunderstorm"),
        96: (231, "thunderstorm with hail"), 99: (232, "thunderstorm with heavy hail"),
    }

    def current(self, lat: float, lng: float) -> dict:
        p = get_json(self.name, "https://api.open-meteo.com/v1/forecast",
                     params={"latitude": round(lat, 5), "longitude": round(lng, 5),
                             "current": "temperature_2m,relative_humidity_2m,apparent_"
                                        "temperature,weather_code,wind_speed_10m,"
                                        "precipitation,cloud_cover,visibility",
                             "timezone": "auto"},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        c = (p or {}).get("current") or {}
        if not c or c.get("temperature_2m") is None:
            raise ProviderRequestError(self.name, "empty Open-Meteo response")
        wid, desc = self._WMO.get(int(c.get("weather_code") or 0), (800, "clear sky"))
        rain = _num(c.get("precipitation"))
        wind_ms = _num(c.get("wind_speed_10m")) / 3.6
        visibility_m = _num(c.get("visibility"), 10_000)
        clouds = _num(c.get("cloud_cover"))
        return {
            "provider": self.name,
            "place": "Track section",
            "condition": desc,
            "condition_code": wid,
            "temperature_c": round(_num(c.get("temperature_2m")), 1),
            "feels_like_c": round(_num(c.get("apparent_temperature"),
                                      _num(c.get("temperature_2m"))), 1),
            "humidity_pct": round(_num(c.get("relative_humidity_2m"))),
            "wind_kmh": round(_num(c.get("wind_speed_10m")), 1),
            "rain_mm_h": round(rain, 1),
            "cloud_pct": round(clouds),
            "visibility_km": round(visibility_m / 1000, 1),
            "severity": weather_severity(wid, rain, wind_ms, visibility_m, clouds),
            "observed_at": c.get("time"),
            "fetched_at": time.time(),
        }


class OpenMeteoGeocoder:
    """Keyless geocoder fallback when Nominatim throttles or misses a halt."""

    name = "Open-Meteo Geocoding"

    configured = True

    def geocode(self, query: str) -> dict | None:
        p = get_json(self.name, "https://geocoding-api.open-meteo.com/v1/search",
                     params={"name": query, "count": 1, "language": "en",
                             "format": "json", "countryCode": "IN"},
                     timeout=config.PROVIDER_TIMEOUT_SECONDS)
        results = (p or {}).get("results") or []
        if not results:
            return None
        row = results[0]
        return {"lat": round(float(row["latitude"]), 6),
                "lng": round(float(row["longitude"]), 6),
                "display": f"{row.get('name', '')}, {row.get('admin1', '')}, India"}


# --------------------------------------------------------------------- helpers
def _num(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)


def _find_elevation(payload: dict) -> float | None:
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


def haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
