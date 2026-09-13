"""RailSync Live — global configuration.

Secret resolution order (everywhere in the codebase):
    1. OS / Render environment variable   (override, optional)
    2. committed repo-root `.env.production` file   (zero-env deployments)

Browser keys (VITE_*) are read by Vite at build time from the same file
(frontend/vite.config.js sets ``envDir: '..'``).
"""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DIST_DIR = Path(os.environ.get("RAILSYNC_DIST", str(REPO_ROOT / "frontend" / "dist")))


def _env_file_values() -> dict:
    """Parse the committed ``.env.production`` (KEY=value lines)."""
    values: dict = {}
    try:
        for line in (REPO_ROOT / ".env.production").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    except OSError:
        pass  # file optional: env-only deployments keep working
    return values


_ENV_FILE = _env_file_values()


def secret(name: str, default: str = "") -> str:
    """Environment first, then the committed file, then ``default``."""
    return (os.environ.get(name) or _ENV_FILE.get(name) or default).strip()


def env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


# --- provider keys -----------------------------------------------------------
RAILRADAR_API_KEY = secret("RAILRADAR_API_KEY")
OPENWEATHER_API_KEY = secret("OPENWEATHER_API_KEY")
OPENTOPOGRAPHY_API_KEY = secret("OPENTOPOGRAPHY_API_KEY")
OPENTOPOGRAPHY_DATASET = secret("OPENTOPOGRAPHY_DATASET", "COP30")

# --- provider endpoints -------------------------------------------------------
RAILRADAR_BASE_URL = secret("RAILRADAR_BASE_URL", "https://api.railradar.in/v1")
OPENWEATHER_URL = secret("OPENWEATHER_URL", "https://api.openweathermap.org/data/2.5/weather")
OPENTOPOGRAPHY_URL = secret("OPENTOPOGRAPHY_URL", "https://portal.opentopography.org/API/v1/elevation")
OVERPASS_URL = secret("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
OVERPASS_MIRROR_URL = secret("OVERPASS_MIRROR_URL", "https://overpass.kumi.systems/api/interpreter")
OVERPASS_TIMEOUT_SECONDS = env_int("OVERPASS_TIMEOUT_SECONDS", 25, 10)
OPEN_METEO_ELEVATION_URL = secret("OPEN_METEO_ELEVATION_URL", "https://api.open-meteo.com/v1/elevation")
NOMINATIM_URL = secret("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")

PROVIDER_TIMEOUT_SECONDS = env_int("PROVIDER_TIMEOUT_SECONDS", 10, 3)

# --- cache TTLs (seconds) ------------------------------------------------------
JOURNEY_CACHE_SECONDS = env_int("JOURNEY_CACHE_SECONDS", 60, 15)
WEATHER_CACHE_SECONDS = env_int("WEATHER_CACHE_SECONDS", 600, 60)
ELEVATION_CACHE_SECONDS = env_int("ELEVATION_CACHE_SECONDS", 30 * 86400, 3600)
GEOCODE_CACHE_SECONDS = env_int("GEOCODE_CACHE_SECONDS", 30 * 86400, 3600)
SNAP_CACHE_SECONDS = env_int("SNAP_CACHE_SECONDS", 6 * 3600, 300)

# Snap guard: a raw provider fix farther than this from mapped OSM rail is
# shown raw instead of being moved (honesty over prettiness).
SNAP_GUARD_METERS = env_int("SNAP_GUARD_METERS", 1500, 100)

POLL_SECONDS = env_int("POLL_SECONDS", 20, 5)  # frontend refresh cadence hint
