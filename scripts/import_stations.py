#!/usr/bin/env python3
"""Validate and install a RailSync station catalogue.

Usage:
    python scripts/import_stations.py path/to/stations.json

The input contract is the user-supplied JSON list:
  code, name, state, zone, address,
  coordinates: {longitude, latitude}

The validated source is copied into backend/app/data/stations_catalog.json.
RailSync normalises it at runtime and keeps renamed-code aliases separately,
so the supplied records remain unmodified and auditable.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "backend" / "app" / "data" / "stations_catalog.json"
REQUIRED = {"code", "name", "state", "zone", "address", "coordinates"}


def valid_coordinate(lat, lng) -> bool:
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    return (
        math.isfinite(lat)
        and math.isfinite(lng)
        and -90 <= lat <= 90
        and -180 <= lng <= 180
        and not (lat == 0 and lng == 0)
    )


def validate(path: Path) -> dict:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("catalogue root must be a JSON list")

    seen: set[str] = set()
    valid = state_count = zone_count = 0
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not REQUIRED.issubset(row):
            raise ValueError(f"row {index} is missing one of: {sorted(REQUIRED)}")
        code = str(row["code"]).strip().upper()
        if not code:
            raise ValueError(f"row {index} has an empty station code")
        if code in seen:
            raise ValueError(f"duplicate station code: {code}")
        seen.add(code)
        coords = row.get("coordinates") or {}
        if valid_coordinate(coords.get("latitude"), coords.get("longitude")):
            valid += 1
            state_count += bool(str(row.get("state") or "").strip() or str(row.get("address") or "").strip())
            zone = str(row.get("zone") or "").strip()
            zone_count += bool(zone and zone != "?")

    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "records": len(rows),
        "unique_codes": len(seen),
        "valid_coordinates": valid,
        "invalid_coordinates": len(rows) - valid,
        "valid_with_state_or_address": state_count,
        "valid_with_zone": zone_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    stats = validate(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    if source != output:
        shutil.copyfile(source, output)
    print(json.dumps({"installed": str(output), **stats}, indent=2))


if __name__ == "__main__":
    main()
