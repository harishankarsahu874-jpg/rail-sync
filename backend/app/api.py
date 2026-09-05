"""REST API — the integration surface SIH judges ask about.

Every value the UI shows is available here, so a mobile app, a station
display board or another system could consume RailSync today:

    GET  /api/health
    GET  /api/state                       full live snapshot (15s cadence)
    GET  /api/trains                      six live/simulated services
    GET  /api/trains/{number}             live train detail + route ETA table
    GET  /api/catalog/meta                installed train-part profile
    GET  /api/catalog/trains              search all uploaded scheduled trains
    GET  /api/catalog/trains/{number}     timetable + calling stops
    GET  /api/catalog/trains/{number}/route  full service/raw route
    GET  /api/trains/{number}/eta         predicted ETA + confidence range
    GET  /api/trains/{number}/cause       delay-cause breakdown
    GET  /api/stations                    paginated catalogue search
    GET  /api/stations/geojson            cacheable valid-coordinate map layer
    GET  /api/stations/{code}             metadata + renamed-code provenance
    GET  /api/stations/{code}/board       station departure board
    GET  /api/congestion                  most-congested track sections
    GET  /api/accuracy                    predicted vs actual arrival history
    GET  /api/analytics/trends            60-day delay trends per train
    GET  /api/analytics/model             measured model error + coefficients
    GET  /api/alerts                      passenger alerts
    POST /api/alerts                      create "notify me" alert
    DELETE /api/alerts/{id}
    POST /api/control                     {sim_speed, paused}  (control room)
    POST /api/control/event               spawn storm/blockage/signal incident
    GET  /api/providers                   provider health/configuration (no secrets)
    POST /api/providers/refresh           demand-sync RailRadar/OpenWeather
    GET  /api/geo/context                 weather + elevation + nearby OSM rail

Interactive docs: /docs (auto-generated OpenAPI).
"""
import json
import time
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from . import config, db, train_catalog
from .data import stations as ST
from .sim import state as STT
from .sim import engine as ENG

router = APIRouter(prefix="/api")
_engine = None      # injected by main.py (EtaEngine)
_providers = None   # injected by main.py (ProviderManager)


def set_engine(engine):
    global _engine
    _engine = engine


def set_providers(providers):
    global _providers
    _providers = providers


@lru_cache(maxsize=1)
def _station_geojson_payload() -> bytes:
    return json.dumps(ST.geojson(), separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _snapshot():
    with STT.STATE["lock"]:
        snap = STT.STATE["snapshot"]
        if snap is None:
            snap = ENG.build_snapshot(_engine)
        return snap


def _train(number):
    with STT.STATE["lock"]:
        t = STT.STATE["trains"].get(number)
        if not t:
            raise HTTPException(404, f"unknown train {number}")
        return t


# ------------------------------------------------------------------ live data
@router.get("/health")
def health():
    with STT.STATE["lock"]:
        return {"ok": True, "clock": STT.STATE["clock"], "tick": STT.STATE["tick_n"],
                "trains": len(STT.STATE["trains"]),
                "catalogue_trains": train_catalog.stats().get("trains", 0),
                "station_records": ST.SOURCE_STATS["source_records"],
                "mapped_stations": ST.SOURCE_STATS["valid_coordinates"], "paused": STT.STATE["paused"],
                "data_mode": STT.STATE.get("providers", {}).get("mode", "simulation_fallback")}


@router.get("/state")
def state():
    return _snapshot()


class ProviderRefreshIn(BaseModel):
    provider: str
    train: str | None = None
    force: bool = False


@router.get("/providers")
def provider_status():
    """Configuration and live health for every external provider.

    Only booleans, timestamps and safe error messages are returned; API keys
    are never exposed. A provider in fallback mode does not break the demo.
    """
    if _providers is None:
        raise HTTPException(503, "provider manager not ready")
    return _providers.public_status()


@router.post("/providers/refresh")
def provider_refresh(body: ProviderRefreshIn):
    """Demand-refresh one RailRadar train or all active OpenWeather cells.

    RailRadar demand refresh is quota-conscious: non-forced calls reuse a
    five-minute server cache. `force=true` consumes a fresh provider call.
    """
    if _providers is None:
        raise HTTPException(503, "provider manager not ready")
    try:
        result = _providers.refresh(body.provider, body.train, body.force)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    except Exception as exc:
        text = str(exc)
        status = 503 if "not configured" in text or "network" in text or "timed out" in text else 502
        raise HTTPException(status, text) from None
    # Publish a fresh snapshot immediately so REST users do not wait for the
    # next 15-second simulation tick to see a re-anchored train.
    with STT.STATE["lock"]:
        STT.STATE["snapshot"] = ENG.build_snapshot(_engine)
    return result


@router.get("/geo/context")
def geo_context(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_m: int = Query(4000, ge=300, le=10000),
):
    """Location intelligence for a clicked point on the live map.

    Returns OpenWeather observations, OpenTopography COP30 elevation and
    nearby railway stations/tracks from Overpass OSM in one partial-success
    envelope. Missing keys produce explicit unavailable fields, not HTTP 500.
    """
    if _providers is None:
        raise HTTPException(503, "provider manager not ready")
    return _providers.geo_context(lat, lng, radius_m)


# ---------------------------------------------------------- timetable catalogue
@router.get("/catalog/meta")
def catalogue_meta():
    """Import/profile summary for all currently installed train-data parts."""
    return train_catalog.stats()


@router.get("/catalog/trains")
def catalogue_trains(
    q: str = Query("", max_length=120, description="Train number/name or any route station"),
    source: str = Query("", max_length=16, description="Exact origin station code"),
    destination: str = Query("", max_length=16, description="Exact destination station code"),
    via: str = Query("", max_length=16, description="Exact station code anywhere on the route"),
    train_type: str = Query("", alias="type", max_length=24),
    running_day: str = Query("", max_length=9, description="SUN..SAT"),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Ranked, paginated search across every uploaded scheduled train.

    The live simulation remains intentionally limited to six explainable demo
    trains; catalogue results are explicitly labelled `timetable_catalogue`.
    """
    try:
        result = train_catalog.search(
            q, source=source, destination=destination, via=via,
            train_type=train_type, running_day=running_day,
            limit=limit, offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    live = {train["number"] for train in _snapshot()["trains"]}
    for train in result["trains"]:
        train["live_demo_available"] = train["number"] in live
    return result


@router.get("/catalog/trains/{number}")
def catalogue_train_detail(number: str):
    """Scheduled metadata and calling stops for one uploaded train."""
    train = train_catalog.detail(number)
    if train is None:
        raise HTTPException(404, f"train {number} is not in the installed catalogue parts")
    train["live_demo_available"] = any(
        row["number"] == number for row in _snapshot()["trains"]
    )
    return train


@router.get("/catalog/trains/{number}/route")
def catalogue_train_route(
    number: str,
    scope: str = Query("service", pattern="^(service|raw)$"),
    calling_only: bool = Query(False),
    limit: int = Query(700, ge=1, le=700),
    offset: int = Query(0, ge=0),
):
    """Full supplied route, or its normalised source-to-destination slice.

    `scope=raw` exposes prefix/suffix rows retained for source auditing;
    `scope=service` is the passenger-facing route. Use `calling_only=true`
    to omit pass-through timing points.
    """
    try:
        result = train_catalog.route(
            number, scope=scope, calling_only=calling_only,
            limit=limit, offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if result is None:
        raise HTTPException(404, f"train {number} is not in the installed catalogue parts")
    return result


@router.get("/trains")
def trains():
    return {"trains": _snapshot()["trains"]}


@router.get("/trains/{number}")
def train_detail(number):
    snap = _snapshot()
    rec = next((r for r in snap["trains"] if r["number"] == number), None)
    if not rec:
        raise HTTPException(404, f"unknown train {number}")
    return rec


@router.get("/trains/{number}/eta")
def train_eta(number):
    """Predicted ETA + confidence range for the train's next stop —
    the single most important endpoint for downstream integrators."""
    rec = next((r for r in _snapshot()["trains"] if r["number"] == number), None)
    if not rec:
        raise HTTPException(404, f"unknown train {number}")
    if rec["status"] == "arrived":
        return {"train": number, "status": "arrived_at_destination"}
    return {
        "train": number,
        "next_station": {"code": rec["next_station_code"], "name": rec["next_station_name"]},
        "scheduled": rec["sched_next_time"],
        "predicted_eta": rec["eta_next_time"],
        "confidence_range_min": rec["eta_range"],
        "display": f"{rec['eta_next_time']} ± {rec['eta_range']} min (68% confidence)",
        "source": rec["eta_source"],
        "position_source": rec.get("position_source", "simulation"),
        "telemetry_age_s": rec.get("telemetry_age_s"),
        "weather_source": (rec.get("weather_live") or {}).get("provider", "simulation"),
        "current_delay_min": rec["delay"],
        "data_fresh": not _snapshot()["kpis"]["stale"],
    }


@router.get("/trains/{number}/cause")
def train_cause(number):
    rec = next((r for r in _snapshot()["trains"] if r["number"] == number), None)
    if not rec:
        raise HTTPException(404, f"unknown train {number}")
    return {"train": number, "expected_extra_min": rec["cause_total"],
            "breakdown": rec["cause"],
            "note": "Coefficients come from the linear explainer model — see /api/analytics/model"}


@router.get("/stations")
def stations(
    q: str = Query("", max_length=120, description="Code, name, state, zone or address"),
    state_name: str = Query("", alias="state", max_length=80),
    zone: str = Query("", max_length=16),
    valid_only: bool = Query(False, description="Only records with usable coordinates"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Search the complete user-supplied station catalogue.

    Results are paginated so the 1.9 MB catalogue is not retransmitted with
    every live-data refresh. Exact/prefix code matches rank before names.
    """
    matches = ST.search(q, state=state_name, zone=zone, valid_only=valid_only)
    return {
        "stations": matches[offset:offset + limit],
        "total": len(matches),
        "offset": offset,
        "limit": limit,
        "catalogue": ST.SOURCE_STATS,
    }


@router.get("/stations/geojson")
def station_geojson():
    """One-time, cacheable map layer for all valid source coordinates."""
    return Response(
        content=_station_geojson_payload(),
        media_type="application/geo+json",
        headers={
            "Cache-Control": "public, max-age=3600",
            "X-RailSync-Station-Count": str(ST.SOURCE_STATS["valid_coordinates"]),
        },
    )


@router.get("/stations/{code}")
def station_detail(code: str):
    """Return one station record, including provenance and alias metadata."""
    code = code.strip().upper()
    if code not in ST.BY_CODE:
        raise HTTPException(404, f"unknown station {code}")
    return {"station": ST.BY_CODE[code], "equivalent_codes": sorted(ST.equivalent_codes(code))}


@router.get("/stations/{code}/board")
def station_board(code: str):
    code = code.strip().upper()
    if code not in ST.BY_CODE:
        raise HTTPException(404, f"unknown station {code}")
    equivalent_codes = ST.equivalent_codes(code)
    placeholders = ",".join("?" for _ in equivalent_codes)
    catalogue_services = db.query(
        f"SELECT COUNT(DISTINCT train_number) AS n FROM catalog_stops "
        f"WHERE station_code IN ({placeholders}) AND in_service_route=1 AND is_scheduled_stop=1",
        tuple(sorted(equivalent_codes)),
    )[0]["n"] if equivalent_codes else 0
    with STT.STATE["lock"]:
        snap = STT.STATE["snapshot"]
        clock = STT.STATE["clock"]
        last_update = STT.STATE["last_update"]
        rows = []
        served_by_demo = False
        for t in STT.STATE["trains"].values():
            match = next(
                ((idx, stop_code) for idx, stop_code in enumerate(t["stops"])
                 if stop_code in equivalent_codes),
                None,
            )
            if match is None:
                continue
            served_by_demo = True
            idx, stop_code = match
            if t["at_station"] and t["leg"] == idx:
                rows.append({"number": t["number"], "name": t["name"],
                             "time": STT.iso(clock), "scheduled": STT.iso(t["sched_arr"][idx] + t["epoch"]),
                             "platform": t["platforms"].get(stop_code, 1), "delay": 0,
                             "status": "BOARDING"})
                continue
            if t["leg"] > idx:
                continue  # already passed this station this trip
            if t["at_station"] and t["leg"] == idx:
                continue
            etas, _, stale = _engine.station_etas(t, STT.STATE["segments"], clock, last_update)
            row = next((e for e in etas if e["seq"] == idx), None)
            if not row:
                continue
            d = row["delay_min"]
            status = "ON TIME" if d < 5 else (f"DELAYED {round(d)} MIN" if d >= 0 else f"EARLY {round(-d)} MIN")
            rows.append({"number": t["number"], "name": t["name"],
                         "time": STT.iso(row["eta_min"]), "scheduled": STT.iso(row["scheduled_min"]),
                         "platform": t["platforms"].get(stop_code, "—"), "delay": d,
                         "status": status, "source": "historical_fallback" if stale else "model"})
        rows.sort(key=lambda r: r["time"])
        return {
            "station": ST.BY_CODE[code],
            "equivalent_codes": sorted(equivalent_codes),
            "clock": STT.iso(clock),
            "rows": rows[:10],
            "served_by_demo": served_by_demo,
            "catalogue_services": catalogue_services,
            "stale": (time.time() - last_update) > config.STALE_AFTER_SECONDS,
        }


@router.get("/congestion")
def congestion():
    return {"sections": _snapshot()["congestion_rank"]}


@router.get("/accuracy")
def accuracy():
    rows = db.query("SELECT ts, train_number, station_code, predicted, actual, abs_error "
                    "FROM accuracy_log ORDER BY id DESC LIMIT 60")
    rows.reverse()
    recent = rows[-20:]
    rolling = round(sum(r["abs_error"] for r in recent) / len(recent), 2) if recent else None
    return {"rolling_mae": rolling, "n": len(db.query("SELECT 1 FROM accuracy_log")),
            "points": rows}


# ------------------------------------------------------------------- history
@router.get("/analytics/trends")
def trends():
    rows = db.query("SELECT train_number, date, AVG(extra) avg_delay, COUNT(*) n "
                    "FROM hist_leg GROUP BY train_number, date")
    by_date, by_hour = {}, []
    for r in rows:
        by_date.setdefault(r["date"], {})[r["train_number"]] = round(r["avg_delay"], 2)
    hour_rows = db.query("SELECT hour, AVG(extra) avg_delay FROM hist_leg GROUP BY hour ORDER BY hour")
    by_hour = [{"hour": r["hour"], "avg_delay": round(r["avg_delay"], 2)} for r in hour_rows]
    return {"days": [{"date": d, **vals} for d, vals in sorted(by_date.items())],
            "by_hour": by_hour}


@router.get("/analytics/model")
def model_info():
    p = config.MODELS_DIR / "metrics.json"
    if not p.exists():
        raise HTTPException(503, "models not trained yet")
    return json.loads(p.read_text())


# ------------------------------------------------------------------- alerts
class AlertIn(BaseModel):
    train: str
    threshold: int = 10


@router.get("/alerts")
def alerts():
    with STT.STATE["lock"]:
        return {"alerts": STT.STATE["alerts"]}


@router.post("/alerts")
def create_alert(a: AlertIn):
    t = STT.STATE["trains"].get(a.train)
    if not t:
        raise HTTPException(404, f"unknown train {a.train}")
    if a.threshold < 1:
        raise HTTPException(422, "threshold must be >= 1 minute")
    with STT.STATE["lock"]:
        STT.STATE["alert_seq"] += 1
        alert = {"id": STT.STATE["alert_seq"], "train": a.train, "threshold": a.threshold,
                 "base_delay": round(t["delay"], 1), "status": "monitoring",
                 "message": f"Watching {a.train} {t['name']} — will alert if delay moves "
                            f"more than {a.threshold} min from {t['delay']:+.0f} min.",
                 "triggered_at": None, "expires": None, "last_trig": 0}
        STT.STATE["alerts"].append(alert)
        return alert


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: int):
    with STT.STATE["lock"]:
        before = len(STT.STATE["alerts"])
        STT.STATE["alerts"] = [a for a in STT.STATE["alerts"] if a["id"] != alert_id]
        if len(STT.STATE["alerts"]) == before:
            raise HTTPException(404, "alert not found")
        return {"deleted": alert_id}


# ------------------------------------------------------------------ control
class ControlIn(BaseModel):
    sim_speed: int | None = None
    paused: bool | None = None


@router.post("/control")
def control(c: ControlIn):
    with STT.STATE["lock"]:
        if c.sim_speed is not None:
            if c.sim_speed not in (1, 2, 4, 8, 16):
                raise HTTPException(422, "sim_speed must be one of 1,2,4,8,16")
            STT.STATE["sim_speed"] = c.sim_speed
        if c.paused is not None:
            STT.STATE["paused"] = bool(c.paused)
            if not c.paused:
                STT.STATE["last_update"] = time.time()
        return {"sim_speed": STT.STATE["sim_speed"], "paused": STT.STATE["paused"]}


class EventIn(BaseModel):
    type: str  # storm | blockage | signal


@router.post("/control/event")
def control_event(e: EventIn):
    with STT.STATE["lock"]:
        if e.type == "storm":
            ENG.spawn_weather(STT.STATE["segments"])
        elif e.type == "blockage":
            ENG.spawn_blockage(STT.STATE["segments"])
        elif e.type == "signal":
            ENG.spawn_signal(STT.STATE["segments"])
        else:
            raise HTTPException(422, "type must be storm|blockage|signal")
        return {"spawned": e.type, "events": STT.STATE["events"][:3]}
