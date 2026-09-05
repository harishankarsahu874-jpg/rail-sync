"""RailSync backend — FastAPI app entry point.

Startup (idempotent, one-command demo):
  1. seed the database if empty            (python -m app.seed)
  2. train the models if missing           (python -m app.train)
  3. init live simulation state + thread   (15s ticks, WS broadcast)
Serves the built React app from frontend/dist (or RAILSYNC_DIST).
"""
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, train_catalog
from .api import router as api_router, set_engine, set_providers
from .ml.predict import EtaEngine
from .providers import ProviderManager
from .sim import state as STT
from .sim import engine as SIM


class WSHub:
    """Fan-out for the live snapshot over /ws. The REST layer is the
    fallback for clients where WebSockets are unavailable."""

    def __init__(self):
        self.clients: set[WebSocket] = set()
        self.lock = threading.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        with self.lock:
            self.clients.add(ws)

    def disconnect(self, ws: WebSocket):
        with self.lock:
            self.clients.discard(ws)


hub = WSHub()
_stop = threading.Event()
_engine: EtaEngine | None = None
_providers: ProviderManager | None = None
_loop = None  # main event loop, captured at startup for thread-safe WS broadcast


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _engine, _providers, _loop
    import asyncio
    _loop = asyncio.get_running_loop()
    _stop.clear()
    db.init()
    from .seed import needs_seed, run as seed_run
    reseeded = needs_seed()
    if reseeded:
        print("[boot] catalogue/routes changed — seeding demo data")
        seed_run()
    if reseeded or not (config.MODELS_DIR / "predictor.joblib").exists():
        from .ml.train import train as train_run
        print("[boot] training model for current seeded routes (one-off, a few seconds)")
        train_run()
    try:
        catalogue = train_catalog.rebuild()
    except Exception as exc:
        catalogue = train_catalog.mark_degraded(exc)
        print(f"[catalog] new part rejected; keeping last good index: {exc}")
    _engine = EtaEngine()
    set_engine(_engine)
    STT.init_state()
    _providers = ProviderManager()
    set_providers(_providers)
    _providers.start(STT.STATE, _engine, _stop)
    SIM.start_thread(_engine, lambda p: _broadcast(p), _stop)
    configured = _providers.public_status()["configured_real"]
    print(f"[boot] RailSync live: {len(STT.STATE['trains'])} simulated + "
          f"{catalogue.get('trains', 0)} catalogue trains, model MAE {_engine.mae} min, "
          f"tick {config.TICK_SECONDS}s, API providers configured {configured}/5")
    yield
    _stop.set()


def _broadcast(payload: str):
    """Thread-safe fan-out from the sim thread to the event loop."""
    import asyncio
    if _loop is not None and _loop.is_running():
        try:
            asyncio.run_coroutine_threadsafe(_async_broadcast(payload), _loop)
        except RuntimeError:
            pass


async def _async_broadcast(payload: str):
    with hub.lock:
        clients = list(hub.clients)
    for ws in clients:
        try:
            await ws.send_text(payload)
        except Exception:
            with hub.lock:
                hub.clients.discard(ws)


app = FastAPI(title="RailSync API", version="1.3.0", lifespan=lifespan,
              description="Live coach-train tracking + explainable ETA prediction (SIH prototype). "
                          "Includes user-supplied searchable station and multi-part train catalogues. Hybrid "
                          "provider mode uses RailRadar, OpenWeather, OpenTopography, MapTiler, "
                          "Geoapify and Overpass when configured, with explicit demo fallbacks.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(api_router)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()   # keep-alive; server pushes snapshots
    except WebSocketDisconnect:
        hub.disconnect(ws)


# ----------------------------------------------------------------- static SPA
def _serve_spa(path: str):
    if not config.DIST_DIR.exists():
        return JSONResponse(
            status_code=503,
            content={"detail": "frontend build missing — run: cd frontend && npm install && npm run build"})
    candidate = (config.DIST_DIR / path).resolve()
    if path and candidate.is_file() and str(candidate).startswith(str(config.DIST_DIR.resolve())):
        return FileResponse(candidate)
    index = config.DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse(status_code=503, content={"detail": "index.html missing in dist"})


@app.get("/{full_path:path}")
def spa(full_path: str):
    return _serve_spa(full_path)
