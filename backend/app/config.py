"""RailSync — global configuration.

Everything a non-CSE teammate needs to tune the demo lives here: tick timing,
data freshness, provider endpoints and quota-conscious cache intervals.
"""
import os
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    return default if raw is None else raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
MODELS_DIR = DATA_DIR / "models"
DB_PATH = DATA_DIR / "railsync.db"
PROVIDER_CACHE_PATH = DATA_DIR / "provider_cache.json"

# Frontend build output. Docker sets RAILSYNC_DIST; local dev uses ../frontend/dist
DIST_DIR = Path(os.environ.get("RAILSYNC_DIST", str(BACKEND_DIR.parent / "frontend" / "dist")))

# --- simulation timing -------------------------------------------------------
TICK_SECONDS = 15          # real seconds between simulation ticks (per SIH spec: 15-30s)
SIM_MIN_PER_TICK = 1.0     # simulated minutes advanced per tick at x1 speed
DEFAULT_SIM_SPEED = 4      # default demo acceleration (x4: 1 real hour = 4 rail hours)
STALE_AFTER_SECONDS = 40   # live feed older than this -> "stale", historical fallback
START_CLOCK_H, START_CLOCK_M = 9, 30   # simulated clock starts 09:30 IST
START_MIN = START_CLOCK_H * 60 + START_CLOCK_M  # absolute minutes-of-day

HIST_DAYS = 60             # days of realistic synthetic history for ML training

# DMS schedules assume typical rather than free-flow conditions. Live
# weather/congestion are measured relative to this baseline in the ETA engine.
SCHEDULE_FACTOR = 0.914

# --- external providers ------------------------------------------------------
# Server-only secrets: never included in API responses or frontend bundles.
RAILRADAR_API_KEY = os.environ.get("RAILRADAR_API_KEY", "").strip()
OPENWEATHER_API_KEY = os.environ.get("OPENWEATHER_API_KEY", "").strip()
OPENTOPOGRAPHY_API_KEY = os.environ.get("OPENTOPOGRAPHY_API_KEY", "").strip()

# Browser keys are expected to be public and should be origin-restricted in the
# provider dashboards. Vite embeds them into the production JavaScript bundle.
VITE_MAPTILER_API_KEY = os.environ.get("VITE_MAPTILER_API_KEY", "").strip()
VITE_GEOAPIFY_API_KEY = os.environ.get("VITE_GEOAPIFY_API_KEY", "").strip()

RAILRADAR_BASE_URL = os.environ.get("RAILRADAR_BASE_URL", "https://api.railradar.in/v1")
OPENWEATHER_URL = os.environ.get("OPENWEATHER_URL", "https://api.openweathermap.org/data/2.5/weather")
OPENTOPOGRAPHY_URL = os.environ.get(
    "OPENTOPOGRAPHY_URL", "https://portal.opentopography.org/API/v1/elevation")
OPENTOPOGRAPHY_DATASET = os.environ.get("OPENTOPOGRAPHY_DATASET", "COP30")
OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")
PROVIDER_TIMEOUT_SECONDS = _env_int("PROVIDER_TIMEOUT_SECONDS", 10, 2)

# RailRadar's sandbox is quota-limited, so automatic fleet polling is opt-in.
# The UI can always demand-refresh one selected train; results are cached 5 min.
RAILRADAR_AUTO_SYNC = _env_bool("RAILRADAR_AUTO_SYNC", False)
RAILRADAR_POLL_SECONDS = _env_int("RAILRADAR_POLL_SECONDS", 900, 60)
RAILRADAR_CACHE_SECONDS = _env_int("RAILRADAR_CACHE_SECONDS", 300, 30)
# A raw provider coordinate is shown only briefly; after that the UI explicitly
# returns to route-based dead reckoning until the next quota-cached refresh.
RAILRADAR_REPORTED_POSITION_TTL_SECONDS = _env_int(
    "RAILRADAR_REPORTED_POSITION_TTL_SECONDS", 600, 60)
RAILRADAR_POSITION_TTL_SECONDS = _env_int("RAILRADAR_POSITION_TTL_SECONDS", 1800, 60)

OPENWEATHER_POLL_SECONDS = _env_int("OPENWEATHER_POLL_SECONDS", 600, 60)
OPENWEATHER_CACHE_SECONDS = _env_int("OPENWEATHER_CACHE_SECONDS", 600, 60)
ELEVATION_CACHE_SECONDS = _env_int("ELEVATION_CACHE_SECONDS", 30 * 24 * 3600, 3600)
OVERPASS_CACHE_SECONDS = _env_int("OVERPASS_CACHE_SECONDS", 6 * 3600, 300)

# Retained for clients that want a raster fallback configuration endpoint.
TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
TILE_ATTR = "© OpenStreetMap contributors © CARTO"
