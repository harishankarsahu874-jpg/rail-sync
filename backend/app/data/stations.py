"""Authoritative station catalogue used by RailSync.

`stations_catalog.json` is the user's 8,990-record dataset, installed without
editing by `scripts/import_stations.py`.  This module performs a small,
auditable runtime normalisation:

* station codes are upper-cased and coordinates are validated;
* supplied name/state/zone/address values are retained;
* missing state/zone values are enriched only for demo-route stations;
* current DDU, MMCT, PRYJ and VGLJ codes are traceable aliases of the
  historical MGS, BCT, ALD and JHS records (both forms stay searchable).

The full catalogue is served by paginated REST endpoints.  Only stations on
the six active demo routes are included in the 15-second WebSocket snapshot,
which avoids rebroadcasting roughly 1.9 MB every tick.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

CATALOG_PATH = Path(__file__).with_name("stations_catalog.json")
CATALOGUE_SHA256 = hashlib.sha256(CATALOG_PATH.read_bytes()).hexdigest() if CATALOG_PATH.exists() else ""

# Route stations are highlighted in the live snapshot/map.  These flags do
# not alter the source catalogue and can be explained as RailSync UI metadata.
MAJOR_CODES = {
    "HWH", "ASN", "DHN", "PNME", "GAYA", "MGS", "DDU", "ALD", "PRYJ", "CNB", "NDLS",
    "BCT", "MMCT", "BVI", "ST", "BRC", "RTM", "NAD", "KOTA", "MTJ", "NZM",
    "MAS", "BZA", "KMT", "WL", "BPQ", "NGP", "ET", "BPL", "JHS", "VGLJ", "GWL", "AGC",
    "SRC", "KGP", "BLS", "BHC", "JJKR", "CTC", "BBS", "KUR", "BAM", "VSKP",
    "RJY", "TDD", "EE", "VAPI", "BL", "BH", "DHD", "SWM",
    "BWN", "DGR", "CRJ", "JMT", "MDP", "JSME", "JAJ", "JMU", "KIUL", "PNBE",
    "ARA", "BXR", "ETW", "TDL", "ALJN", "ADI",
}

# The uploaded source has blank state/zone fields for several well-known
# route stops.  Keep the source value whenever one exists; these values are
# only transparent display enrichments for the small demo-route subset.
_ALIAS_SPECS = {
    "DDU": ("MGS", "PT DEEN DAYAL UPADHYAYA JN"),
    "MMCT": ("BCT", "MUMBAI CENTRAL"),
    "PRYJ": ("ALD", "PRAYAGRAJ JN"),
    "VGLJ": ("JHS", "VIRANGANA LAKSHMIBAI JHANSI JN"),
}

_ROUTE_ENRICHMENT = {
    "HWH": ("West Bengal", "ER"), "BWN": ("West Bengal", "ER"),
    "DGR": ("West Bengal", "ER"), "ASN": ("West Bengal", "ER"),
    "DHN": ("Jharkhand", "ECR"), "PNME": ("Jharkhand", "ECR"),
    "GAYA": ("Bihar", "ECR"), "MGS": ("Uttar Pradesh", "ECR"),
    "ALD": ("Uttar Pradesh", "NCR"), "CNB": ("Uttar Pradesh", "NCR"),
    "ETW": ("Uttar Pradesh", "NCR"), "TDL": ("Uttar Pradesh", "NCR"),
    "ALJN": ("Uttar Pradesh", "NCR"), "GWL": ("Madhya Pradesh", "NCR"),
    "AGC": ("Uttar Pradesh", "NCR"), "NDLS": ("Delhi", "NR"),
    "BCT": ("Maharashtra", "WR"), "BVI": ("Maharashtra", "WR"),
    "ST": ("Gujarat", "WR"), "BRC": ("Gujarat", "WR"),
    "RTM": ("Madhya Pradesh", "WR"), "NAD": ("Madhya Pradesh", "WR"),
    "KOTA": ("Rajasthan", "WCR"), "SWM": ("Rajasthan", "WCR"),
    "MTJ": ("Uttar Pradesh", "NCR"), "NZM": ("Delhi", "NR"),
    "VAPI": ("Gujarat", "WR"), "BL": ("Gujarat", "WR"),
    "BH": ("Gujarat", "WR"), "DHD": ("Gujarat", "WR"),
    "MAS": ("Tamil Nadu", "SR"), "BZA": ("Andhra Pradesh", "SCR"),
    "KMT": ("Telangana", "SCR"), "WL": ("Telangana", "SCR"),
    "BPQ": ("Maharashtra", "CR"), "NGP": ("Maharashtra", "CR"),
    "ET": ("Madhya Pradesh", "WCR"), "BPL": ("Madhya Pradesh", "WCR"),
    "JHS": ("Uttar Pradesh", "NCR"), "SRC": ("West Bengal", "SER"),
    "KGP": ("West Bengal", "SER"), "BLS": ("Odisha", "SER"),
    "BHC": ("Odisha", "ECoR"), "JJKR": ("Odisha", "ECoR"),
    "CTC": ("Odisha", "ECoR"), "BBS": ("Odisha", "ECoR"),
    "KUR": ("Odisha", "ECoR"), "BAM": ("Odisha", "ECoR"),
    "VSKP": ("Andhra Pradesh", "ECoR"), "RJY": ("Andhra Pradesh", "SCR"),
    "TDD": ("Andhra Pradesh", "SCR"), "EE": ("Andhra Pradesh", "SCR"),
    "CRJ": ("West Bengal", "ER"), "JMT": ("Jharkhand", "ER"),
    "MDP": ("Jharkhand", "ER"), "JSME": ("Jharkhand", "ER"),
    "JAJ": ("Bihar", "ECR"), "JMU": ("Bihar", "ECR"),
    "KIUL": ("Bihar", "ECR"), "PNBE": ("Bihar", "ECR"),
    "ARA": ("Bihar", "ECR"), "BXR": ("Bihar", "ECR"),
    "ADI": ("Gujarat", "WR"),
}


def _clean(value) -> str:
    return str(value or "").strip()


def _coordinate(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _valid_coordinate(lat, lng) -> bool:
    return (
        lat is not None
        and lng is not None
        and -90 <= lat <= 90
        and -180 <= lng <= 180
        and not (lat == 0 and lng == 0)
    )


def _normalise(raw: dict) -> dict:
    code = _clean(raw.get("code")).upper()
    coords = raw.get("coordinates") or {}
    lat = _coordinate(coords.get("latitude"))
    lng = _coordinate(coords.get("longitude"))
    coordinate_valid = _valid_coordinate(lat, lng)
    if not coordinate_valid:
        lat = lng = None

    provided_state = _clean(raw.get("state"))
    provided_zone = _clean(raw.get("zone"))
    provided_address = _clean(raw.get("address"))
    fallback_state, fallback_zone = _ROUTE_ENRICHMENT.get(code, ("", ""))
    return {
        "code": code,
        "name": _clean(raw.get("name")) or code,
        "state": provided_state or fallback_state,
        "zone": provided_zone or fallback_zone,
        "address": provided_address,
        "source_state": provided_state,
        "source_zone": provided_zone,
        "source_address": provided_address,
        "metadata_enriched": bool((not provided_state and fallback_state) or (not provided_zone and fallback_zone)),
        "lat": lat,
        "lng": lng,
        "coordinate_valid": coordinate_valid,
        "major": code in MAJOR_CODES,
        "source": "user_station_catalogue",
        "source_code": code,
        "alias_of": None,
    }


def _load() -> tuple[list[dict], list[dict]]:
    if not CATALOG_PATH.exists():
        raise RuntimeError(
            f"station catalogue missing at {CATALOG_PATH}; "
            "run scripts/import_stations.py path/to/stations.json"
        )
    raw_rows = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw_rows, list):
        raise RuntimeError("station catalogue root must be a JSON list")

    source_rows: list[dict] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_rows):
        if not isinstance(raw, dict):
            raise RuntimeError(f"station catalogue row {index} is not an object")
        station = _normalise(raw)
        code = station["code"]
        if not code:
            raise RuntimeError(f"station catalogue row {index} has an empty code")
        if code in seen:
            raise RuntimeError(f"duplicate station code in catalogue: {code}")
        seen.add(code)
        source_rows.append(station)

    # The source predates several station-code changes.  Never overwrite a
    # supplied record: add traceable current-code records sharing its point.
    aliases: list[dict] = []
    by_source = {s["code"]: s for s in source_rows}
    for alias_code, (source_code, current_name) in _ALIAS_SPECS.items():
        if alias_code in by_source or source_code not in by_source:
            continue
        alias = dict(by_source[source_code])
        alias.update(
            code=alias_code,
            name=current_name,
            major=alias_code in MAJOR_CODES,
            source="catalogue_alias",
            source_code=source_code,
            alias_of=source_code,
        )
        aliases.append(alias)

    return source_rows, source_rows + aliases


SOURCE_STATIONS, CATALOGUE = _load()
BY_CODE = {station["code"]: station for station in CATALOGUE}

# Backward-compatible SQLite seed rows.  Rich metadata remains available in
# BY_CODE and the REST catalogue; the simulation only needs these six fields.
STATIONS = [
    (
        station["code"],
        station["name"],
        station["lat"],
        station["lng"],
        station["state"],
        int(station["major"]),
    )
    for station in CATALOGUE
]

SOURCE_STATS = {
    "source_file": "stations_catalog.json",
    "source_sha256": CATALOGUE_SHA256,
    "source_records": len(SOURCE_STATIONS),
    "application_records": len(CATALOGUE),
    "valid_coordinates": sum(s["coordinate_valid"] for s in SOURCE_STATIONS),
    "invalid_coordinates": sum(not s["coordinate_valid"] for s in SOURCE_STATIONS),
    "with_state_or_address": sum(
        bool(s["source_state"] or s["source_address"])
        for s in SOURCE_STATIONS
        if s["coordinate_valid"]
    ),
    "with_zone": sum(
        bool(s["source_zone"] and s["source_zone"] != "?")
        for s in SOURCE_STATIONS
        if s["coordinate_valid"]
    ),
    "aliases": [
        {"code": station["code"], "alias_of": station["alias_of"]}
        for station in CATALOGUE
        if station["source"] == "catalogue_alias"
    ],
}


def search(
    query: str = "",
    *,
    state: str = "",
    zone: str = "",
    valid_only: bool = False,
) -> list[dict]:
    """Search the whole catalogue with code/name prefix matches first."""
    needle = _clean(query).casefold()
    state_needle = _clean(state).casefold()
    zone_needle = _clean(zone).casefold()
    ranked = []

    for station in CATALOGUE:
        if valid_only and not station["coordinate_valid"]:
            continue
        if state_needle and state_needle not in station["state"].casefold():
            continue
        if zone_needle and zone_needle != station["zone"].casefold():
            continue

        code = station["code"].casefold()
        name = station["name"].casefold()
        haystack = " ".join(
            (code, name, station["state"].casefold(), station["zone"].casefold(), station["address"].casefold())
        )
        if needle and needle not in haystack:
            continue
        if not needle:
            rank = 4
        elif code == needle:
            rank = 0
        elif code.startswith(needle):
            rank = 1
        elif name.startswith(needle):
            rank = 2
        else:
            rank = 3
        ranked.append((rank, station["name"].casefold(), station["code"], station))

    ranked.sort(key=lambda item: item[:3])
    return [item[3] for item in ranked]


def equivalent_codes(code: str) -> set[str]:
    """Return historical/current codes that identify the same station."""
    code = _clean(code).upper()
    station = BY_CODE.get(code)
    if not station:
        return {code}
    root = station.get("alias_of") or code
    return {
        item["code"]
        for item in CATALOGUE
        if item["code"] == root or item.get("alias_of") == root
    }


def geojson() -> dict:
    """Compact map layer for the 8,697 source records with valid points."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "code": station["code"],
                    "name": station["name"],
                    "state": station["state"],
                    "zone": station["zone"],
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [station["lng"], station["lat"]],
                },
            }
            for station in SOURCE_STATIONS
            if station["coordinate_valid"]
        ],
    }
