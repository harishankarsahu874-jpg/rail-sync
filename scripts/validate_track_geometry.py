#!/usr/bin/env python3
"""Validate ordered WGS84 railway LineStrings before RailSync loads them."""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def haversine(a, b):
    lng1, lat1 = a
    lng2, lat2 = b
    radius = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    value = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius * 2 * math.asin(min(1.0, math.sqrt(value)))


def line_coordinates(payload):
    if payload.get("type") == "FeatureCollection":
        feature = next((row for row in payload.get("features", [])
                        if (row.get("geometry") or {}).get("type") == "LineString"), None)
        geometry = (feature or {}).get("geometry") or {}
    elif payload.get("type") == "Feature":
        geometry = payload.get("geometry") or {}
    else:
        geometry = payload
    if geometry.get("type") != "LineString":
        raise ValueError("expected a GeoJSON LineString (MultiLineString must be ordered/stitched first)")
    coordinates = geometry.get("coordinates") or []
    if len(coordinates) < 2:
        raise ValueError("LineString needs at least two coordinates")
    clean = []
    for index, row in enumerate(coordinates):
        if not isinstance(row, list) or len(row) < 2:
            raise ValueError(f"coordinate {index} is not [longitude, latitude]")
        lng, lat = float(row[0]), float(row[1])
        if not (-180 <= lng <= 180 and -90 <= lat <= 90):
            raise ValueError(f"coordinate {index} is outside WGS84 bounds: {lng}, {lat}")
        if not clean or (lng, lat) != clean[-1]:
            clean.append((lng, lat))
    return clean, len(coordinates) - len(clean)


def endpoint_report(train, coordinates):
    if not train:
        return None
    from app.data import stations, trains
    if train not in trains.ROUTES:
        raise ValueError(f"{train} is not one of the six live demo routes")
    source_code, destination_code = trains.ROUTES[train][0], trains.ROUTES[train][-1]
    source, destination = stations.BY_CODE[source_code], stations.BY_CODE[destination_code]
    expected_source = (source["lng"], source["lat"])
    expected_destination = (destination["lng"], destination["lat"])
    direct = (haversine(coordinates[0], expected_source),
              haversine(coordinates[-1], expected_destination))
    reversed_offsets = (haversine(coordinates[-1], expected_source),
                        haversine(coordinates[0], expected_destination))
    return {
        "source_code": source_code,
        "destination_code": destination_code,
        "direct": direct,
        "reversed": reversed_offsets,
        "reverse_recommended": sum(reversed_offsets) < sum(direct),
    }


def validate(path, train, hard_gap, detail_gap):
    payload = json.loads(path.read_text())
    coordinates, duplicates = line_coordinates(payload)
    steps = [haversine(a, b) for a, b in zip(coordinates, coordinates[1:])]
    total = sum(steps)
    endpoint = endpoint_report(train, coordinates)
    warnings = []
    if max(steps) > hard_gap:
        raise ValueError(f"{max(steps):.2f} km segment exceeds hard gap limit {hard_gap:g} km")
    if max(steps) > detail_gap:
        warnings.append(f"maximum vertex gap {max(steps):.2f} km exceeds detailed-geometry target {detail_gap:g} km")
    if statistics.mean(steps) > 2:
        warnings.append(f"average vertex gap {statistics.mean(steps):.2f} km suggests simplified geometry")
    if total and len(coordinates) / total * 100 < 20:
        warnings.append("fewer than 20 vertices per 100 km; curves may still be cut")
    if endpoint:
        direct = endpoint["reversed"] if endpoint["reverse_recommended"] else endpoint["direct"]
        if max(direct) > 30:
            raise ValueError(f"route endpoints are {direct[0]:.1f}/{direct[1]:.1f} km from the expected stations")
        if endpoint["reverse_recommended"]:
            warnings.append("LineString direction is destination→source; RailSync will reverse it")

    print(f"{path}: OK")
    print(f"  points: {len(coordinates):,} ({duplicates} consecutive duplicates removed)")
    print(f"  geodesic line length: {total:,.1f} km")
    print(f"  vertex gaps: median {statistics.median(steps):.3f} km · average {statistics.mean(steps):.3f} km · max {max(steps):.3f} km")
    if endpoint:
        chosen = endpoint["reversed"] if endpoint["reverse_recommended"] else endpoint["direct"]
        print(f"  endpoints: {endpoint['source_code']} {chosen[0]:.2f} km · {endpoint['destination_code']} {chosen[1]:.2f} km")
    for warning in warnings:
        print(f"  WARNING: {warning}")
    return bool(warnings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--train", help="Live demo train number for endpoint checks; defaults to file stem")
    parser.add_argument("--hard-gap-km", type=float, default=50)
    parser.add_argument("--detail-gap-km", type=float, default=5)
    args = parser.parse_args()
    failed = False
    for path in args.files:
        train = args.train or (path.stem if path.stem.isdigit() else None)
        try:
            validate(path, train, args.hard_gap_km, args.detail_gap_km)
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
            failed = True
            print(f"{path}: ERROR: {exc}", file=sys.stderr)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
