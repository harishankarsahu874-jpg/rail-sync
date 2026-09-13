# RailSync — Live Coach-Train Intelligence for Indian Railways

**SIH hackathon prototype.** Real-time tracking of long-distance coach trains with an
**explainable, confidence-bounded ETA engine**, delay-cause breakdown, station boards,
passenger alerts, an operations control room, and an incrementally imported timetable catalogue.

> Every ETA is recomputed on a 15-second tick. The ML model's error is **measured and
> displayed (MAE 1.87 min, RMSE 2.81 min on a 740-leg / 10-day holdout)** — we do not
> claim "99% accurate" anywhere, and every ETA ships with a **± confidence range**. External APIs are used
> when configured; their status and every fallback are visible in the UI.

---

## One-command demo

```bash
bash scripts/run.sh
# → http://localhost:8000   (API at /api, interactive docs at /docs)
```

`run.sh` creates a venv, installs deps, validates the seed and train-part manifests,
rebuilds stale SQLite indexes/models, builds the frontend, and starts the server. The server
**self-heals** when the DB, model, station source or installed train parts change.

Docker:

```bash
docker compose up --build
# → http://localhost:8000
```

## External API setup (hybrid live-data mode)

RailSync is **API-first but demo-safe**. Copy the template, add the keys you own, and
restart. A missing/rate-limited provider is shown as fallback/degraded and never blanks
another provider or stops the ETA engine.

```bash
cp .env.example .env
# edit .env, then:
bash scripts/run.sh
```

| Provider | Environment variable | How RailSync uses it |
|---|---|---|
| **RailRadar** | `RAILRADAR_API_KEY` | Demand-syncs a selected train from `GET /v1/trains/{number}/live`; a valid running response uses its reported coordinate directly for a short TTL, then visibly falls back to route-based dead reckoning between quota-cached calls |
| **MapTiler** | `VITE_MAPTILER_API_KEY` + optional `VITE_MAPTILER_STYLE` | MapLibre renders the configured MapTiler style (`hybrid-v4` in this deployment; `basic-v2-dark` by default); invalid/missing keys fall back to CARTO/OSM raster tiles |
| **OpenWeather** | `OPENWEATHER_API_KEY` | Current observations at active train sections are converted by a published deterministic formula to the model's 0–1 weather-severity input |
| **OpenTopography** | `OPENTOPOGRAPHY_API_KEY` | On-demand COP30 point elevation for a clicked map location; persisted ~1 km cells protect the daily query quota |
| **Geoapify** | `VITE_GEOAPIFY_API_KEY` | Browser-side reverse geocoding for map clicks |
| **Overpass OSM** | no key | Nearby named rail stations and railway-way count for map clicks (six-hour server cache) |

Server-only keys never enter API responses or the JavaScript bundle. `VITE_*` keys are
browser credentials by design; restrict them to your deployment origins in MapTiler and
Geoapify. Provider health (without secrets) is at `GET /api/providers`.

**RailRadar quota:** its free sandbox is documented as 1,000 calls/month, so fleet-wide
auto-sync is off by default. The per-train **Sync live RailRadar telemetry** button uses a
five-minute cache. Set `RAILRADAR_AUTO_SYNC=true` and tune `RAILRADAR_POLL_SECONDS` only
for a plan whose quota supports it.

### Map tracks and position accuracy

The hybrid satellite style's stock `Railway` layer starts at zoom 11 even though MapTiler's
railway vector source is available from zoom 6. RailSync adds a high-contrast mapped-rail
layer from zoom 6 and focuses a selected train at corridor zoom, so actual mapped tracks are
visible over the imagery. The white line is mapped railway; a coloured dashed line is the
service path.

Position provenance is intentionally explicit:

* `RAILRADAR REPORTED POINT` preserves `currentLocation.coordinates` from a **running**, fresh
  provider response as the source fix. For display, Turf `nearestPointOnLine` may move it to
  the closest loaded MapTiler railway only when that correction is ≤2.5 km; the UI then says
  `TRACK-SNAPPED` and displays the correction distance.
* `RAILRADAR-ANCHORED ESTIMATE` means the last provider anchor is being dead-reckoned.
* `SIMULATED POSITION` is not GPS. The backend maps the current model leg to a distance on the
  uploaded timetable's dense pass-through station chain (typically 198–281 points); Turf `along`
  places the candidate at that distance, then `nearestPointOnLine` snaps it to a loaded mapped
  railway within a guarded 12 km radius. This avoids treating unequal model legs as one global
  percentage of a differently sized visual polyline.

`LiveRailMap.jsx` keeps one MapLibre instance and one marker object per train. WebSocket frames,
MapTiler railway tile loads, and map `moveend` events update only `marker.setLngLat(...)`; the
map is never remounted. Distance guards prevent a bad coordinate from jumping to an unrelated
branch line. Construction alignments are excluded from both the visible rail overlay and the
snap candidates, so a marker cannot be matched to a hidden unfinished line.

The repository currently contains **no supplied per-train true-track GeoJSON files**. An audit
of the six loaded service paths confirms they are over-simplified station chains: 198–281 points,
median vertex gaps of 5.47–7.90 km, maximum gaps of 14.23–27.14 km, and only 13.0–17.3 vertices
per 100 km. They are therefore labelled `uploaded_timetable_station_chain`, never genuine track.
The coloured service path connects known station coordinates rather than every rail vertex. If
an ordered WGS84 LineString is placed at
`backend/app/data/track_geometry/<train-number>.geojson`, RailSync validates it and switches to
drift-free Turf `along(trackLine, pos_km)` placement using distance travelled directly. A fresh
provider fix is instead matched to that train-specific line with `nearestPointOnLine` (5 km
safety guard), preserving the provider coordinate as source telemetry and reporting the visual
correction separately. Check point density, endpoint offsets and gaps with:

```bash
python scripts/validate_track_geometry.py path/to/12301.geojson --train 12301
npm --prefix frontend run test:positioning
```

To build a detailed line from OpenStreetMap/OpenRailwayMap data:

1. Look for an OSM `route=train` or `route=railway` relation covering the corridor. Many Indian
   services have no complete service relation, so do not assume the train number will resolve.
2. In Overpass Turbo, download bounded corridor sections—not one nationwide query. For a visible
   map extent, `(way["railway"="rail"]({{bbox}});); (._;>;); out body;` returns rail ways and
   their nodes. Repeat for manageable station-to-station sections.
3. Join ways by shared OSM node IDs in route order, use the timetable station sequence to choose
   the correct branch at junctions, discard construction/disused sidings, and preserve curve
   vertices. QGIS/QuickOSM or a small `osmium`/GeoPandas pipeline can perform the merge.
4. Export one continuous origin-to-destination EPSG:4326 GeoJSON `LineString` in
   `[longitude, latitude]` order, retain OSM attribution, and run the validator above. Do not
   merely draw straight station-to-station segments or aggressively simplify the result.

OpenRailwayMap is useful for visual verification because it renders OSM rail tagging, but its
rendered tiles are not themselves reusable route geometry.

## Authoritative station catalogue

RailSync ships with the **user-supplied `stations.json`** as
`backend/app/data/stations_catalog.json`; it is no longer a tiny hard-coded demo list.
The source is installed unchanged and normalised at runtime:

| Catalogue fact | Count / behaviour |
|---|---|
| Source records / unique source codes | **8,990 / 8,990** |
| Runtime searchable records | **8,994** (source + four current-code aliases) |
| Records with usable, non-zero coordinates | **8,697** (clustered on the live map) |
| Missing/zero-coordinate records | **293** (kept searchable, omitted from geometry) |
| Valid records with supplied state or address | **4,213** |
| Valid records with a known supplied zone | **4,171** (`?` is not counted as known) |
| Renamed-code compatibility | `DDU→MGS`, `MMCT→BCT`, `PRYJ→ALD`, `VGLJ→JHS`; both forms stay searchable and provenance is returned |

`GET /api/stations` provides ranked, paginated search by code/name/state/zone/address;
`GET /api/stations/geojson` is a cacheable one-time map layer. Only the active-route
subset rides in the 15-second WebSocket snapshot, avoiding a recurring ~1.9 MB payload.
The station board accepts any catalogue code—even a station outside the six demo routes—and
clearly returns an empty demo board rather than pretending a service calls there.

The catalogue also corrected legacy seed mistakes rather than hiding them: `ADT` remains
**Aduturai**, Ahmedabad is `ADI`, `BVI` is Borivali and `RTM` is Ratlam. Demo stop sequences
now follow the real corridors and current termini, with published route distance/duration
calibration. To validate and replace the catalogue later:

```bash
python scripts/import_stations.py path/to/stations.json
```

## Incremental train timetable catalogue

The first five user-supplied train parts are integrated as a separate, searchable timetable
catalogue. RailSync deliberately keeps this distinct from the six-train live simulation:
a timetable record is never presented as live telemetry or given a fabricated ETA.

| Imported fact | Current value |
|---|---|
| Installed parts | **5** (`trains_part1.json` through `trains_part5.json`) |
| Unique trains | **5,208** (711 + 744 + 636 + 2,875 + 242; no duplicate numbers) |
| Supplied raw route/timing rows | **416,637** |
| Normalised source-to-destination route rows | **396,843** |
| Derived calling-stop rows | **113,767** |
| Unique route station codes | **8,539 / 8,539 matched** to the station catalogue |
| Route station codes with usable coordinates | **8,247**; 292 remain unplottable |

The original ~92 MiB of JSON is preserved field-for-field in deterministic gzip parts
(~7.4 MiB total) under `backend/app/data/train_catalog/`. SQLite is only a rebuildable
search index. Source hashes, per-part counts and type breakdowns are retained in
`manifest.json` and exposed at `GET /api/catalog/meta`.

The importer handles source imperfections explicitly: it retains all raw rows, marks the
passenger-facing source→destination slice, and returns quality flags rather than inventing
missing endpoints or times. Across the five parts, 4,480 routes validate cleanly; 728 carry
one or more transparent warnings (primarily an untimed prefix before the declared source).

Passenger Search now combines live services with timetable results, including running days,
distance, supplied calling stops and source-part provenance. Station pages also report how
many currently imported scheduled services call there.

```bash
# Reinstall the current five-part catalogue
python scripts/import_trains.py --replace trains_part1.json trains_part2.json \
  trains_part3.json trains_part4.json trains_part5.json

# Append any later parts without removing parts 1–5
python scripts/import_trains.py trains_part6.json trains_part7.json
```

A changed part manifest is detected on boot and the catalogue index is rebuilt automatically.
A malformed/duplicate later part is rejected while the last good index and six-train demo stay available.

## Public landing → search → live-tracking flow

The supplied light/teal frontend scaffold has been merged rather than copied over the existing
operations product. `/` is the public landing page and `/live/{trainNumber}` is a shareable
tracking URL. `Ctrl/⌘ K`, example searches, featured services and local recent history all open
the same real search surface. It queries the live WebSocket snapshot and
`GET /api/catalog/trains`; catalogue-only selections route to provenance-rich timetable details
instead of receiving a fabricated live position.

The live page mounts the existing MapLibre map, real weather/provider state, on-demand
OpenTopography/Overpass context, route-delay analytics and backend ETA/cause values. The supplied
mock-data layer and placeholder panels were deliberately not introduced. One app-level WebSocket
updates state every 15 seconds without remounting the map; REST polling remains the transport
fallback.

## The 4-minute judge walkthrough

1. **Public landing and search** (`/`) — use the hero search, `Ctrl/⌘ K`, example chips,
   featured services, or local recent history. Search spans the six active services and all
   **5,208 uploaded timetable trains**; timetable-only results are never labelled live.
2. **Shareable live tracking** (`/live/12953`) — the supplied light/teal flow is connected
   to RailSync's real WebSocket state rather than scaffold mocks. Show position provenance,
   freshness, **predicted ETA ± confidence range**, measured MAE, the always-visible
   **Why this ETA?** breakdown, a persistent station timeline, live MapLibre map, weather,
   provider-backed point terrain, and remaining-route delay analytics. The map stays mounted
   while state updates, avoiding refresh flicker.
3. **Live Network** (`/network`) — six coach services moving on a MapTiler vector map (OSM
   fallback). Provider pills state exactly what is live. Click the map for Geoapify +
   OpenWeather + COP30 elevation + nearby Overpass rail context; click a train for speed,
   last/next station and the quota-cached RailRadar sync button.
4. **Control Room** (`/control`) — set sim speed to **×16**, hit **Pause feed**: watch the
   top-bar flip to **STALE — historical fallback** (the ETA source tag flips MODEL → HIST
   AVG and the range widens). Pause again. Then **Inject incident → Line blockage**:
   watch ETAs on affected routes move within one tick and the congestion ranking update.
5. **Station Boards** (`/stations`) — search any of **8,990 supplied stations**, then pick
   **NDLS** for the classic yellow-on-black board; try `DDU`/`MGS` to show alias provenance.
6. **Passengers** (`/passengers`) — search `12301` to compare its **live ETA** card with
   the uploaded timetable, or search `Jammu` across all 5,208 records. Open a live train,
   set a **5-minute alert**, and crank sim speed; SMS/push remains an explicit mock.
7. **Analytics** (`/analytics`) — the trust page: **measured** MAE/RMSE/R², published cause
   coefficients, 60-day delay trends, rush-hour pattern, predicted-vs-actual from live runs.

---

## Architecture

```
                ┌─────────────────────────── 15 s tick ───────────────────────────┐
                │                                                                 │
  ┌───────────┐ │   ┌────────────────┐     ┌───────────────────────────────┐      │
  │  Simulator │─┼─▶│  Live state    │────▶│  ETA engine                    │      │
  │  (thread)  │   │  trains, segs,  │     │  scheduled + live conditions   │      │
  │ weather/   │   │  alerts, clock  │     │  + RandomForest residual       │      │
  │ signals/   │   └────────────────┘     │  + stale→historical fallback   │      │
  │ congestion │         ▲                └──────────────┬──────────────────┘      │
  └───────────┘         │                               │                         │
        ▲                │        ┌──────────┐           ▼                         │
        │ incidents      └────────│  SQLite  │     ┌───────────────────────┐       │
  ┌────────────┐                 │ stations,│     │  Snapshot (JSON)       │       │
  │ REST /api  │─────────────────│ route_st,│     │  → WebSocket /ws push  │       │
  │ /control/… │                 │ hist_leg,│     │  → REST /api/state     │       │
  └────────────┘                 │ accuracy │     └───────────────────────┘       │
                                 └──────────┘            │                          │
                                                         ▼                           │
                                              React + Tailwind + MapLibre + Recharts │
                                              (public flow + 5 ops views, WS/poll)   │
```

| Layer | Tech | Why |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind, MapLibre/MapTiler, Recharts | Vector maps, fast to build, easy to read |
| Backend | FastAPI + Uvicorn | Async, auto OpenAPI at `/docs` |
| Live state | In-memory, one thread, 15 s ticks | Demo-grade, trivially explainable |
| Persistence | SQLite (WAL) | Zero-ops; schema shown in `db.py` |
| ML | scikit-learn (RandomForest + Ridge) | Simple, explainable, no deep learning |
| Provider gateway | Python stdlib HTTP + persistent TTL cache | No extra service; partial success and quota protection |

In hybrid mode, RailRadar re-anchors `position + speed + measured delay`; OpenWeather
replaces the active section's simulated weather baseline. Signals/congestion/dwell remain
demo inputs until their Indian Railways feeds are available. If either live provider is
stale or fails, the same state object continues from the last anchor and clearly labels
the fallback.

### How an ETA is computed (the defensible part)

```
ETA(next stop) = now
               + remaining scheduled minutes from the CURRENT position   ← delay carries
                 (computed from the live position — an existing delay
                 automatically persists; fast trains partially recover)
               + deterministic slowdown from live conditions              ← RTIS+IMD+CTC
                 (weather, congestion, active signal hold — using the
                 exact same physics law the simulator uses, so nothing
                 is double-counted)
               + learned residual (RandomForest), scaled by remaining leg ← the "ML"
```

* **Confidence range**: the next-stop interval uses measured holdout MAE × √1.25 and is
  widened ×1.6 when stale (currently about ±2.1 min live). It is derived, never hard-coded.
* **Fallback (data freshness)**: if the live feed is older than 40 s, the residual term is
  replaced by the historical route×hour average and the UI says so (HIST AVG tag, widened
  range). Stale data is never dressed up as live.
* **Explainability**: a separate **linear** model (Ridge) predicts delay as a *fraction of
  scheduled leg-time* per cause; its coefficients are published on the Analytics page and
  drive the cause bar. The explanation **is** the model — no black box, no SHAP hand-waving.

## Repository layout

```
backend/
  app/
    main.py            FastAPI app: lifespan boot, WS hub, serves frontend
    api.py             all REST endpoints (documented in the docstring)
    config.py          every tunable in one place
    db.py              SQLite schema + helpers
    seed.py            demo data: routes from real coordinates, 60-day history
    train_catalog.py   incremental train-part SQLite importer + search helpers
    data/              station catalogue, live roster, compressed train_catalog parts
    ml/features.py     feature vector — shared by train + inference
    ml/train.py        trains predictor (RF) + explainer (Ridge), writes metrics.json
    ml/predict.py      the ETA engine + confidence + cause breakdown
    sim/state.py       in-memory live state (trains, shared track sections)
    sim/engine.py      the 15-second tick: incidents, movement, alerts, snapshot
    providers/         safe HTTP clients, response adapters, TTL cache + hybrid manager
frontend/
  src/pages/           LandingPage + LiveTrackingPage public flow; five operations views
  src/components/SearchModal.jsx real live/catalogue search + keyboard navigation
  src/components/LiveRailMap.jsx  MapLibre vector map + live HTML train markers
  src/services/geography.js      MapTiler/Geoapify browser adapters
  src/services/positioning.js    Turf along + guarded nearest-rail marker placement
  src/hooks/useLive.js WS push with REST-polling fallback
  src/hooks/useLocalList.js localStorage-backed recent train history
  src/components/      sidebar, topbar (freshness pill), toasts, shared bits
scripts/
  run.sh               one-command demo (setup + start)
  import_stations.py   validates/installs the authoritative station JSON
  import_trains.py     validates/compresses/appends timetable JSON parts
  validate_track_geometry.py checks true-track GeoJSON density, gaps and endpoints
  import_real.py       contract for swapping in real delay data
```

## Simulated data → real IR systems (the pitch mapping)

| RailSync source today | Production Indian Railways integration | What it provides |
|---|---|---|
| **RailRadar API** when keyed; simulator otherwise | **RTIS** (Real-Time Train Information System, ISRO-assisted satellite/GNSS locotracking) + telemetry | Position, speed and measured delay; the adapter boundary can be swapped from RailRadar to RTIS without changing ETA code |
| Real-corridor stop sequence + calibrated duration; demo-shifted departure clock | **DMS** (Daily Movement Sheet) | The authoritative scheduled movement |
| **OpenWeather API** when keyed; scenario baseline otherwise | **IMD** feeds to RSDC zone weather cells | Current rain/wind/visibility become an explainable 0–1 section severity |
| Signal holds / line blockages | **CTC/ATC** signalling + train-dispatching (signal aspects, line-block status) | Section occupancy, holds |
| Congestion index per section | Section telemetry / block-section occupancy (dispatching data) | Utilisation of shared sections |
| Passenger ETA + "notify me" | **NTES / NTES 3.0** + IRCTC APIs | Live enquiry + alerting surfaces |
| Station board | NTES-driven station display boards | Platform + expected time |
| Historical delay records | NTES historical, **IRS 3.0** open data, public Kaggle IR delay datasets | Training data |
| Predicted-vs-actual log | NTES ETA audit (what IR itself tracks) | Model-trust evidence |

## Data accuracy approach (no fake 99%)

* **Calibration, not invention**: routes use real station codes/coordinates; per-leg km are
  computed from geography and scaled per route to the *published* route distance, with
  movement speed set so computed duration (travel + simple class dwell) matches the
  published end-to-end time (e.g. 12301: 1,449 km / 17 h 15 m; 12621: 2,188 km / 32 h 30 m).
  Departure clocks alone are shifted into one morning demo window so all six trains move together.
  Prototype schedule checks: [12301](https://www.confirmtkt.com/train-schedule/12301-RAJDHANI-EXPRES),
  [12951](https://www.railyatri.in/trains/route-12951-mumbai-central-new-delhi-rajdhani-express),
  [12621](https://www.railyatri.in/trains/route-12621-tamil-nadu-express),
  [12841](https://www.railyatri.in/trains/route-12841-shalimar-mas-chenai-central-coromandel-sf-exp),
  [12953](https://www.railyatri.in/trains/route-12953-august-kranti-rajdhani-express),
  [12303](https://tickets.paytm.com/trains/12303-poorva-express) (checked 5 Sep 2026).
* **Training data**: 60 days × every leg of every service (**4,440 records**), generated from a *documented*
  delay process (weather + congestion + signal + dwell + carry-over + priority + rush hour
  + noise) whose structure matches how the live simulator produces delays. The model
  therefore learns a real relationship, and its error is **measured on a time-based 740-leg,
  10-day holdout** and displayed verbatim (`metrics.json` → Analytics page).
* **Honest failure modes**: confidence ranges widen with horizon; stale feed ⇒ historical
  fallback with a visible tag; negative "early" predictions are allowed and displayed.
* **Swapping in real data**: `scripts/import_real.py` documents the 14-column contract
  (`data/historical_legs.csv`); drop in NTES/Kaggle records and re-run `python -m app.ml.train`.

## REST API (integration feasibility)

Interactive docs: `http://localhost:8000/docs`. Highlights:

| Endpoint | Purpose |
|---|---|
| `GET /api/state` | Full live snapshot (what the UI renders) |
| `GET /api/catalog/meta` | Installed-part counts, coverage, hashes and quality profile |
| `GET /api/catalog/trains?q=…` | Ranked/paginated search by number, name, endpoint or route station |
| `GET /api/catalog/trains/{no}` | Supplied timetable metadata and derived calling stops |
| `GET /api/catalog/trains/{no}/route` | Service or raw route rows; optional calling-stop-only view |
| `GET /api/trains/{no}/eta` | `{predicted_eta, confidence_range_min, source, data_fresh}` |
| `GET /api/trains/{no}/cause` | Delay-cause breakdown (min + %) |
| `GET /api/stations?q=…&state=…&zone=…` | Ranked, paginated search across all source records |
| `GET /api/stations/geojson` | Cacheable 8,697-point map catalogue |
| `GET /api/stations/{code}` | Station metadata, provenance and equivalent renamed codes |
| `GET /api/stations/{code}/board` | Station board rows (time, platform, status) |
| `GET /api/congestion` | Most-congested sections |
| `GET /api/accuracy` | Predicted-vs-actual arrival log + rolling MAE |
| `GET /api/analytics/model` | Measured MAE/RMSE/R², coefficients |
| `GET /api/providers` | Key-present/active/degraded status, timestamps and safe errors; never secrets |
| `POST /api/providers/refresh` | Cached on-demand RailRadar train sync or OpenWeather fleet refresh |
| `GET /api/geo/context?lat=…&lng=…` | Partial-success OpenWeather + OpenTopography + Overpass bundle |
| `POST /api/alerts` | Passenger "notify if delay moves > X min" |
| `POST /api/control` | `sim_speed`, `paused` (control room) |
| `POST /api/control/event` | Inject storm / blockage / signal hold |

A station display board or mobile app could consume `GET /api/stations/{code}/board` and
`GET /api/trains/{no}/eta` unchanged.

## Demo tips & known limitations (say this to judges first)

* Only six services carry live/simulated state; the 5,208 imported records are explicitly
  schedule-only until a telemetry feed supplies positions for them.
* The uploaded train parts do not declare an as-of date and include historical station codes;
  RailSync labels them “uploaded timetable” rather than claiming they are today's IR schedule.
* Trains restart at origin after reaching destination (new trip, delay re-baselines).
* One-direction routes only (return legs omitted for prototype scope).
* Platforms are simulated assignments with collision avoidance, not real PF data.
* Alert fan-out is a toast mock — no real SMS/push (IRCTC/NTES integration is the path).
* Authenticated provider behavior depends on your key/plan and cannot be live-tested without
  those credentials; `/api/providers` makes that condition explicit.
* RailRadar re-anchors the six demo trains only when today's journey is actively `running`;
  not-started/completed responses are displayed but never erase the moving demo fallback.
* Coloured route lines connect the dense uploaded station chain—not every surveyed track vertex.
  The marker uses explicit, guarded local map matching against loaded white MapTiler railway
  vectors; a complete true-track LineString is still required for unambiguous whole-route `along` placement.
  ETA leg lengths remain geographic × track-factor and scaled to published end-to-end km.
* The source's 293 missing/zero coordinate records remain searchable but cannot be plotted.
* Sim clock starts 09:30 IST on boot day; ×4 speed by default (1 real hour ≈ 4 rail hours).

## Going fully live on Render (API checklist)

RailSync degrades gracefully: every missing or rejected key becomes a visible
"fallback" chip instead of an error. To move from *hybrid demo* to *all providers
live*, configure the following in the Render dashboard
(Service → Environment) and redeploy.

### Server-side keys (read by FastAPI at boot)

| Variable | Provider | Notes |
| --- | --- | --- |
| `RAILRADAR_API_KEY` | railradar.in live telemetry | Bearer key. Demand-refresh + viewer auto-sync use a 5-min server cache. |
| `OPENWEATHER_API_KEY` | OpenWeather current weather | Polled for every active train cell; 10-min cache. |
| `OPENTOPOGRAPHY_API_KEY` | OpenTopography COP30 elevation | Called on demand from the Terrain tab / map-click context (`/api/geo/context`); 30-day cache. |
| `OVERPASS_URL` | Overpass OSM | No key needed; leave the default. |

### Browser keys (Vite embeds these **at build time**)

`VITE_*` values are compiled into the public JavaScript bundle. Updating them on
Render only takes effect on the **next deploy**, because Render runs the Vite
build during deployment. Never expect a runtime restart to change them.

| Variable | Provider | Notes |
| --- | --- | --- |
| `VITE_MAPTILER_API_KEY` | MapTiler vector basemap | Create a **fresh free key** at cloud.maptiler.com if the old one returns `403 Key usage restricted`. Origin-restrict it to your Render domain (+ `http://localhost:5173` for dev). |
| `VITE_MAPTILER_STYLE` | basemap style slug | `basic-v2-dark` (default) or `hybrid-v4` (draws railway vectors from zoom 6). |
| `VITE_GEOAPIFY_API_KEY` | Geoapify reverse geocoding | Origin-restrict in the Geoapify dashboard. |

> **Key hygiene:** browser keys are public by design — anyone can read them from
> the bundle. Origin restrictions in the provider dashboards are what stop a
> scraped key from being abused elsewhere. Rotate any key that ever shipped in
> an unrestricted build.

### RailRadar quota math (free sandbox = 1,000 calls/month)

* `RAILRADAR_AUTO_SYNC=false` (default, recommended on free plans): fleet-wide
  background polling stays off. Live pages now sync themselves — one cached call
  when a train's live page opens, then one per 5 minutes while it stays open.
  A two-hour judging session costs ≈ 24 calls.
* `RAILRADAR_AUTO_SYNC=true` polls **all six** trains every
  `RAILRADAR_POLL_SECONDS` (min 60). At 900 s that is ≈ 17,280 calls/month —
  paid plans only.

### What this revision fixed

* **Blank dark map:** a restricted/quota-exceeded MapTiler key used to blank the
  map whenever the style JSON still loaded but tiles were rejected. The map now
  counts tile errors and switches to the OSM/CARTO raster fallback with a banner.
* **Live telemetry on page open:** `/live/<train>` triggers a cached RailRadar
  sync automatically (plus every 5 min while open), so the workspace no longer
  opens in pure simulation between manual refreshes.
* **Mapped-rail snap compatibility:** rail vectors are now recognised under both
  MapTiler schema names (`railway`, and `transportation` filtered to
  `class=rail`), and the overlay layers force vector tiles from zoom 6 so the
  snap guard has features to match against at corridor zoom.
