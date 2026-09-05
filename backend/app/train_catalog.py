"""Incremental timetable catalogue built from the uploaded train JSON parts.

The six trains in `data/trains.py` remain the deliberately small *live
simulation fleet*.  This module imports every supplied scheduled train into
separate SQLite tables for fast passenger search and route lookup. Raw parts
are retained as deterministic gzip files, and every normalisation decision is
reported instead of silently pretending imperfect source rows are clean.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path

from . import db
from .data import stations as ST

CATALOG_DIR = Path(__file__).resolve().parent / "data" / "train_catalog"
MANIFEST_PATH = CATALOG_DIR / "manifest.json"
IMPORT_SCHEMA_VERSION = "train-catalog-v2"
DAY_ORDER = ("SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT")
DAY_BITS = {day: 1 << index for index, day in enumerate(DAY_ORDER)}
LOCAL_TYPES = {"PASS", "MEMU", "DEMU"}
_STATS_CACHE: dict | None = None


def part_files() -> list[Path]:
    return sorted(CATALOG_DIR.glob("*.json.gz")) if CATALOG_DIR.exists() else []


def catalogue_signature() -> str:
    digest = hashlib.sha256()
    digest.update(IMPORT_SCHEMA_VERSION.encode())
    digest.update(ST.CATALOGUE_SHA256.encode())
    for path in part_files():
        digest.update(path.name.encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _stored_meta(key: str):
    rows = db.query("SELECT value FROM app_meta WHERE key=?", (key,))
    return rows[0]["value"] if rows else None


def needs_rebuild() -> bool:
    db.init()
    files = part_files()
    if not files:
        return False
    if _stored_meta("train_catalog_signature") != catalogue_signature():
        return True
    expected = 0
    if MANIFEST_PATH.exists():
        try:
            expected = int(json.loads(MANIFEST_PATH.read_text()).get("totals", {}).get("trains", 0))
        except (ValueError, TypeError, json.JSONDecodeError):
            expected = 0
    actual = db.query("SELECT COUNT(*) AS n FROM catalog_trains")[0]["n"]
    return actual == 0 or (expected and actual != expected)


def _clock_minutes(value, journey_day):
    if not value:
        return None
    try:
        parts = str(value).split(":")
        hour, minute = int(parts[0]), int(parts[1])
        second = int(parts[2]) if len(parts) > 2 else 0
        day = max(1, int(journey_day or 1))
        if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
            return None
        return round((day - 1) * 1440 + hour * 60 + minute + second / 60, 2)
    except (TypeError, ValueError, IndexError):
        return None


def _days_mask(running_days) -> int:
    running_days = running_days or {}
    return sum(bit for day, bit in DAY_BITS.items() if bool(running_days.get(day)))


def running_days(mask: int) -> list[str]:
    return [day for day in DAY_ORDER if int(mask or 0) & DAY_BITS[day]]


def _normalise_route(train: dict):
    """Mark the passenger-facing source→destination slice of a raw route.

    255 supplied routes contain untimed prefix rows before their declared
    source. Those rows remain in SQLite for audit but are excluded from the
    service route. If the declared destination does not occur *after* the
    source, we retain source→end and expose an explicit quality warning.
    """
    raw_route = train.get("completeOrderedRoute") or []
    source_code = str((train.get("source") or {}).get("code") or "").strip().upper()
    destination_code = str((train.get("destination") or {}).get("code") or "").strip().upper()
    codes = [str(stop.get("stationCode") or "").strip().upper() for stop in raw_route]
    quality: list[str] = []

    try:
        start = codes.index(source_code)
    except ValueError:
        start = 0
        quality.append("source_missing_from_route")

    destination_positions = [index for index, code in enumerate(codes) if code == destination_code and index >= start]
    if destination_positions:
        end = destination_positions[0]
    else:
        end = len(raw_route) - 1
        if destination_code not in codes:
            quality.append("destination_missing_from_route")
        else:
            quality.append("destination_not_after_source")

    if start > 0:
        quality.append("prefix_trimmed")
    if end < len(raw_route) - 1:
        quality.append("suffix_trimmed")
    if float(train.get("overallDistanceKm") or 0) <= 0:
        quality.append("overall_distance_missing")
    if not quality:
        quality.append("clean")
    return start, end, quality


def _is_scheduled_stop(train_type: str, code: str, source: str, destination: str, arrival, departure) -> bool:
    if code in {source, destination}:
        return True
    if train_type.upper() in LOCAL_TYPES:
        return bool(arrival or departure)
    if not arrival and not departure:
        return False
    if not arrival or not departure:
        return True
    return str(arrival) != str(departure)


def _manifest_parts() -> dict[str, dict]:
    if not MANIFEST_PATH.exists():
        return {}
    try:
        return {part["file"]: part for part in json.loads(MANIFEST_PATH.read_text()).get("parts", [])}
    except (KeyError, TypeError, json.JSONDecodeError):
        return {}


def rebuild(force: bool = False, verbose: bool = True) -> dict:
    """Atomically rebuild the SQLite search index when installed parts change."""
    global _STATS_CACHE
    db.init()
    files = part_files()
    if not files:
        _STATS_CACHE = {
            "parts": 0, "trains": 0, "raw_route_rows": 0,
            "service_route_rows": 0, "scheduled_stops": 0,
            "status": "no_parts_installed",
        }
        return _STATS_CACHE
    if not force and not needs_rebuild():
        return stats()

    manifest = _manifest_parts()
    signature = catalogue_signature()
    seen_numbers: dict[str, str] = {}
    quality_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    all_route_codes: set[str] = set()
    train_total = raw_total = service_total = scheduled_total = 0
    train_rows: list[tuple] = []
    stop_rows: list[tuple] = []

    for path in files:
        payload = json.loads(gzip.decompress(path.read_bytes()))
        if not isinstance(payload, list):
            raise ValueError(f"{path.name}: root must be a list")
        source_sha = manifest.get(path.name, {}).get("source_sha256", "")
        for train in payload:
            number = str(train.get("trainNumber") or "").strip()
            if not number:
                raise ValueError(f"{path.name}: train without number")
            if number in seen_numbers:
                raise ValueError(f"duplicate train {number} in {seen_numbers[number]} and {path.name}")
            seen_numbers[number] = path.name

            name = str(train.get("trainName") or number).strip()
            train_type = str(train.get("type") or "Unknown").strip()
            source = train.get("source") or {}
            destination = train.get("destination") or {}
            source_code = str(source.get("code") or "").strip().upper()
            destination_code = str(destination.get("code") or "").strip().upper()
            raw_route = train.get("completeOrderedRoute") or []
            start, end, quality = _normalise_route(train)
            quality_counts.update(quality)
            type_counts[train_type] += 1

            service_count = max(0, end - start + 1)
            scheduled_count = 0
            source_departure = destination_arrival = None
            source_departure_min = destination_arrival_min = None

            for raw_index, stop in enumerate(raw_route):
                raw_seq = raw_index + 1
                code = str(stop.get("stationCode") or "").strip().upper()
                station_name = str(stop.get("stationName") or code).strip()
                arrival = stop.get("arrivalTime")
                departure = stop.get("departureTime")
                journey_day = int(stop.get("journeyDay") or 1)
                arrival_min = _clock_minutes(arrival, journey_day)
                departure_min = _clock_minutes(departure, journey_day)
                in_service = start <= raw_index <= end
                service_seq = raw_index - start + 1 if in_service else None
                is_stop = bool(
                    in_service
                    and _is_scheduled_stop(
                        train_type, code, source_code, destination_code, arrival, departure
                    )
                )
                if is_stop:
                    scheduled_count += 1
                if raw_index == start:
                    source_departure = departure or arrival
                    source_departure_min = departure_min if departure_min is not None else arrival_min
                if raw_index == end and code == destination_code:
                    destination_arrival = arrival or departure
                    destination_arrival_min = arrival_min if arrival_min is not None else departure_min

                all_route_codes.add(code)
                stop_rows.append((
                    number, raw_seq, service_seq, code, station_name,
                    arrival, departure, journey_day, arrival_min, departure_min,
                    int(is_stop), int(in_service),
                ))

            duration_min = None
            if source_departure_min is not None and destination_arrival_min is not None:
                duration_min = destination_arrival_min - source_departure_min
                while duration_min < 0:
                    duration_min += 1440
                duration_min = round(duration_min, 1)

            overall_distance = float(train.get("overallDistanceKm") or 0)
            train_rows.append((
                number, name, train_type,
                source_code, str(source.get("name") or source_code).strip(),
                destination_code, str(destination.get("name") or destination_code).strip(),
                _days_mask(train.get("runningDays")), overall_distance,
                len(raw_route), service_count, scheduled_count,
                source_departure, destination_arrival, duration_min,
                ",".join(quality), path.name, source_sha,
            ))
            train_total += 1
            raw_total += len(raw_route)
            service_total += service_count
            scheduled_total += scheduled_count

    known_codes = set(ST.BY_CODE)
    valid_codes = {code for code in all_route_codes if code in ST.BY_CODE and ST.BY_CODE[code]["coordinate_valid"]}
    summary = {
        "status": "ready",
        "parts": len(files),
        "part_files": [path.name for path in files],
        "part_details": [
            {
                "file": path.name,
                "source_name": manifest.get(path.name, {}).get("source_name", path.name),
                "source_sha256": manifest.get(path.name, {}).get("source_sha256", ""),
                "records": manifest.get(path.name, {}).get("records", 0),
                "route_rows": manifest.get(path.name, {}).get("route_rows", 0),
            }
            for path in files
        ],
        "trains": train_total,
        "raw_route_rows": raw_total,
        "service_route_rows": service_total,
        "scheduled_stops": scheduled_total,
        "unique_route_station_codes": len(all_route_codes),
        "station_codes_matched": len(all_route_codes & known_codes),
        "station_codes_with_coordinates": len(valid_codes),
        "station_codes_without_coordinates": len((all_route_codes & known_codes) - valid_codes),
        "station_codes_missing": len(all_route_codes - known_codes),
        "quality_counts": dict(sorted(quality_counts.items())),
        "type_counts": dict(sorted(type_counts.items())),
        "signature": signature,
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }

    connection = db.conn()
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM catalog_stops")
        connection.execute("DELETE FROM catalog_trains")
        connection.executemany(
            "INSERT INTO catalog_trains VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            train_rows,
        )
        connection.executemany(
            "INSERT INTO catalog_stops VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            stop_rows,
        )
        connection.execute(
            "INSERT INTO app_meta(key,value) VALUES ('train_catalog_signature',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (signature,),
        )
        connection.execute(
            "INSERT INTO app_meta(key,value) VALUES ('train_catalog_stats',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(summary, separators=(",", ":")),),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    _STATS_CACHE = summary
    if verbose:
        print(
            f"[catalog] parts={summary['parts']} trains={train_total} "
            f"route_rows={raw_total} service_rows={service_total} "
            f"scheduled_stops={scheduled_total}"
        )
        warnings = train_total - quality_counts.get("clean", 0)
        print(
            f"[catalog] station codes={len(all_route_codes)} "
            f"matched={summary['station_codes_matched']} "
            f"mapped={summary['station_codes_with_coordinates']} "
            f"quality-flagged trains={warnings}"
        )
    return summary


def mark_degraded(error) -> dict:
    """Keep the last good index available if a newly added part is invalid."""
    global _STATS_CACHE
    current = dict(stats())
    current.update(status="degraded", error=str(error)[:300])
    _STATS_CACHE = current
    return current


def stats() -> dict:
    global _STATS_CACHE
    if _STATS_CACHE is not None:
        return _STATS_CACHE
    db.init()
    raw = _stored_meta("train_catalog_stats")
    if raw:
        try:
            _STATS_CACHE = json.loads(raw)
            return _STATS_CACHE
        except json.JSONDecodeError:
            pass
    count = db.query("SELECT COUNT(*) AS n FROM catalog_trains")[0]["n"]
    _STATS_CACHE = {
        "status": "ready" if count else "no_parts_installed",
        "parts": len(part_files()),
        "trains": count,
        "raw_route_rows": 0,
        "service_route_rows": 0,
        "scheduled_stops": 0,
    }
    return _STATS_CACHE


def _serialize_train(row: dict) -> dict:
    return {
        "number": row["number"],
        "name": row["name"],
        "type": row["train_type"],
        "source": {"code": row["source_code"], "name": row["source_name"]},
        "destination": {"code": row["destination_code"], "name": row["destination_name"]},
        "running_days": running_days(row["running_days_mask"]),
        "runs_daily": int(row["running_days_mask"] or 0) == 127,
        "overall_distance_km": row["overall_distance_km"],
        "raw_route_count": row["raw_route_count"],
        "service_route_count": row["service_route_count"],
        "scheduled_stop_count": row["scheduled_stop_count"],
        "departure_time": row["departure_time"],
        "arrival_time": row["arrival_time"],
        "duration_min": row["duration_min"],
        "route_quality": str(row["route_quality"] or "clean").split(","),
        "source_part": row["source_part"],
        "data_mode": "timetable_catalogue",
    }


def search(
    query: str = "",
    *,
    source: str = "",
    destination: str = "",
    via: str = "",
    train_type: str = "",
    running_day: str = "",
    limit: int = 25,
    offset: int = 0,
) -> dict:
    conditions: list[str] = []
    params: list = []
    query = str(query or "").strip()
    if query:
        like = f"%{query.casefold()}%"
        conditions.append(
            "(lower(c.number) LIKE ? OR lower(c.name) LIKE ? OR "
            "lower(c.source_code) LIKE ? OR lower(c.source_name) LIKE ? OR "
            "lower(c.destination_code) LIKE ? OR lower(c.destination_name) LIKE ? OR "
            "EXISTS (SELECT 1 FROM catalog_stops s WHERE s.train_number=c.number "
            "AND s.in_service_route=1 AND (lower(s.station_code) LIKE ? OR lower(s.station_name) LIKE ?)))"
        )
        params.extend([like] * 8)
    if source:
        conditions.append("upper(c.source_code)=upper(?)")
        params.append(source.strip())
    if destination:
        conditions.append("upper(c.destination_code)=upper(?)")
        params.append(destination.strip())
    if via:
        conditions.append(
            "EXISTS (SELECT 1 FROM catalog_stops v WHERE v.train_number=c.number "
            "AND v.in_service_route=1 AND upper(v.station_code)=upper(?))"
        )
        params.append(via.strip())
    if train_type:
        conditions.append("lower(c.train_type)=lower(?)")
        params.append(train_type.strip())
    if running_day:
        day = running_day.strip().upper()[:3]
        if day not in DAY_BITS:
            raise ValueError(f"running_day must be one of {','.join(DAY_ORDER)}")
        conditions.append("(c.running_days_mask & ?) != 0")
        params.append(DAY_BITS[day])

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    count = db.query(f"SELECT COUNT(*) AS n FROM catalog_trains c {where}", tuple(params))[0]["n"]
    rank_sql = ""
    select_params = list(params)
    if query:
        exact = query.casefold()
        prefix = f"{exact}%"
        rank_sql = (
            "CASE WHEN lower(c.number)=? THEN 0 WHEN lower(c.number) LIKE ? THEN 1 "
            "WHEN lower(c.name) LIKE ? THEN 2 "
            "WHEN lower(c.source_code)=? OR lower(c.destination_code)=? THEN 3 ELSE 4 END,"
        )
        select_params.extend([exact, prefix, prefix, exact, exact])
    select_params.extend([int(limit), int(offset)])
    rows = db.query(
        f"SELECT c.* FROM catalog_trains c {where} "
        f"ORDER BY {rank_sql} c.number LIMIT ? OFFSET ?",
        tuple(select_params),
    )
    return {
        "trains": [_serialize_train(row) for row in rows],
        "total": count,
        "offset": offset,
        "limit": limit,
        "catalogue": stats(),
    }


def detail(number: str) -> dict | None:
    number = str(number).strip()
    rows = db.query("SELECT * FROM catalog_trains WHERE number=?", (number,))
    if not rows:
        return None
    train = _serialize_train(rows[0])
    stops = db.query(
        "SELECT s.service_seq AS sequence, s.station_code AS code, s.station_name AS name, "
        "s.arrival_time, s.departure_time, s.journey_day, st.state, st.lat, st.lng "
        "FROM catalog_stops s LEFT JOIN stations st ON st.code=s.station_code "
        "WHERE s.train_number=? AND s.in_service_route=1 AND s.is_scheduled_stop=1 "
        "ORDER BY s.service_seq",
        (number,),
    )
    train["scheduled_stops"] = stops
    train["catalogue"] = stats()
    return train


def route(
    number: str,
    *,
    scope: str = "service",
    calling_only: bool = False,
    limit: int = 700,
    offset: int = 0,
) -> dict | None:
    train = detail(number)
    if train is None:
        return None
    if scope not in {"service", "raw"}:
        raise ValueError("scope must be service or raw")
    conditions = ["s.train_number=?"]
    params: list = [str(number).strip()]
    order = "s.raw_seq"
    if scope == "service":
        conditions.append("s.in_service_route=1")
        order = "s.service_seq"
    if calling_only:
        conditions.append("s.is_scheduled_stop=1")
    where = " AND ".join(conditions)
    total = db.query(f"SELECT COUNT(*) AS n FROM catalog_stops s WHERE {where}", tuple(params))[0]["n"]
    rows = db.query(
        "SELECT s.raw_seq, s.service_seq, s.station_code AS code, s.station_name AS name, "
        "s.arrival_time, s.departure_time, s.journey_day, "
        "s.arrival_min, s.departure_min, s.is_scheduled_stop, s.in_service_route, "
        "st.state, st.lat, st.lng "
        f"FROM catalog_stops s LEFT JOIN stations st ON st.code=s.station_code WHERE {where} "
        f"ORDER BY {order} LIMIT ? OFFSET ?",
        tuple(params + [int(limit), int(offset)]),
    )
    for row in rows:
        row["is_scheduled_stop"] = bool(row["is_scheduled_stop"])
        row["in_service_route"] = bool(row["in_service_route"])
        row["coordinate_valid"] = row["lat"] is not None and row["lng"] is not None
    return {
        "train": train,
        "scope": scope,
        "calling_only": calling_only,
        "route": rows,
        "total": total,
        "offset": offset,
        "limit": limit,
    }


if __name__ == "__main__":
    rebuild(force=True)
