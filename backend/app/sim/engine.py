"""The simulation engine — one thread, one 15-second tick.

Each tick (real time) advances the rail world by SIM_MIN_PER_TICK *
sim_speed simulated minutes:

  1. track sections evolve: weather fronts rise/decay, congestion
     blockages fade, signal holds count down, random incidents spawn
     (a storm front, a line blockage near a busy junction, a signal wait)
  2. trains move: speed = base x weather x congestion x slow-order
     (or 0 while a signal hold is active); arrivals trigger dwell,
     platform assignment and an accuracy-log entry (predicted vs actual)
  3. passenger alerts are evaluated against the new delays
  4. a snapshot (ETAs via the ETA engine + cause breakdowns + KPIs) is
     published to REST and pushed over the WebSocket

Pause the feed (or let it go stale) and the ETA engine switches to its
historical-average fallback — the data-freshness story for the demo.
"""
import json
import math
import random
import threading
import time

from .. import config, db, train_catalog
from ..ml.predict import EtaEngine
from ..data import stations as ST
from . import state as S

rng = random.Random(11)


# ----------------------------------------------------------------- incidents
def spawn_weather(segments, key=None):
    seg = segments.get(key) if key else random.choice(list(segments.values()))
    seg.front_peak = rng.uniform(0.45, 1.0)
    seg.front_total = seg.front_left = rng.uniform(180, 360)
    log_event(f"Weather front injected on {seg.a}–{seg.b} (control-room scenario)")


def spawn_blockage(segments, key=None):
    seg = None
    if key:
        seg = segments.get(key)
    if seg is None:
        pool = list(segments.values())
        weights = [2.5 if ST.BY_CODE[s.b]["major"] else 1.0 for s in pool]
        seg = random.choices(pool, weights=weights, k=1)[0]
    seg.block0 = seg.block = rng.uniform(0.4, 0.9)
    seg.block_total = seg.block_left = rng.uniform(90, 240)
    log_event(f"Line blockage reported {seg.a}–{seg.b} — congestion rising")


def spawn_signal(segments, key=None):
    seg = segments.get(key) if key else random.choice(list(segments.values()))
    seg.hold = max(seg.hold, rng.uniform(3, 9))
    log_event(f"Signal wait at {seg.a}–{seg.b} ({seg.hold:.0f} min hold)")


def log_event(msg):
    S.STATE["events"].insert(0, {"msg": msg, "clock": round(S.STATE["clock"], 1)})
    S.STATE["events"] = S.STATE["events"][:12]


def evolve_segments(dt):
    clock = S.STATE["clock"]
    for seg in S.STATE["segments"].values():
        if seg.hold > 0:
            seg.hold = max(0.0, seg.hold - dt)
        if seg.block_left > 0:
            seg.block_left = max(0.0, seg.block_left - dt)
            seg.block = max(0.0, seg.block0 * seg.block_left / seg.block_total)
        if seg.front_total > 0:
            seg.front_left -= dt
            if seg.front_left <= 0:
                seg.front_total = 0.0
                seg.w = seg.base_w
            else:
                # sinusoidal front: builds to peak, then clears
                phase = 1.0 - seg.front_left / seg.front_total
                seg.w = max(seg.base_w, seg.front_peak * math.sin(math.pi * phase))

    if rng.random() < 0.020:
        spawn_weather(S.STATE["segments"])
    if rng.random() < 0.015:
        spawn_blockage(S.STATE["segments"])
    if rng.random() < 0.028:
        spawn_signal(S.STATE["segments"])


# -------------------------------------------------------------------- trains
def assign_platform(t, code):
    if code in t["platforms"]:
        return
    for _ in range(3):
        p = rng.randint(1, 4)
        clash = any(o["at_station"] and o["stops"][o["leg"]] == code
                    and o["platforms"].get(code) == p
                    for o in S.STATE["trains"].values() if o is not t)
        if not clash:
            t["platforms"][code] = p
            return
    t["platforms"][code] = rng.randint(1, 4)


def wrap_trip(t):
    """Terminal reached: log the trip, restart the next departure."""
    total_delay = max(0.0, S.STATE["clock"] - (t["sched_arr"][-1] + t["epoch"]))
    db.execute("INSERT INTO trips(train_number, started, ended, total_delay) VALUES (?,?,?,?)",
               (t["number"], S.iso(0), S.iso(S.STATE["clock"]), round(total_delay, 1)))
    t["epoch"] = S.STATE["clock"] - t["sched_arr"][0]
    t["pos"] = 0.0
    t["leg"] = 0
    t["at_station"] = False
    t["dwell_left"] = 0.0
    t["slow_order"] = rng.uniform(0.90, 1.10)
    t["platforms"] = {}
    t["last_station_code"] = t["stops"][0]
    t["last_station_time"] = S.STATE["clock"]
    log_event(f"{t['number']} {t['name']} completed {t['from_code']}–{t['to_code']} "
              f"({total_delay:+.0f} min), restarting service")


def arrive(t, engine):
    t["pos"] = t["km"][t["leg"] + 1]
    code = t["stops"][t["leg"] + 1]
    actual = S.STATE["clock"]

    pred = S.STATE["pred_ring"].pop((t["number"], code), None)
    if pred is not None:
        db.execute("INSERT INTO accuracy_log(ts, train_number, station_code, predicted, actual, abs_error) "
                   "VALUES (?,?,?,?,?,?)",
                   (S.iso(actual), t["number"], code, round(pred, 1), round(actual, 1),
                    round(abs(pred - actual), 1)))

    t["leg"] += 1
    t["at_station"] = True
    t["last_station_code"] = code
    t["last_station_time"] = actual

    dw = t["dwell_base"] + rng.uniform(0, 3)
    if t["leg"] < len(t["stops"]) - 1:
        dw += 4.0 * S.STATE["segments"][(t["stops"][t["leg"]], t["stops"][t["leg"] + 1])].congestion
        assign_platform(t, t["stops"][t["leg"] + 1])
    if rng.random() < 0.05:
        dw += rng.uniform(3, 8)   # passenger boarding overrun
    t["dwell_total"] = dw
    t["dwell_left"] = dw


def move_train(t, engine, dt):
    if t["at_station"]:
        t["dwell_left"] -= dt
        t["speed"] = 0.0
        if t["dwell_left"] <= 0:
            if t["leg"] == len(t["stops"]) - 1:
                wrap_trip(t)
            else:
                t["at_station"] = False
                t["slow_order"] = rng.uniform(0.90, 1.10)
                assign_platform(t, t["stops"][t["leg"] + 1])
        return

    seg = S.STATE["segments"][(t["stops"][t["leg"]], t["stops"][t["leg"] + 1])]
    if seg.hold > 0:
        t["speed"] = 0.0
        return
    # free-flow speed = scheduled avg / SCHEDULE_FACTOR (schedules assume
    # typical network conditions); live conditions modulate on top
    target = (t["avg_speed"] / config.SCHEDULE_FACTOR
              * (1 - 0.45 * seg.w) * (1 - 0.35 * seg.congestion)
              * t["slow_order"])
    t["speed"] = 0.65 * t["speed"] + 0.35 * target
    t["pos"] += t["speed"] * dt / 60.0
    if t["pos"] >= t["km"][t["leg"] + 1]:
        arrive(t, engine)


# -------------------------------------------------------------------- alerts
def check_alerts(engine):
    now = time.time()
    keep = []
    for a in S.STATE["alerts"]:
        t = S.STATE["trains"].get(a["train"])
        if a["status"] == "triggered" and now > a["expires"]:
            continue
        if a["status"] == "monitoring" and t is not None:
            diff = t["delay"] - a["base_delay"]
            if abs(diff) >= a["threshold"] and now - a.get("last_trig", 0) > 60:
                a["status"] = "triggered"
                a["triggered_at"] = now
                a["expires"] = now + 180
                a["last_trig"] = now
                eta_txt = f"{S.iso(t['eta_next_min'])} ± {t['eta_range']} min" if t.get("eta_next_min") else "n/a"
                a["message"] = (f"{a['train']} {t['name']}: delay moved {diff:+.0f} min "
                                f"(now {t['delay']:+.0f} vs schedule). Predicted next stop "
                                f"{eta_txt}.")
        keep.append(a)
    S.STATE["alerts"] = keep


# ------------------------------------------------------------------ snapshot
def severity(d):
    if d < 5:
        return "on_time"
    if d < 15:
        return "minor"
    if d < 30:
        return "major"
    return "severe"


def build_snapshot(engine):
    st = S.STATE
    clock = st["clock"]
    real_now = time.time()
    trains_out, delays = [], []
    for t in st["trains"].values():
        t["delay"] = clock - engine._sched_time(t)
        at_terminal = t["at_station"] and t["leg"] == len(t["stops"]) - 1
        telemetry_ts = t.get("telemetry_updated_at", 0.0)
        telemetry_age = max(0, round(real_now - telemetry_ts)) if telemetry_ts else None
        railradar_fresh = bool(telemetry_ts and telemetry_age <= config.RAILRADAR_POSITION_TTL_SECONDS)
        reported_coordinate = S.reported_position(t, real_now)
        position_source = (
            "railradar_reported" if reported_coordinate
            else "railradar_dead_reckoning" if railradar_fresh
            else "simulation"
        )
        geometry = t.get("visual_geometry") or {}
        position_geometry_km = S.geometry_position_km(t)
        rec = {
            "number": t["number"], "name": t["name"], "ttype": t["ttype"],
            "color": t["color"], "coaches": t["coaches"], "priority": t["priority"],
            "from_code": t["from_code"], "from_name": t["from_name"],
            "to_code": t["to_code"], "to_name": t["to_name"],
            "pos_km": round(t["pos"], 1), "total_km": round(t["km"][-1], 1),
            "progress": round(t["pos"] / t["km"][-1], 4),
            "speed_kmh": round(t["speed"]),
            "delay": round(t["delay"], 1),
            "last_station_code": t["last_station_code"],
            "last_station_name": ST.BY_CODE[t["last_station_code"]]["name"],
            "last_station_time": S.iso(t["last_station_time"]),
            "at_station": t["at_station"],
            "position_source": position_source,
            "position_geometry_source": geometry.get("source", "representative_halts"),
            "position_geometry_km": round(position_geometry_km, 3) if position_geometry_km is not None else None,
            "position_is_track_snapped": bool(geometry.get("track_snapped") and not reported_coordinate),
            "telemetry_age_s": telemetry_age,
            "railradar": t.get("railradar"),
            "weather_live": t.get("weather_live"),
        }
        if at_terminal:
            rec.update(status="arrived", next_station_code=None, next_station_name=None,
                       sched_next_min=None, eta_next_min=None, eta_range=None,
                       eta_source="—", next_platform=None, cause=[], cause_total=0.0)
        else:
            rows, rng_next, stale = engine.station_etas(t, st["segments"], clock, st["last_update"])
            nx = rows[0]
            seg = st["segments"][(t["stops"][t["leg"]], t["stops"][t["leg"] + 1])]
            cause, total = engine.cause_breakdown(t, seg, max(0.0, t["delay"]), clock,
                                                  t["travel"][t["leg"]])
            rec.update(
                status="boarded" if t["at_station"] else severity(t["delay"]),
                next_station_code=nx["code"], next_station_name=nx["name"],
                sched_next_min=nx["scheduled_min"],
                sched_next_time=S.iso(nx["scheduled_min"]),
                eta_next_min=nx["eta_min"], eta_next_time=S.iso(nx["eta_min"]),
                eta_range=rng_next,
                eta_source="historical_fallback" if stale else "model",
                next_platform=t["platforms"].get(nx["code"]),
                cause=cause, cause_total=total,
                stations=rows,
            )
            st["pred_ring"][(t["number"], nx["code"])] = nx["eta_min"]
        lat, lng = S.latlng(t)
        rec["lat"], rec["lng"] = round(lat, 4), round(lng, 4)
        trains_out.append(rec)
        delays.append(max(0.0, rec["delay"]))

    segs_out = [
        {"a": s.a, "b": s.b, "weather": round(s.w, 2),
         "weather_source": ("openweather+scenario" if s.weather_source == "openweather" and s.front_left > 0
                            else s.weather_source),
         "weather_updated_at": s.weather_updated_at or None,
         "congestion": round(s.congestion, 2), "hold": round(s.hold, 1)}
        for s in st["segments"].values()
    ]
    cong = sorted(segs_out, key=lambda x: -x["congestion"])[:10]

    kpis = {
        "n_trains": len(trains_out),
        "on_time": sum(1 for d in delays if d < 5),
        "minor": sum(1 for d in delays if 5 <= d < 15),
        "major": sum(1 for d in delays if 15 <= d < 30),
        "severe": sum(1 for d in delays if d >= 30),
        "avg_delay": round(sum(delays) / len(delays), 1) if delays else 0.0,
        "worst": max(trains_out, key=lambda r: r["delay"])["number"] if trains_out else None,
        "active_alerts": sum(1 for a in st["alerts"] if a["status"] == "monitoring"),
        "feed_age_s": round(time.time() - st["last_update"]) if st["last_update"] else 0,
        "stale": bool(st["last_update"]) and (time.time() - st["last_update"]) > config.STALE_AFTER_SECONDS,
    }

    # The authoritative catalogue has ~9k records.  A live snapshot is sent
    # every 15 seconds, so include only active-route stations here; clients
    # fetch/search the full catalogue through /api/stations and load the
    # static GeoJSON map layer once through /api/stations/geojson.
    active_station_codes = sorted({code for t in st["trains"].values() for code in t["stops"]})

    return {
        "trains": trains_out,
        "segments": segs_out,
        "congestion_rank": cong,
        "alerts": st["alerts"],
        "events": st["events"],
        "providers": st.get("providers", {"mode": "simulation_fallback", "items": {}}),
        "stations": [ST.BY_CODE[code] for code in active_station_codes],
        "routes": [
            {
                "train": t["number"], "name": t["name"], "color": t["color"],
                "coords": [
                    [point["lat"], point["lng"]]
                    for point in (t.get("visual_geometry") or {}).get("points", [])
                ] or [[ST.BY_CODE[c]["lat"], ST.BY_CODE[c]["lng"]] for c in t["stops"]],
                "geometry_source": (t.get("visual_geometry") or {}).get(
                    "source", "representative_halts"),
                "track_snapped": bool((t.get("visual_geometry") or {}).get("track_snapped")),
            }
            for t in st["trains"].values()
        ],
        "kpis": kpis,
        "meta": {
            "clock_min": round(clock, 1),
            "clock_iso": S.iso_full(clock),
            "paused": st["paused"],
            "sim_speed": st["sim_speed"],
            "tick": st["tick_n"],
            "mae": engine.mae,
            "last_update": st["last_update"],
            "stale_after": config.STALE_AFTER_SECONDS,
            "data_mode": st.get("providers", {}).get("mode", "simulation_fallback"),
            "station_catalogue": ST.SOURCE_STATS,
            "train_catalogue": train_catalog.stats(),
        },
    }


# -------------------------------------------------------------------- engine
def run_tick(engine, broadcast):
    """One 15-second tick. Called from the engine thread."""
    st = S.STATE
    with st["lock"]:
        dt = config.SIM_MIN_PER_TICK * st["sim_speed"]
        if not st["paused"]:
            st["clock"] += dt
            st["tick_n"] += 1
            evolve_segments(dt)
            for t in st["trains"].values():
                move_train(t, engine, dt)
            st["last_update"] = time.time()
        else:
            # frozen world, but the snapshot is still rebuilt so the
            # frontend sees the growing feed age + historical fallback
            st["tick_n"] += 1
        check_alerts(engine)
        snap = build_snapshot(engine)
        st["snapshot"] = snap
    try:
        broadcast(json.dumps(snap))
    except Exception:
        pass


def start_thread(engine, broadcast, stop_event):
    def loop():
        run_tick(engine, broadcast)   # publish immediately so UI is live at once
        while not stop_event.is_set():
            time.sleep(config.TICK_SECONDS)
            try:
                run_tick(engine, broadcast)
            except Exception as exc:  # never kill the demo for a tick error
                print(f"[sim] tick error: {exc}")
    th = threading.Thread(target=loop, name="railsync-sim", daemon=True)
    th.start()
    return th
