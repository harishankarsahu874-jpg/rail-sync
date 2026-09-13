"""Journey view assembly: one server-side join of every provider.

The browser asks for ONE url per refresh; this module fans out to RailRadar
(telemetry), Overpass (track snap), OpenWeather (stop weather), Nominatim
(halt coordinates), Open-Meteo (elevation profile) and OpenTopography
(COP30 cross-check), then returns a single partial-success JSON view.
"""
from __future__ import annotations

import time

from .providers.manager import ProviderManager


def build(manager: ProviderManager, number: str, *, force: bool = False) -> dict:
    data = manager.live(number, force=force)

    status = str(data.get("status") or "unknown").lower()
    is_live = bool(data.get("isLive", status == "running"))
    running = status == "running" and is_live
    delay = _f(data.get("delayMinutes"))
    loc = data.get("currentLocation") or {}
    raw_coords = _coords(loc.get("coordinates"))
    speed = _f(loc.get("speedKmh"))
    route = [r for r in (data.get("route") or []) if isinstance(r, dict)]
    train_meta = data.get("train") or {}

    halts = _normalise_halts(route)
    total_km = _f(train_meta.get("distance")) or max((h["distance_km"] for h in halts), default=0.0)
    pos_km = _route_distance(data, route, halts)
    progress = round(min(1.0, pos_km / total_km), 4) if total_km else 0.0

    # --- live position + honest OSM track snap -------------------------------
    position = None
    if raw_coords and running:
        snap = manager.snap_to_rail(raw_coords[0], raw_coords[1])
        inside = snap is not None
        position = {
            "lat": round(snap["lat"], 6) if inside else raw_coords[0],
            "lng": round(snap["lng"], 6) if inside else raw_coords[1],
            "snapped": inside,
            "offset_m": snap["offset_m"] if inside else None,
            "source": "osm_track_snap" if inside else "provider_raw",
            "raw_lat": raw_coords[0], "raw_lng": raw_coords[1],
            "track": snap["track"] if inside else None,
        }

    # --- weather + premium elevation at the live fix --------------------------
    weather = manager.weather_at(position["lat"], position["lng"]) if position else None
    cop30 = manager.cop30_at(position["lat"], position["lng"]) if position else None

    # --- upcoming stops: geocode (keyless) then per-stop weather --------------
    upcoming = [h for h in halts if not h["passed"]]
    for index, halt in enumerate(upcoming[:4]):
        if halt.get("lat") is None:
            geo = manager.geocode_halt(halt["name"])
            if geo:
                halt["lat"], halt["lng"] = geo["lat"], geo["lng"]
        if index < 3 and halt.get("lat") is not None:
            halt["weather"] = manager.weather_at(halt["lat"], halt["lng"])
        halt["eta_min"] = None if halt["sched_min"] is None else halt["sched_min"] + delay
        halt["delay_min"] = delay

    # --- elevation profile: current fix → next three halts -------------------
    profile = {"points": [], "elevations": []}
    if position and upcoming:
        anchors = [(position["lat"], position["lng"])]
        for halt in upcoming[:3]:
            if halt.get("lat") is not None:
                anchors.append((halt["lat"], halt["lng"]))
        points = _densify(anchors, max_points=12)
        elevations = manager.elevation_profile(points)
        profile = {"points": [{"lat": round(a, 5), "lng": round(b, 5)} for a, b in points],
                   "elevations": elevations}

    return {
        "train": {
            "number": str(train_meta.get("number") or number),
            "name": train_meta.get("name") or f"Train {number}",
            "status": status,
            "running": running,
            "is_live": is_live,
            "delay_min": round(delay, 1),
            "speed_kmh": round(speed, 1),
            "progress": progress,
            "pos_km": round(pos_km, 1),
            "total_km": round(total_km, 1),
            "start_date": data.get("startDate"),
            "last_updated": data.get("lastUpdatedAt"),
            "age_s": _age(data.get("lastUpdatedAt")),
            "position": position,
        },
        "halts": halts,
        "weather": weather,
        "elevation": {"cop30": cop30, "profile": profile},
        "providers": manager.public_status(),
        "fetched_at": time.time(),
    }


# --------------------------------------------------------------------- helpers
def _normalise_halts(route: list[dict]) -> list[dict]:
    halts = []
    for index, row in enumerate(route):
        name = str(row.get("stationName") or row.get("name") or row.get("station") or f"Stop {index + 1}")
        label, minutes = _sched(row)
        halts.append({
            "seq": int(_f(row.get("sequence"), index + 1)),
            "code": str(row.get("stationCode") or row.get("code") or ""),
            "name": name.upper(),
            "distance_km": _f(row.get("distance")),
            "sched": label,
            "sched_min": minutes,
            "passed": False, "next": False,
            "lat": None, "lng": None, "weather": None,
            "eta_min": None, "delay_min": None,
        })
    return halts


def _route_distance(data: dict, route: list[dict], halts: list[dict]) -> float:
    loc = data.get("currentLocation") or {}
    progress = max(0.0, min(1.0, _f(loc.get("segmentProgress"))))
    prev, nxt = data.get("previousHalt") or {}, data.get("nextHalt") or {}
    d0, d1 = _f(prev.get("distance"), -1), _f(nxt.get("distance"), -1)
    if d0 < 0 or d1 <= d0:
        seq = int(_f(loc.get("sequence"), 0))
        idx = next((i for i, r in enumerate(route) if int(_f(r.get("sequence"), -1)) == seq), -1)
        if idx >= 0:
            d0 = halts[idx]["distance_km"] if idx < len(halts) else 0.0
            d1 = halts[idx + 1]["distance_km"] if idx + 1 < len(halts) else d0
    raw = d0 + progress * max(0.0, d1 - d0) if d0 >= 0 else 0.0
    for halt in halts:
        halt["passed"] = halt["distance_km"] <= raw
    remaining = [h for h in halts if not h["passed"]]
    if remaining:
        remaining[0]["next"] = True
    return max(0.0, raw)


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


def _coords(raw):
    if not isinstance(raw, dict):
        return None
    lat, lng = _f(raw.get("lat", raw.get("latitude")), 999), _f(raw.get("lng", raw.get("lon", raw.get("longitude"))), 999)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (abs(lat) > 90):
        return None
    return (round(lat, 6), round(lng, 6))


def _sched(row: dict) -> tuple[str | None, int | None]:
    """RailRadar schedules arrive as ISO datetimes or HH:MM; accept both.

    Returns (display label "HH:MM", minutes-of-day) so ETAs can add the live
    delay; midnight crossings simply wrap past 1440 and the UI shows "+1d".
    """
    for key in ("arrival", "scheduledArrival", "departure", "scheduledDeparture", "time"):
        value = row.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        label = value.strip()
        if "T" in label:
            try:
                from datetime import datetime
                parsed = datetime.fromisoformat(label.replace("Z", "+00:00"))
                return parsed.strftime("%H:%M"), parsed.hour * 60 + parsed.minute
            except ValueError:
                return label, None
        parts = label.split(":")
        try:
            return label, int(parts[0]) * 60 + int(parts[1])
        except (ValueError, IndexError):
            return label, None
    return None, None


def _age(stamp) -> int | None:
    if not stamp:
        return None
    try:
        from datetime import datetime
        parsed = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        return max(0, round(time.time() - parsed.timestamp()))
    except (TypeError, ValueError):
        return None


def _f(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(default)
