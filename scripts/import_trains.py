#!/usr/bin/env python3
"""Validate and install one or more train-catalogue JSON parts.

The raw uploads are stored as deterministic gzip files under
backend/app/data/train_catalog/.  Compression keeps each ~22 MB source part
near 2 MB while preserving every supplied field. The FastAPI startup importer
rebuilds searchable SQLite tables whenever this manifest changes.

Examples:
    # First batch
    python scripts/import_trains.py --replace trains_part1.json trains_part2.json

    # Add later parts without deleting the first batch
    python scripts/import_trains.py trains_part3.json trains_part4.json
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "backend" / "app" / "data" / "train_catalog"
STATION_SOURCE = ROOT / "backend" / "app" / "data" / "stations_catalog.json"
REQUIRED_TRAIN = {
    "trainNumber", "trainName", "type", "source", "destination",
    "runningDays", "overallDistanceKm", "completeOrderedRoute",
}
REQUIRED_STOP = {
    "sequence", "stationCode", "stationName", "arrivalTime",
    "departureTime", "journeyDay", "distance",
}


def _read_source(path: Path) -> bytes:
    raw = path.read_bytes()
    if path.suffix.lower() == ".gz":
        raw = gzip.decompress(raw)
    return raw


def _target_name(path: Path) -> str:
    name = path.name[:-3] if path.name.lower().endswith(".gz") else path.name
    if not name.lower().endswith(".json"):
        raise ValueError(f"{path}: expected .json or .json.gz")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return f"{safe}.gz"


def _station_codes() -> set[str]:
    if not STATION_SOURCE.exists():
        return set()
    rows = json.loads(STATION_SOURCE.read_text(encoding="utf-8"))
    return {str(row.get("code") or "").strip().upper() for row in rows}


def validate(path: Path, raw: bytes, known_stations: set[str]) -> tuple[list[dict], dict]:
    try:
        rows = json.loads(raw)
    except Exception as exc:
        raise ValueError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(rows, list):
        raise ValueError(f"{path}: catalogue root must be a JSON list")

    train_numbers: set[str] = set()
    route_rows = timed_rows = source_mismatch = destination_mismatch = 0
    route_codes: set[str] = set()
    types: dict[str, int] = {}

    for index, train in enumerate(rows):
        if not isinstance(train, dict) or not REQUIRED_TRAIN.issubset(train):
            raise ValueError(f"{path}: train row {index} is missing required fields")
        number = str(train.get("trainNumber") or "").strip()
        if not number:
            raise ValueError(f"{path}: train row {index} has no train number")
        if number in train_numbers:
            raise ValueError(f"{path}: duplicate train number {number}")
        train_numbers.add(number)
        types[str(train.get("type") or "Unknown")] = types.get(str(train.get("type") or "Unknown"), 0) + 1

        source = str((train.get("source") or {}).get("code") or "").strip().upper()
        destination = str((train.get("destination") or {}).get("code") or "").strip().upper()
        if not source or not destination:
            raise ValueError(f"{path}: train {number} has an invalid source/destination")

        route = train.get("completeOrderedRoute")
        if not isinstance(route, list) or not route:
            raise ValueError(f"{path}: train {number} has no ordered route")
        codes = []
        for stop_index, stop in enumerate(route):
            if not isinstance(stop, dict) or not REQUIRED_STOP.issubset(stop):
                raise ValueError(f"{path}: train {number} route row {stop_index} is malformed")
            if stop.get("sequence") != stop_index + 1:
                raise ValueError(f"{path}: train {number} route sequence is not contiguous")
            code = str(stop.get("stationCode") or "").strip().upper()
            if not code:
                raise ValueError(f"{path}: train {number} route row {stop_index} has no station code")
            codes.append(code)
            route_codes.add(code)
            route_rows += 1
            timed_rows += bool(stop.get("arrivalTime") or stop.get("departureTime"))
        source_mismatch += codes[0] != source
        destination_mismatch += codes[-1] != destination

    missing_station_codes = sorted(route_codes - known_stations) if known_stations else []
    stats = {
        "source_name": path.name[:-3] if path.name.lower().endswith(".gz") else path.name,
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "records": len(rows),
        "route_rows": route_rows,
        "timed_route_rows": timed_rows,
        "unique_route_station_codes": len(route_codes),
        "missing_station_codes": len(missing_station_codes),
        "missing_station_code_sample": missing_station_codes[:20],
        "source_endpoint_mismatches": source_mismatch,
        "destination_endpoint_mismatches": destination_mismatch,
        "train_number_min": min(train_numbers) if train_numbers else None,
        "train_number_max": max(train_numbers) if train_numbers else None,
        "types": dict(sorted(types.items())),
    }
    return rows, stats


def _load_existing_numbers(output: Path, excluded_names: set[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for part in sorted(output.glob("*.json.gz")):
        if part.name in excluded_names:
            continue
        rows = json.loads(gzip.decompress(part.read_bytes()))
        for train in rows:
            number = str(train.get("trainNumber") or "").strip()
            if number in found:
                raise ValueError(f"existing catalogue duplicates train {number} in {found[number]} and {part.name}")
            found[number] = part.name
    return found


def _profile_installed(path: Path, known_stations: set[str]) -> dict:
    raw = gzip.decompress(path.read_bytes())
    _, stats = validate(path, raw, known_stations)
    return {
        "file": path.name,
        "compressed_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "compressed_bytes": path.stat().st_size,
        **stats,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--replace", action="store_true", help="remove previously installed train parts")
    args = parser.parse_args()

    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    known_stations = _station_codes()

    staged: dict[str, tuple[bytes, list[dict], dict]] = {}
    incoming_numbers: dict[str, str] = {}
    for source_arg in args.sources:
        source = source_arg.resolve()
        raw = _read_source(source)
        rows, stats = validate(source, raw, known_stations)
        target_name = _target_name(source)
        if target_name in staged:
            raise ValueError(f"two inputs resolve to the same installed filename: {target_name}")
        for train in rows:
            number = str(train["trainNumber"]).strip()
            if number in incoming_numbers:
                raise ValueError(
                    f"train {number} appears in both {incoming_numbers[number]} and {source.name}"
                )
            incoming_numbers[number] = source.name
        staged[target_name] = (gzip.compress(raw, compresslevel=9, mtime=0), rows, stats)

    if not args.replace:
        existing_numbers = _load_existing_numbers(output, set(staged))
        overlap = sorted(set(existing_numbers) & set(incoming_numbers))
        if overlap:
            number = overlap[0]
            raise ValueError(
                f"train {number} already exists in {existing_numbers[number]}; "
                "replace that part or use --replace"
            )

    if args.replace:
        for path in output.glob("*.json.gz"):
            path.unlink()

    for name, (compressed, _rows, _stats) in staged.items():
        temp = output / f".{name}.tmp"
        temp.write_bytes(compressed)
        temp.replace(output / name)

    parts = [_profile_installed(path, known_stations) for path in sorted(output.glob("*.json.gz"))]
    # Final cross-part duplicate check after installation.
    seen: dict[str, str] = {}
    for part in sorted(output.glob("*.json.gz")):
        for train in json.loads(gzip.decompress(part.read_bytes())):
            number = str(train["trainNumber"]).strip()
            if number in seen:
                raise ValueError(f"train {number} is duplicated in {seen[number]} and {part.name}")
            seen[number] = part.name

    manifest = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "parts": parts,
        "totals": {
            "parts": len(parts),
            "trains": sum(part["records"] for part in parts),
            "route_rows": sum(part["route_rows"] for part in parts),
            "timed_route_rows": sum(part["timed_route_rows"] for part in parts),
            "compressed_bytes": sum(part["compressed_bytes"] for part in parts),
        },
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"installed": str(output), **manifest["totals"], "files": [p["file"] for p in parts]}, indent=2))


if __name__ == "__main__":
    main()
