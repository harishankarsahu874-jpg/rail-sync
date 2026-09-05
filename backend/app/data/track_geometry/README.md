# Optional per-train track geometry

Place an ordered WGS84 GeoJSON `LineString` here as `<train-number>.geojson`, for example:

```text
12301.geojson
12621.geojson
```

Coordinates must use standard GeoJSON order: `[longitude, latitude]`. RailSync validates the
coordinate bounds, route endpoints, and gaps at startup. An opposite-direction line is reversed
automatically. Valid files are marked `actual_track_geojson`; simulated movement is placed with travelled
kilometres directly (`along(trackLine, pos_km)` in the frontend), while a fresh provider fix is
snapped to this train-specific line without overwriting the source telemetry. Invalid files fall
back visibly to the uploaded timetable station chain.

Run before starting RailSync:

```bash
python scripts/validate_track_geometry.py backend/app/data/track_geometry/12301.geojson --train 12301
```

The validator rejects endpoint errors and gaps over 50 km and warns when any vertex gap exceeds
5 km, the average gap exceeds 2 km, or density falls below 20 vertices per 100 km. Treat those
warnings as evidence that curves may still be cut.

Do not label a station-to-station LineString as real track geometry. Detailed geometry can be
built from OpenStreetMap railway ways/route relations (with OSM attribution). OpenRailwayMap is
a useful visual reference, but its rendered map tiles are not themselves reusable route geometry.
