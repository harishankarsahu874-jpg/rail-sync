"""RailSync Live — FastAPI entrypoint.

Serves the REST API and the built React SPA from a single port (Render-free
local dev: `uvicorn app.main:app` from backend/). index.html is always
no-store so browsers can never pin a stale hashed bundle; hashed assets are
immutable for a year.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import config, trains_media
from .api import router, set_manager
from .providers.manager import ProviderManager

app = FastAPI(title="RailSync Live", version="1.0.0",
              description="Passenger journey companion on live Indian Railways telemetry.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_manager = ProviderManager()
set_manager(_manager)
app.include_router(router)


@app.get("/api/meta")
def meta():
    """Frontend bootstrap: poll cadence + snap guard for honest UI copy."""
    return {"poll_seconds": config.POLL_SECONDS, "snap_guard_m": config.SNAP_GUARD_METERS}


@app.get("/{full_path:path}")
def spa(full_path: str):
    if not config.DIST_DIR.exists():
        return JSONResponse(status_code=503, content={"detail": "frontend build missing — run: cd frontend && npm install && npm run build"})
    candidate = (config.DIST_DIR / full_path).resolve()
    if full_path and candidate.is_file() and str(candidate).startswith(str(config.DIST_DIR.resolve())):
        headers = {"Cache-Control": "public, max-age=31536000, immutable"} \
            if candidate.parent.name == "assets" else None
        return FileResponse(candidate, headers=headers)
    index = config.DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-store, no-cache, must-revalidate",
                                            "Pragma": "no-cache"})
    return JSONResponse(status_code=503, content={"detail": "index.html missing in dist"})


@app.on_event("startup")
def _start_photo_prewarm() -> None:
    """Fill the per-train photo cache for all 5,139 services in background."""
    trains_media.start_prewarm()
