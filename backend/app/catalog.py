"""Uploaded Indian timetable catalogue (5,139 services, ordered routes).

Loaded lazily from the committed gzip parts on first use. Powers:
  * search over EVERY catalogued train in India,
  * the full station board (scheduled times + distances) for any train,
    even when today's journey is not running,
  * route distances that let the RF model reason per leg.
"""
from __future__ import annotations

import gzip
import json
import threading
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data" / "train_catalog"

_LOCK = threading.Lock()
_TRAINS: dict[str, dict] | None = None


def _minutes(hhmmss: str | None) -> int | None:
    if not hhmmss:
        return None
    parts = str(hhmmss).split(":")
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except (ValueError, IndexError):
        return None


def _stop_label(stop: dict) -> str | None:
    if stop.get("sched") is None:
        return None
    hh, mm = divmod(stop["sched"], 60)
    day = stop.get("day", 1)
    return f"{hh:02d}:{mm:02d}" + (f" +{day - 1}d" if day > 1 else "")


def _synthesise_km(stops: list[dict], total_km: float) -> None:
    """Uploads carry distance=0 on most rows — interpolate km from the clock.

    Absolute minutes (day-aware) are a good proxy for distance on Indian
    timetables, so each row gets total_km * t/T; rows that DO have a real
    distance are kept as-is.
    """
    if not stops or total_km <= 0:
        return
    if any(s["km"] > 0 for s in stops[1:]):
        return
    t0 = None
    for s in stops:
        if s["sched"] is not None:
            t0 = s["sched"] + (s["day"] - 1) * 1440
            break
    if t0 is None:
        return
    span = 0
    for s in stops:
        if s["sched"] is not None:
            span = max(span, s["sched"] + (s["day"] - 1) * 1440 - t0)
    if span <= 0:
        return
    for s in stops:
        if s["sched"] is None:
            s["km"] = 0.0
        else:
            s["km"] = round(total_km * (s["sched"] + (s["day"] - 1) * 1440 - t0) / span, 2)


def _load() -> dict[str, dict]:
    global _TRAINS
    with _LOCK:
        if _TRAINS is not None:
            return _TRAINS
        trains: dict[str, dict] = {}
        for part in sorted(DATA_DIR.glob("trains_part*.json.gz")):
            try:
                with gzip.open(part, "rt", encoding="utf-8") as handle:
                    rows = json.load(handle)
            except (OSError, json.JSONDecodeError):
                continue
            for row in rows if isinstance(rows, list) else []:
                number = str(row.get("trainNumber") or "").strip()
                if not number.isdigit():
                    continue
                stops = []
                for stop in row.get("completeOrderedRoute") or []:
                    arr = _minutes(stop.get("arrivalTime"))
                    dep = _minutes(stop.get("departureTime"))
                    sched = arr if arr is not None else dep
                    day = int(stop.get("journeyDay") or 1)
                    # a real halt has a dwell (arrival != departure) or is an endpoint
                    is_stop = arr is None or dep is None or arr != dep
                    stops.append({
                        "seq": int(stop.get("sequence") or len(stops) + 1),
                        "code": str(stop.get("stationCode") or ""),
                        "name": str(stop.get("stationName") or "").upper(),
                        "sched": sched,
                        "day": day,
                        "km": float(stop.get("distance") or 0.0),
                        "is_stop": is_stop,
                    })
                total_km = float(row.get("overallDistanceKm") or 0.0)
                _synthesise_km(stops, total_km)
                days = row.get("runningDays") or {}
                trains[number] = {
                    "number": number,
                    "name": str(row.get("trainName") or f"Train {number}").title(),
                    "type": str(row.get("type") or ""),
                    "from_code": (row.get("source") or {}).get("code", ""),
                    "from_name": (row.get("source") or {}).get("name", "").title(),
                    "to_code": (row.get("destination") or {}).get("code", ""),
                    "to_name": (row.get("destination") or {}).get("name", "").title(),
                    "km": total_km or (stops[-1]["km"] if stops else 0.0),
                    "days": "".join(k[0] for k, v in days.items() if v) or "—",
                    "stops": stops,
                    "halt_stops": [s for s in stops if s["is_stop"]],
                }
        _TRAINS = trains
        return trains


def count_at(code: str) -> int:
    """Uncapped number of catalogued services halting at a station code."""
    return len(trains_at(code, limit=10 ** 9))


def stats() -> dict:
    trains = _load()
    return {"trains": len(trains), "stops": sum(len(t["stops"]) for t in trains.values())}


_INDEX: dict[str, list[dict]] | None = None
_INDEX_LOCK = threading.Lock()


def trains_at(code: str, limit: int = 40) -> list[dict]:
    """Every catalogued service that halts at a station code (all-India index)."""
    global _INDEX
    with _INDEX_LOCK:
        if _INDEX is None:
            index: dict[str, list[dict]] = {}
            for train in _load().values():
                for stop in train["halt_stops"]:
                    index.setdefault(stop["code"], []).append({
                        "number": train["number"], "name": train["name"],
                        "from": train["from_code"], "to": train["to_code"],
                        "days": train["days"],
                        "sched": _stop_label(stop),
                    })
            _INDEX = index
        rows = _INDEX.get(str(code).upper(), [])
    return rows[:limit]


def get(number: str) -> dict | None:
    return _load().get(number)


def search(query: str, limit: int = 8) -> list[dict]:
    needle = query.strip().lower()
    if not needle:
        return []
    hits = []
    for train in _load().values():
        if needle in train["number"] or needle in train["name"].lower():
            hits.append(_summary(train))
            if len(hits) >= limit:
                break
    return hits


def _summary(train: dict) -> dict:
    return {
        "number": train["number"], "name": train["name"], "type": train["type"],
        "from": train["from_code"], "to": train["to_code"],
        "km": round(train["km"]), "days": train["days"],
        "stops": len(train["halt_stops"]),
    }
