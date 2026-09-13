"""Journey view assembly: one server-side join of every provider.

Sources joined per request:
  RailRadar      live fix, speed, delay, running state
  catalogue      FULL ordered route (all stations, scheduled times) for 5,139 trains
  Overpass       OSM track snap of the raw fix (± guard)
  OpenWeather    weather at the fix + next halts
  Nominatim      keyless halt geocoding (for stop weather)
  Open-Meteo     keyless elevation profile fix → next halts
  OpenTopography COP30 point elevation cross-check
  RandomForest   delay drift → final ETA = schedule + live delay + drift
"""
from __future__ import annotations

import time

from fastapi import HTTPException

from . import catalog, ml
from .providers.manager import ProviderManager


def build(manager: ProviderManager, number: str, *, force: bool = False) -> dict:
    try:
        data = manager.live(number, force=force) or {}
    except HTTPException:
        data = {}
    except Exception:  # noqa: BLE001 - provider hiccup must not kill the board
        data = {}
    cat = catalog.get(number)
    if not data and not cat:
        raise HTTPException(status_code=404,
                            detail=f"No live data and {number} is not in the uploaded catalogue")

    status = str(data.get("status") or "unknown").lower()
    is_live = bool(data.get("isLive", status == "running"))
    running = status == "running" and is_live
    delay = _f(data.get("delayMinutes"))
    loc = data.get("currentLocation") or {}
    raw_coords = _coords(loc.get("coordinates"))
    speed = _f(loc.get("speedKmh"))
    train_meta = data.get("train") or {}

    # --- route: catalogue first (complete), RailRadar halts as fallback -----
    if cat and cat["halt_stops"]:
        halts = [
            {
                "seq": s["seq"], "code": s["code"], "name": s["name"],
                "distance_km": s["km"],
                "sched": _label(s["sched"], s["day"]),
                "sched_min": None if s["sched"] is None else s["sched"] + (s["day"] - 1) * 1440,
                "day": s["day"], "passed": False, "next": False,
                "lat": None, "lng": None, "weather": None,
                "drift_min": None, "eta_min": None, "eta_final_min": None,
            }
            for s in cat["halt_stops"]
        ]
        route = []
    else:
        route = [r for r in (data.get("route") or []) if isinstance(r, dict)]
        halts = _normalise_halts(route)

    total_km = _f(train_meta.get("distance")) or (cat or {}).get("km") \
        or max((h["distance_km"] for h in halts), default=0.0)
    pos_km = _route_distance(data, route, halts) if route else _catalog_position(data, halts)
    progress = round(min(1.0, pos_km / total_km), 4) if total_km else 0.0
    if not route and running:
        # catalogue board: trust the clock over (interpolated) distances
        _mark_by_clock(halts, delay, data)

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

    weather = manager.weather_at(position["lat"], position["lng"]) if position else None
    cop30 = manager.cop30_at(position["lat"], position["lng"]) if position else None
    current_severity = (weather or {}).get("severity", 0.0) or 0.0

    # --- upcoming stops: geocode + weather + RF drift + final ETA ------------
    upcoming = [h for h in halts if not h["passed"]]
    if running:
        for index, halt in enumerate(upcoming[:4]):
            if halt.get("lat") is None:
                geo = manager.geocode_halt(halt["name"])
                if geo:
                    halt["lat"], halt["lng"] = geo["lat"], geo["lng"]
            if index < 3 and halt.get("lat") is not None:
                halt["weather"] = manager.weather_at(halt["lat"], halt["lng"])
        for halt in upcoming:
            if halt["sched_min"] is None:
                continue
            halt["eta_min"] = halt["sched_min"] + delay
            leg_km = max(0.0, halt["distance_km"] - pos_km)
            remaining_km = max(0.0, total_km - halt["distance_km"])
            severity = (halt.get("weather") or {}).get("severity", current_severity) or current_severity
            halt["drift_min"] = ml.predict_drift(
                carried_delay_min=delay, leg_km=leg_km, remaining_km=remaining_km,
                weather_severity=severity, scheduled_min=halt["sched_min"])
            halt["eta_final_min"] = round(halt["eta_min"] + halt["drift_min"], 1)

    # --- elevation profile: fix → next three halts ---------------------------
    profile = {"points": [], "elevations": []}
    if position and upcoming:
        anchors = [(position["lat"], position["lng"])]
        anchors += [(h["lat"], h["lng"]) for h in upcoming[:3] if h.get("lat") is not None]
        if len(anchors) >= 2:
            points = _densify(anchors, max_points=12)
            profile = {"points": [{"lat": round(a, 5), "lng": round(b, 5)} for a, b in points],
                       "elevations": manager.elevation_profile(points)}

    if running:
        manager.observe(number, train_meta.get("name") or (cat or {}).get("name") or f"Train {number}")

    return {
        "train": {
            "number": str(train_meta.get("number") or number),
            "name": train_meta.get("name") or (cat or {}).get("name") or f"Train {number}",
            "type": (cat or {}).get("type", ""),
            "route_ends": [f"{(cat or {}).get('from_name', '')} ({(cat or {}).get('from_code', '')})",
                           f"{(cat or {}).get('to_name', '')} ({(cat or {}).get('to_code', '')})"] if cat else None,
            "running_days": (cat or {}).get("days"),
            "status": status if data else "no_live_feed",
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
        "model": ml.model_card(),
        "catalogue": {"in_catalogue": cat is not None,
                      "stops": len(halts),
                      "source": f"uploaded Indian timetable ({catalog.stats()['trains']:,} services)"},
        "providers": manager.public_status(),
        "fetched_at": time.time(),
    }


# --------------------------------------------------------------------- helpers
def _mark_by_clock(halts: list[dict], delay: float, data: dict) -> None:
    """Mark passed/next from the timetable clock (day-aware) + live delay."""
    elapsed = _elapsed_min(data)
    for halt in halts:
        halt["passed"] = (halt["sched_min"] is not None
                          and halt["sched_min"] + delay <= elapsed)
        halt["next"] = False
    remaining = [h for h in halts if not h["passed"]]
    if remaining:
        remaining[0]["next"] = True


def _elapsed_min(data: dict) -> float:
    """Minutes since midnight of the journey's start date, in IST."""
    from datetime import datetime, timedelta, timezone
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist)
    start = data.get("startDate")
    if start:
        try:
            day0 = datetime.fromisoformat(str(start)).astimezone(ist).replace(
                hour=0, minute=0, second=0, microsecond=0)
            return (now - day0).total_seconds() / 60.0
        except ValueError:
            pass
    return now.hour * 60 + now.minute + now.second / 60.0


def _catalog_position(data: dict, halts: list[dict]) -> float:
    """Progress along the catalogue route from RailRadar halt distances."""
    loc = data.get("currentLocation") or {}
    progress = max(0.0, min(1.0, _f(loc.get("segmentProgress"))))
    prev, nxt = data.get("previousHalt") or {}, data.get("nextHalt") or {}
    by_code = {h["code"]: h for h in halts}
    d0 = by_code.get(str(prev.get("code") or ""), {}).get("distance_km")
    d1 = by_code.get(str(nxt.get("code") or ""), {}).get("distance_km")
    if d0 is None:
        d0 = _f(prev.get("distance"), -1)
    if d1 is None:
        d1 = _f(nxt.get("distance"), -1)
    if d0 is None or d0 < 0 or d1 is None or d1 <= d0:
        return 0.0
    for halt in halts:
        halt["passed"] = halt["distance_km"] <= d0 + 1e-6
    remaining = [h for h in halts if not h["passed"]]
    if remaining:
        remaining[0]["next"] = True
    return d0 + progress * (d1 - d0)


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
            "day": 1, "passed": False, "next": False,
            "lat": None, "lng": None, "weather": None,
            "drift_min": None, "eta_min": None, "eta_final_min": None,
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


def _label(minutes: int | None, day: int) -> str | None:
    if minutes is None:
        return None
    hh, mm = divmod(minutes, 60)
    return f"{hh:02d}:{mm:02d}" + (f" +{day - 1}d" if day > 1 else "")


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
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return (round(lat, 6), round(lng, 6))


def _sched(row: dict):
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


def _age(stamp):
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
