"""In-memory live state: trains, shared track segments, alerts.

The DB holds static + historical data; live simulation state lives here
and is refreshed by the engine thread every TICK_SECONDS. The snapshot
published each tick is what the REST + WebSocket layers serve.
"""
import bisect
import json
import math
import random
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from .. import config, db
from ..data import stations as ST
from ..data import trains as TR
from ..seed import build_route

rng = random.Random(7)
TRACK_GEOMETRY_DIR = Path(__file__).resolve().parents[1] / "data" / "track_geometry"

# The simulated clock is in ABSOLUTE minutes-of-day (the timetable is too);
# the world starts at 09:30 on the launch day.
START_DAY_ZERO = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

STATE = {
    "lock": threading.RLock(),
    "clock": float(config.START_MIN),  # simulated minutes-of-day
    "tick_n": 0,
    "paused": False,
    "sim_speed": config.DEFAULT_SIM_SPEED,
    "last_update": 0.0,      # real unix ts of last live data refresh
    "trains": {},            # number -> live train dict
    "segments": {},          # (from_code, to_code) -> Segment (shared by all trains on that section)
    "providers": {"mode": "simulation_fallback", "active_real": 0, "configured_real": 0, "items": {}},
    "alerts": [],
    "alert_seq": 0,
    "pred_ring": {},         # (train, next_station) -> last predicted ETA (clock min)
    "snapshot": None,
    "started": False,
    "events": [],            # recent simulated event log (for the control room)
}


class Segment:
    """A directed track section. Weather fronts, congestion blockages and
    signal holds live here, so a single real-world incident automatically
    affects every train on that section."""

    __slots__ = ("a", "b", "w", "base_w", "c_base", "block", "block0",
                 "block_left", "block_total", "hold", "front_left",
                 "front_total", "front_peak", "weather_source", "weather_updated_at")

    def __init__(self, a, b):
        self.a, self.b = a, b
        self.base_w = rng.uniform(0.02, 0.12)
        self.w = self.base_w
        self.c_base = min(0.30, rng.betavariate(1.3, 6.5))
        self.block = 0.0
        self.block0 = 0.0
        self.block_left = 0.0
        self.block_total = 1.0
        self.hold = 0.0
        self.front_left = 0.0
        self.front_total = 1.0
        self.front_peak = 0.0
        self.weather_source = "simulation"
        self.weather_updated_at = 0.0

    @property
    def congestion(self):
        return min(1.0, self.c_base + self.block)


# --------------------------------------------------------------------- helpers
def _haversine_km(a_lat, a_lng, b_lat, b_lng):
    radius = 6371.0088
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lng - a_lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius * 2 * math.asin(min(1.0, math.sqrt(h)))


def _actual_track_geometry(number, fallback_stops):
    """Load an optional ordered GeoJSON LineString for one train.

    Files are named `<train-number>.geojson`. They must run from the service
    origin to destination (the loader reverses an obviously opposite line).
    """
    path = TRACK_GEOMETRY_DIR / f"{number}.geojson"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text())
        if payload.get("type") == "FeatureCollection":
            feature = next((row for row in payload.get("features", [])
                            if (row.get("geometry") or {}).get("type") == "LineString"), None)
            geometry = (feature or {}).get("geometry") or {}
        elif payload.get("type") == "Feature":
            geometry = payload.get("geometry") or {}
        else:
            geometry = payload
        if geometry.get("type") != "LineString":
            raise ValueError("expected a GeoJSON LineString")
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 2:
            raise ValueError("LineString has fewer than two coordinates")
        points = []
        for coordinate in coordinates:
            if not isinstance(coordinate, list) or len(coordinate) < 2:
                raise ValueError("invalid coordinate")
            lng, lat = float(coordinate[0]), float(coordinate[1])
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                raise ValueError("coordinate outside WGS84 bounds")
            if points and abs(points[-1]["lat"] - lat) < 1e-10 and abs(points[-1]["lng"] - lng) < 1e-10:
                continue
            points.append({"lat": lat, "lng": lng, "codes": set()})

        source_station = ST.BY_CODE[fallback_stops[0]]
        destination_station = ST.BY_CODE[fallback_stops[-1]]
        direct = _haversine_km(points[0]["lat"], points[0]["lng"], source_station["lat"], source_station["lng"])
        reverse = _haversine_km(points[-1]["lat"], points[-1]["lng"], source_station["lat"], source_station["lng"])
        if reverse < direct:
            points.reverse()
        source_offset = _haversine_km(points[0]["lat"], points[0]["lng"], source_station["lat"], source_station["lng"])
        destination_offset = _haversine_km(points[-1]["lat"], points[-1]["lng"], destination_station["lat"], destination_station["lng"])
        if source_offset > 30 or destination_offset > 30:
            raise ValueError(f"endpoints are {source_offset:.1f}/{destination_offset:.1f} km from service endpoints")

        cumulative = [0.0]
        for previous, current in zip(points, points[1:]):
            step = _haversine_km(previous["lat"], previous["lng"], current["lat"], current["lng"])
            if step > 50:
                raise ValueError(f"track geometry contains a {step:.1f} km gap")
            cumulative.append(cumulative[-1] + step)
        return {
            "points": points,
            "km": cumulative,
            "stop_indices": [],
            "source": "actual_track_geojson",
            "track_snapped": True,
            "source_file": path.name,
        }
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        print(f"[track] {path.name} rejected ({exc}); using timetable station chain")
        return None


def _visual_geometry(number, fallback_stops):
    """Build the best available visual route geometry.

    The uploaded routes do not contain track vertices, but they do contain many
    pass-through station coordinates between the representative ETA halts. A
    station-chain polyline is therefore substantially closer to the railway
    than one straight chord per demo leg while remaining honest about scope.
    """
    actual = _actual_track_geometry(number, fallback_stops)
    if actual:
        return actual
    try:
        rows = db.query(
            "SELECT station_code FROM catalog_stops "
            "WHERE train_number=? AND in_service_route=1 ORDER BY service_seq",
            (number,),
        )
    except Exception:
        rows = []

    codes = [row["station_code"] for row in rows] or list(fallback_stops)
    points = []
    for code in codes:
        station = ST.BY_CODE.get(code)
        if not station or not station.get("coordinate_valid"):
            continue
        lat, lng = float(station["lat"]), float(station["lng"])
        if points and abs(points[-1]["lat"] - lat) < 1e-8 and abs(points[-1]["lng"] - lng) < 1e-8:
            points[-1]["codes"].add(code)
            continue
        points.append({"lat": lat, "lng": lng, "codes": {code}})

    if len(points) < 2:
        points = [
            {"lat": float(ST.BY_CODE[code]["lat"]),
             "lng": float(ST.BY_CODE[code]["lng"]), "codes": {code}}
            for code in fallback_stops
        ]

    cumulative = [0.0]
    for previous, current in zip(points, points[1:]):
        cumulative.append(cumulative[-1] + _haversine_km(
            previous["lat"], previous["lng"], current["lat"], current["lng"],
        ))

    stop_indices, cursor = [], 0
    for stop in fallback_stops:
        equivalents = ST.equivalent_codes(stop)
        found = next((index for index in range(cursor, len(points))
                      if points[index]["codes"] & equivalents), None)
        if found is None:
            stop_indices = []
            break
        stop_indices.append(found)
        cursor = found

    return {
        "points": points,
        "km": cumulative,
        "stop_indices": stop_indices,
        "source": "uploaded_timetable_station_chain" if rows else "representative_halts",
        "track_snapped": False,
    }


def reported_position(t, now=None):
    """Return a recent raw RailRadar coordinate, otherwise None."""
    point = t.get("telemetry_position")
    updated = t.get("telemetry_updated_at", 0.0)
    if not point or not updated:
        return None
    age = max(0.0, (time.time() if now is None else now) - updated)
    if age > config.RAILRADAR_REPORTED_POSITION_TTL_SECONDS:
        return None
    return float(point["lat"]), float(point["lng"])


def geometry_position_km(t):
    """Distance along the visual geometry that corresponds to model state."""
    geometry = t.get("visual_geometry") or {}
    points, distances = geometry.get("points") or [], geometry.get("km") or []
    if len(points) < 2 or len(distances) != len(points):
        return None

    indices = geometry.get("stop_indices") or []
    if len(indices) == len(t["stops"]):
        leg = min(t["leg"], len(indices) - 2)
        model_a, model_b = t["km"][leg], t["km"][leg + 1]
        fraction = 0.0 if model_b <= model_a else max(0.0, min(1.0, (t["pos"] - model_a) / (model_b - model_a)))
        start, end = distances[indices[leg]], distances[indices[leg + 1]]
        return start + fraction * max(0.0, end - start)
    if geometry.get("track_snapped"):
        # The simulator's pos is kilometres travelled. On a true ordered track
        # LineString, use that distance directly (Turf `along` equivalent).
        return max(0.0, min(float(t["pos"]), distances[-1]))

    fraction = max(0.0, min(1.0, t["pos"] / max(t["km"][-1], 1e-6)))
    return fraction * distances[-1]


def _geometry_position(t):
    geometry = t.get("visual_geometry") or {}
    points, distances = geometry.get("points") or [], geometry.get("km") or []
    target = geometry_position_km(t)
    if target is None:
        return None

    index = max(0, min(len(points) - 2, bisect.bisect_right(distances, target) - 1))
    a, b = distances[index], distances[index + 1]
    fraction = 0.0 if b <= a else max(0.0, min(1.0, (target - a) / (b - a)))
    p0, p1 = points[index], points[index + 1]
    return (
        p0["lat"] + (p1["lat"] - p0["lat"]) * fraction,
        p0["lng"] + (p1["lng"] - p0["lng"]) * fraction,
    )


def iso(minutes):
    return (START_DAY_ZERO + timedelta(minutes=minutes)).strftime("%H:%M")


def iso_full(minutes):
    return (START_DAY_ZERO + timedelta(minutes=minutes)).strftime("%d %b %Y, %H:%M")


def latlng(t):
    """Best available display position with explicit provenance.

    A recent provider coordinate wins. Simulation otherwise follows the dense
    uploaded timetable station chain, falling back to representative-halt
    interpolation only when no usable catalogue geometry exists.
    """
    provider_point = reported_position(t)
    if provider_point:
        return provider_point
    geometry_point = _geometry_position(t)
    if geometry_point:
        return geometry_point

    stops, km = t["stops"], t["km"]
    if t["at_station"]:
        station = ST.BY_CODE[stops[t["leg"]]]
        return station["lat"], station["lng"]
    index = t["leg"]
    a, b = km[index], km[index + 1]
    fraction = 0.0 if b <= a else (t["pos"] - a) / (b - a)
    start, end = ST.BY_CODE[stops[index]], ST.BY_CODE[stops[index + 1]]
    return (
        start["lat"] + (end["lat"] - start["lat"]) * fraction,
        start["lng"] + (end["lng"] - start["lng"]) * fraction,
    )


def sched_pos_at(t, tau):
    """Invert the schedule: position (km, leg) the train should be at at
    clock time `tau` if it were running on time. Used for seeding."""
    for i in range(len(t["stops"]) - 1):
        arr, dep = t["sched_arr"][i], t["sched_dep"][i]
        if tau <= dep + t["travel"][i]:
            if tau <= dep:
                return t["km"][i], i
            f = (tau - dep) / t["travel"][i]
            return t["km"][i] + f * (t["km"][i + 1] - t["km"][i]), i
    return t["km"][-1], len(t["stops"]) - 1


# ---------------------------------------------------------------------- init
def init_state():
    if STATE["started"]:
        return
    S = STATE
    S["clock"] = float(config.START_MIN)
    for number, stops in TR.ROUTES.items():
        meta = TR.BY_NUMBER[number]
        km, travel, sched_arr, dw = build_route(number, stops, meta["avg_speed"], meta["calib"])
        sched_dep = [sched_arr[i] + (0 if i == len(stops) - 1 else dw)
                     for i in range(len(stops))]
        visual_geometry = _visual_geometry(number, stops)
        t = {
            "number": number, "name": meta["name"], "ttype": meta["ttype"],
            "color": TR.TRAIN_COLORS[number], "coaches": meta["coaches"],
            "priority": meta["priority"],
            "from_code": stops[0], "to_code": stops[-1],
            "from_name": ST.BY_CODE[stops[0]]["name"], "to_name": ST.BY_CODE[stops[-1]]["name"],
            "stops": stops, "stop_names": [ST.BY_CODE[c]["name"] for c in stops],
            "km": km, "travel": travel, "sched_arr": sched_arr, "sched_dep": sched_dep,
            "visual_geometry": visual_geometry,
            "dwell_base": dw, "avg_speed": meta["avg_speed"],
            "pos": 0.0, "leg": 0, "at_station": False, "dwell_left": 0.0,
            "dwell_total": 0.0, "epoch": 0.0,
            "slow_order": rng.uniform(0.90, 1.10), "speed": meta["avg_speed"] * 0.8,
            "platforms": {},
            "last_station_code": stops[0], "last_station_time": -30.0,
            "delay": 0.0,
            "telemetry_source": "simulation", "telemetry_updated_at": 0.0,
            "telemetry_fetched_at": 0.0, "telemetry_position": None,
            "railradar": None, "weather_live": None,
        }
        # Seed mid-route: each train starts ~delay0 minutes behind schedule so
        # the demo opens with a believable mix of on-time / late services.
        delay0 = rng.uniform(0, 14) * (1.55 - meta["priority"])
        pos, leg = sched_pos_at(t, S["clock"] - delay0)
        t["pos"], t["leg"] = pos, leg
        if pos <= t["km"][leg] + 1e-6:
            t["at_station"] = True
            t["dwell_left"] = rng.uniform(1, 4)
            t["dwell_total"] = 5.0
        t["last_station_code"] = t["stops"][leg]
        t["last_station_time"] = S["clock"] - rng.uniform(4, 25)
        S["trains"][number] = t
        for i in range(len(stops) - 1):
            key = (stops[i], stops[i + 1])
            if key not in S["segments"]:
                S["segments"][key] = Segment(stops[i], stops[i + 1])
    S["started"] = True
    S["last_update"] = 0.0  # engine sets real ts on first tick
