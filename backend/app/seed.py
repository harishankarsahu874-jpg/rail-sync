"""Seed/demo data generator.

Builds:
  * station + train + route-stop tables (real station codes, realistic
    scheduled stop-sec computed from real geographic distances)
  * HIST_DAYS (60) days of per-leg historical delay records generated from a
    documented delay process, so the ML model is trained on data whose
    ground truth we understand.

Replace `hist` with a real dataset (NTES historical / Kaggle IR delay data)
via scripts/import_real.py when real data access is available — the schema
and feature columns are the contract.
"""
import csv
from datetime import date, timedelta
from math import asin, cos, radians, sin, sqrt

import numpy as np

from . import config, db
from .data import stations as ST
from .data import trains as TR

TRACK_FACTOR = 1.18   # rail length / straight-line distance (typical 1.1-1.25)
# Bump whenever the catalogue normalisation or demo routes change. Startup
# uses this marker to reseed/retrain instead of silently keeping stale rows.
SEED_VERSION = "stations-8990-v2-real-routes-2026-09"


def seed_signature():
    return f"{SEED_VERSION}:{ST.CATALOGUE_SHA256}"


def needs_seed():
    db.init()
    row = db.query("SELECT value FROM app_meta WHERE key='seed_signature'")
    if not row or row[0]["value"] != seed_signature():
        return True
    count = db.query("SELECT COUNT(*) AS n FROM stations")[0]["n"]
    return count != len(ST.STATIONS)


def hav_km(a, b):
    """Great-circle distance between two (lat, lng) points, in km."""
    lat1, lng1 = radians(a[0]), radians(a[1])
    lat2, lng2 = radians(b[0]), radians(b[1])
    h = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * asin(sqrt(h))


def build_route(number, stops, speed, calib):
    """Cumulative km + per-leg scheduled travel minutes + scheduled
    arrival minutes per stop (05:30-06:35 departures + base dwells).

    Per-leg km come from real station coordinates (x TRACK_FACTOR) and are
    scaled by `calib` so total distance matches the published route km;
    `speed` is calibrated so the computed journey time matches the
    published timetable (see README, "Data accuracy approach").
    """
    dep_h, dep_m = TR.BY_NUMBER[number]["dep_hhmm"].split(":")
    dep_min = int(dep_h) * 60 + int(dep_m)
    dw = TR.DWELL[TR.BY_NUMBER[number]["ttype"]]

    km, travel, sched_arr = [0.0], [], []
    for i in range(1, len(stops)):
        d = hav_km((ST.BY_CODE[stops[i - 1]]["lat"], ST.BY_CODE[stops[i - 1]]["lng"]),
                   (ST.BY_CODE[stops[i]]["lat"], ST.BY_CODE[stops[i]]["lng"])) * TRACK_FACTOR * calib
        km.append(km[-1] + d)
        travel.append(d / speed * 60.0)
    sched_arr.append(dep_min)
    for i in range(1, len(stops)):
        sched_arr.append(sched_arr[-1] + dw + travel[i - 1])
    return km, travel, sched_arr, dw


def hour_effect(h):
    """Rush-hour pattern: peak traffic windows are slower."""
    return 2.0 if (7 <= h < 10 or 16 <= h < 21) else 0.4


def speed_factor(weather, congestion):
    """The SAME physical slowdown law the live simulator uses:
    weather severs speed up to 45%, congestion up to 35%."""
    return (1.0 - 0.45 * weather) * (1.0 - 0.35 * congestion)


def cond_minutes(weather, congestion, signal, leg_sched):
    """Extra minutes from live conditions RELATIVE to the conditions the
    DMS schedule already assumes (config.SCHEDULE_FACTOR). Baseline
    weather/congestion therefore contribute ~0, events contribute the
    difference — same law used by the live ETA engine."""
    f = speed_factor(weather, congestion)
    return leg_sched * (1.0 / f - 1.0 / config.SCHEDULE_FACTOR) + signal


def generate_hist(rng, stops_by_train, travel_by_train):
    """60 days of per-leg records. The 'true' extra delay is:

      extra = cond + 0.55*carry + 0.9*dwell_extra + 3.2*(1-priority)
              + rush_pattern + noise

    where `cond` = slowdown time explained by live weather/congestion/signal
    (the deterministic part the ETA engine computes directly). The model
    learns the *residual* (everything the live feed can't see).
    """
    today = date.today()
    rows = []
    for number, stops in stops_by_train.items():
        meta = TR.BY_NUMBER[number]
        travel = travel_by_train[number]
        dw = TR.DWELL[meta["ttype"]]
        n_legs = len(stops) - 1
        for d in range(config.HIST_DAYS):
            day = today - timedelta(days=config.HIST_DAYS - 1 - d)
            ds = day.isoformat()
            regime = float(np.clip(rng.normal(0.0, 0.25), 0.0, 0.6))  # weather regime that day
            carry = 0.0   # minutes of delay carried in from the previous leg
            for leg in range(n_legs):
                sched_h = travel_dep_hour(number, leg, dw, travel)
                weather = float(np.clip(regime + rng.normal(0.0, 0.15), 0.0, 1.0))
                congestion = float(np.clip(rng.beta(1.3, 6.5) + 0.10 * (hour_effect(sched_h) > 1.5), 0.0, 1.0))
                signal = 0.0 if rng.random() < 0.72 else float(rng.uniform(2.0, 12.0))
                dwell_ex = max(0.0, float(rng.normal(1.2, 1.1)))
                leg_sched = travel[leg]
                cond = cond_minutes(weather, congestion, signal, leg_sched)
                extra = max(-2.0, cond + 0.55 * carry + 0.9 * dwell_ex
                            + 3.2 * (1.0 - meta["priority"])
                            + hour_effect(sched_h) + float(rng.normal(0.0, 1.8)))
                carry_in = carry
                carry = max(0.0, extra) * 0.5
                rows.append((number, leg, ds, sched_h, weather, signal, congestion,
                             dwell_ex, max(0.0, carry_in), meta["priority"], leg_sched,
                             extra, cond, extra - cond))
    return rows


def travel_dep_hour(number, leg, dw, travel):
    """Approximate departure hour of a given leg on the base schedule
    (used only for the rush-hour feature)."""
    meta = TR.BY_NUMBER[number]
    dep_h, dep_m = meta["dep_hhmm"].split(":")
    t = int(dep_h) * 60 + int(dep_m)
    for i in range(leg):
        t += dw + travel[i]
    return int(t // 60) % 24


def run(verbose=True):
    db.init()
    rng = np.random.default_rng(42)

    db.execute("DELETE FROM stations")
    db.execute("DELETE FROM trains")
    db.execute("DELETE FROM route_stops")
    db.execute("DELETE FROM hist_leg")

    db.executemany("INSERT INTO stations VALUES (?,?,?,?,?,?)", ST.STATIONS)

    stops_by_train, travel_by_train = {}, {}
    for number in TR.ROUTES:
        meta = TR.BY_NUMBER[number]
        db.execute("INSERT INTO trains VALUES (?,?,?,?,?,?,?,?,?)",
                   (number, meta["name"], meta["ttype"], meta["from_code"],
                    meta["to_code"], meta["avg_speed"], meta["priority"],
                    meta["coaches"], meta["dep_hhmm"]))
        stops = TR.ROUTES[number]
        stops_by_train[number] = stops
        km, travel, sched_arr, dw = build_route(number, stops, meta["avg_speed"], meta["calib"])
        travel_by_train[number] = travel
        for i, code in enumerate(stops):
            db.execute("INSERT INTO route_stops VALUES (?,?,?,?,?)",
                       (number, i, code, km[i], sched_arr[i]))

    rows = generate_hist(rng, stops_by_train, travel_by_train)
    db.executemany(
        "INSERT INTO hist_leg(train_number, leg, date, hour, weather, signal, congestion, "
        "dwell, carry, priority, leg_sched, extra, cond, residual) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    db.executemany(
        "INSERT INTO app_meta(key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [("seed_version", SEED_VERSION), ("seed_signature", seed_signature())],
    )

    # CSV export — the documented contract for swapping in real data
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = config.DATA_DIR / "historical_legs.csv"
    with open(csv_path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["train_number", "leg", "date", "hour", "weather", "signal",
                    "congestion", "dwell", "carry", "priority", "leg_sched",
                    "extra", "cond", "residual"])
        w.writerows(rows)

    if verbose:
        print(f"[seed] stations={len(ST.STATIONS)} trains={len(TR.ROUTES)} "
              f"hist_legs={len(rows)} (CSV at {csv_path})")
        for number, stops in stops_by_train.items():
            km, travel, sched_arr, dw = build_route(number, stops, TR.BY_NUMBER[number]["avg_speed"], TR.BY_NUMBER[number]["calib"])
            journey_h = (sched_arr[-1] - sched_arr[0]) / 60.0
            print(f"[seed] {number} {TR.BY_NUMBER[number]['name']:<22} "
                  f"{len(stops)} stops {km[-1]:6.0f} km  "
                  f"{journey_h:5.1f} h journey")
    return rows


if __name__ == "__main__":
    run()
