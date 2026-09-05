#!/usr/bin/env python3
"""Fast offline smoke test: catalogue + model + simulation + fallbacks."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import train_catalog
from app.data import stations, trains
from app.ml.predict import EtaEngine
from app.providers import ProviderManager
from app.sim import engine as sim_engine
from app.sim import state as sim_state

# User-supplied catalogue contract and known legacy-code corrections.
assert stations.SOURCE_STATS["source_records"] == 8990
assert stations.SOURCE_STATS["valid_coordinates"] == 8697
assert stations.SOURCE_STATS["invalid_coordinates"] == 293
assert stations.BY_CODE["ADT"]["name"] == "ADUTURAI"
assert stations.BY_CODE["ADI"]["name"] == "AHMEDABAD JN"
assert stations.BY_CODE["DDU"]["alias_of"] == "MGS"
assert stations.BY_CODE["MMCT"]["alias_of"] == "BCT"
assert stations.equivalent_codes("PRYJ") == {"PRYJ", "ALD"}

route_codes = {code for route in trains.ROUTES.values() for code in route}
assert all(stations.BY_CODE[code]["coordinate_valid"] for code in route_codes)

catalogue = train_catalog.rebuild()
assert catalogue["parts"] >= 5
assert catalogue["trains"] >= 5208
assert catalogue["station_codes_missing"] == 0
assert train_catalog.search("12301", limit=1)["trains"][0]["number"] == "12301"
assert train_catalog.detail("04601")["scheduled_stop_count"] >= 2
assert train_catalog.detail("12953")["destination"]["code"] == "NZM"

eta = EtaEngine()
sim_state.init_state()
for _ in range(3):
    sim_engine.run_tick(eta, lambda _: None)

snapshot = sim_state.STATE["snapshot"]
assert len(snapshot["trains"]) == 6
assert snapshot["meta"]["tick"] >= 3
assert snapshot["meta"]["station_catalogue"]["source_records"] == 8990
assert snapshot["meta"]["train_catalogue"]["trains"] >= 5208
assert len(snapshot["stations"]) == len(route_codes)
assert all(route["geometry_source"] == "uploaded_timetable_station_chain" for route in snapshot["routes"])
assert min(len(route["coords"]) for route in snapshot["routes"]) > 100
assert len(json.dumps(snapshot).encode()) < 350_000  # still far below the 1.9 MB station catalogue
assert all("position_source" in train for train in snapshot["trains"])
assert all(isinstance(train["position_geometry_km"], (int, float)) for train in snapshot["trains"])
assert all(train["position_is_track_snapped"] is False for train in snapshot["trains"])
assert all(train["eta_range"] is not None for train in snapshot["trains"] if train["status"] != "arrived")

providers = ProviderManager().public_status()
assert "railradar" in providers["items"]
assert providers["items"]["overpass"]["configured"] is True

print(
    "OK — smoke test passed",
    f"({stations.SOURCE_STATS['source_records']} source stations,",
    f"{catalogue['trains']} catalogue + {len(snapshot['trains'])} live trains,",
    f"tick {snapshot['meta']['tick']},",
    f"provider mode {providers['mode']})",
)
