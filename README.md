# RailSync Live — journey companion on live Indian Railways telemetry

One request, five curated APIs + three keyless open-data sources, joined
server-side into a single honest journey view. Same design language as the
original RailSync workspace, rebuilt from scratch as a **passenger companion**.

## What it does

* Search any train number → **RailRadar** live fix: position, speed, delay, route halts.
* **Overpass OSM** (keyless): the raw fix is projected onto real mapped rail
  (±1.5 km guard). A successful snap draws the actual track polyline under the
  marker; outside the guard the raw fix is shown *labelled*, never faked.
* **OpenWeather** at the fix and at the next three halts (halts geocoded
  keyless via **Nominatim**), converted to a published 0–1 ETA-severity score.
* **Open-Meteo** (keyless) batch DEM → elevation profile fix → next halts;
  **OpenTopography COP30** cross-check at the exact fix.
* **Geoapify** (browser key) reverse-geocodes the fix into a human place name.
* **MapTiler** vector basemap; a restricted/quota-exceeded key flips once to
  free CARTO/OSM raster with a visible note. The map is never a black box.
* Trains that are not running right now say so honestly — no fake movement.

## Zero-environment deployments

All keys (server + browser) live in the committed `.env.production`.
Resolution order everywhere: **OS/Render env → .env.production**.
`frontend/vite.config.js` sets `envDir: '..'` and the Dockerfile copies the
file into both build stages, so `npm run build` and backend boot need nothing.
Rotate keys after the demo, or make the repository private.

## Run locally

```bash
pip install -r backend/requirements.txt
cd frontend && npm install && npm run build && cd ..
cd backend && uvicorn app.main:app --port 8000
# open http://localhost:8000
```

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | liveness + configured provider count |
| `GET /api/search?q=` | number passthrough + curated suggestions |
| `GET /api/journey/{no}` | full companion view (60 s server cache) |
| `POST /api/journey/{no}/refresh` | bypass cache, fresh RailRadar pull |
| `GET /api/providers` | per-provider live health (keys never exposed) |
| `GET /api/meta` | poll cadence + snap guard for UI copy |

## Design notes for judges

* Every provider failure degrades visibly (chip + reason), never a crash.
* The weather→ETA severity function is published in `clients.py`, explainable
  term by term — not an opaque model.
* Snap honesty: raw vs snapped is always labelled with the correction in metres.
* `index.html` ships `no-store`; hashed assets ship immutable — stale-bundle
  cache ghosts are structurally impossible.
