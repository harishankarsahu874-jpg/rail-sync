import along from '@turf/along';
import { lineString, point } from '@turf/helpers';
import length from '@turf/length';
import nearestPointOnLine from '@turf/nearest-point-on-line';

function numeric(value) {
  return value === null || value === undefined || value === '' ? Number.NaN : Number(value);
}

/** Convert the backend's [lat,lng] route array into standard GeoJSON [lng,lat]. */
export function routeLineFeature(route) {
  const coordinates = (route?.coords || [])
    .map(([lat, lng]) => [numeric(lng), numeric(lat)])
    .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  return coordinates.length >= 2 ? lineString(coordinates, {
    train: route.train,
    geometry_source: route.geometry_source,
    track_snapped: Boolean(route.track_snapped),
  }) : null;
}

/** Place a train along its route geometry. The supplied geometry distance takes
 * priority; route progress remains a backwards-compatible fallback. */
export function coordinateAlongRoute(route, progress, distanceTravelledKm = null) {
  const line = routeLineFeature(route);
  if (!line) return null;
  try {
    const routeKm = length(line, { units: 'kilometers' });
    const fraction = Math.max(0, Math.min(1, Number(progress) || 0));
    const hasSuppliedDistance = distanceTravelledKm !== null
      && distanceTravelledKm !== undefined
      && distanceTravelledKm !== '';
    const suppliedDistance = hasSuppliedDistance ? Number(distanceTravelledKm) : Number.NaN;
    const distanceKm = Number.isFinite(suppliedDistance)
      ? Math.max(0, Math.min(routeKm, suppliedDistance))
      : routeKm * fraction;
    const placed = along(line, distanceKm, { units: 'kilometers' });
    return {
      coordinates: placed.geometry.coordinates,
      routeKm,
      distanceKm,
      line,
    };
  } catch {
    return null;
  }
}

/** Snap one coordinate onto the nearest currently loaded mapped-rail feature.
 * A distance guard prevents a bad fix from jumping to an unrelated branch. */
export function nearestMappedRail(rawCoordinates, railFeatures, maxSnapKm = 8) {
  if (!rawCoordinates || !Array.isArray(railFeatures) || !railFeatures.length) return null;
  const raw = point(rawCoordinates);
  let best = null;

  for (const feature of railFeatures) {
    const type = feature?.geometry?.type;
    const underConstruction = [true, 1, 'true'].includes(feature?.properties?.construction);
    // Match the visible MapTiler railway overlay. Otherwise the marker can
    // snap onto a construction alignment that the map deliberately hides.
    if ((type !== 'LineString' && type !== 'MultiLineString') || underConstruction) continue;
    try {
      const snapped = nearestPointOnLine(
        { type: 'Feature', properties: {}, geometry: feature.geometry },
        raw,
        { units: 'kilometers' },
      );
      const distanceKm = Number(snapped.properties?.dist);
      if (Number.isFinite(distanceKm) && (!best || distanceKm < best.distanceKm)) {
        best = { coordinates: snapped.geometry.coordinates, distanceKm };
      }
    } catch {
      // One malformed provider feature must not stop marker updates.
    }
  }

  if (!best || best.distanceKm > maxSnapKm) return null;
  return best;
}

/** Resolve the display marker without mutating the WebSocket snapshot.
 *
 * Priority:
 *  1. fresh RailRadar coordinate as the raw candidate;
 *  2. Turf `along` for route-distance/progress placement;
 *  3. backend coordinate as a safe fallback;
 * then Turf `nearestPointOnLine` against loaded MapTiler railway vectors.
 */
export function resolveMarkerPosition(train, route, railFeatures = []) {
  const providerReported = train.position_source === 'railradar_reported';
  const trueTrackLine = Boolean(route?.track_snapped)
    || route?.geometry_source === 'actual_track_geojson'
    || route?.geometry_source === 'osm_rail_relation';
  const routeDistanceKm = trueTrackLine ? train.pos_km : train.position_geometry_km;
  const routePoint = providerReported
    ? null
    : coordinateAlongRoute(route, train.progress, routeDistanceKm);
  const rawCoordinates = providerReported
    ? [numeric(train.lng), numeric(train.lat)]
    : routePoint?.coordinates || [numeric(train.lng), numeric(train.lat)];

  if (!rawCoordinates.every(Number.isFinite)) return null;

  if (trueTrackLine && providerReported) {
    const line = routeLineFeature(route);
    const snapped = line ? nearestMappedRail(rawCoordinates, [line], 5) : null;
    if (snapped) {
      return {
        coordinates: snapped.coordinates,
        method: 'track_route_snap',
        snapOffsetKm: Math.round(snapped.distanceKm * 1000) / 1000,
        routeGeometrySource: route.geometry_source,
      };
    }
    // A provider fix outside the train-specific guard stays raw. Do not hide a
    // route mismatch by matching it to an unrelated railway that happens to be nearby.
    return {
      coordinates: rawCoordinates,
      method: 'provider_raw',
      snapOffsetKm: null,
      routeGeometrySource: route.geometry_source,
    };
  }
  if (trueTrackLine && routePoint) {
    return {
      coordinates: routePoint.coordinates,
      method: 'track_along',
      snapOffsetKm: 0,
      routeGeometrySource: route.geometry_source,
    };
  }

  // GPS/provider points should need only a small correction. The station-chain
  // simulation gets a wider guard because its chords can still cut rail curves.
  const maxSnapKm = providerReported ? 2.5 : 12;
  const snapped = nearestMappedRail(rawCoordinates, railFeatures, maxSnapKm);
  if (snapped) {
    return {
      coordinates: snapped.coordinates,
      method: 'mapped_rail_snap',
      snapOffsetKm: Math.round(snapped.distanceKm * 1000) / 1000,
      routeGeometrySource: route?.geometry_source,
    };
  }

  return {
    coordinates: rawCoordinates,
    method: providerReported ? 'provider_raw' : routePoint ? 'route_along' : 'state_fallback',
    snapOffsetKm: null,
    routeGeometrySource: route?.geometry_source,
  };
}
