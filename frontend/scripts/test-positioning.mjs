import assert from 'node:assert/strict';
import {
  coordinateAlongRoute,
  nearestMappedRail,
  resolveMarkerPosition,
} from '../src/services/positioning.js';

const approximateRoute = {
  train: 'TEST',
  coords: [[0, 0], [0, 1], [1, 1]],
  geometry_source: 'uploaded_timetable_station_chain',
  track_snapped: false,
};
const trueTrackRoute = {
  ...approximateRoute,
  geometry_source: 'actual_track_geojson',
  track_snapped: true,
};
const openRail = {
  type: 'Feature',
  properties: { usage: 'main' },
  geometry: { type: 'LineString', coordinates: [[0, 0.01], [1.2, 0.01]] },
};
const constructionRail = {
  type: 'Feature',
  properties: { construction: true },
  geometry: { type: 'LineString', coordinates: [[0, 0.001], [1.2, 0.001]] },
};
const distantRail = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [[20, 20], [21, 20]] },
};

const placed = coordinateAlongRoute(trueTrackRoute, 0.1, 55.6);
assert.ok(placed, 'Turf along should return a point');
assert.ok(Math.abs(placed.distanceKm - 55.6) < 0.01, 'travelled kilometres must be used directly');
const progressPlaced = coordinateAlongRoute(approximateRoute, 0.25);
assert.ok(Math.abs(progressPlaced.distanceKm - progressPlaced.routeKm * 0.25) < 0.01,
  'a missing distance must use progress, not coerce null to zero');

const snapped = nearestMappedRail([0.5, 0], [constructionRail, openRail], 5);
assert.ok(snapped, 'an open railway is inside the snap guard');
assert.ok(Math.abs(snapped.coordinates[1] - 0.01) < 1e-4,
  'construction alignments must not be selected');

const simulation = {
  progress: 0.25,
  pos_km: 20,
  lng: 0.5,
  lat: 0,
  position_source: 'simulation',
};
const provider = { ...simulation, position_source: 'railradar_reported' };

assert.equal(resolveMarkerPosition(simulation, approximateRoute, []).method, 'route_along');
const geometryDistancePosition = resolveMarkerPosition(
  { ...simulation, position_geometry_km: 10 }, approximateRoute, [],
);
const expectedGeometryPosition = coordinateAlongRoute(approximateRoute, simulation.progress, 10);
assert.deepEqual(geometryDistancePosition.coordinates, expectedGeometryPosition.coordinates,
  'station-chain placement must use the backend leg-aligned geometry distance when supplied');
assert.equal(resolveMarkerPosition(simulation, approximateRoute, [distantRail]).method, 'route_along');
assert.equal(resolveMarkerPosition(provider, approximateRoute, []).method, 'provider_raw');
assert.equal(resolveMarkerPosition(provider, approximateRoute, [distantRail]).method, 'provider_raw');
assert.equal(resolveMarkerPosition({ ...provider, lng: null, lat: null }, approximateRoute, []), null,
  'missing coordinates must not be coerced to [0,0]');
assert.equal(resolveMarkerPosition(simulation, trueTrackRoute, []).method, 'track_along');
assert.equal(
  resolveMarkerPosition({ ...provider, lng: 0.2, lat: 0.01 }, trueTrackRoute, []).method,
  'track_route_snap',
);
assert.equal(
  resolveMarkerPosition(
    { ...provider, lng: 20.5, lat: 20 },
    trueTrackRoute,
    [{ type: 'Feature', properties: {}, geometry: distantRail.geometry }],
  ).method,
  'provider_raw',
  'an off-route provider fix must not jump to an unrelated mapped railway',
);

console.log('positioning tests passed');
