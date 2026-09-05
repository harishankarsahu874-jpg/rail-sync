import { api } from '../api.js';

export const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_API_KEY || '').trim();
export const MAPTILER_STYLE = normaliseMapTilerStyle(
  import.meta.env.VITE_MAPTILER_STYLE || 'basic-v2-dark',
);
export const GEOAPIFY_KEY = (import.meta.env.VITE_GEOAPIFY_API_KEY || '').trim();

/** MapTiler serves a true MapLibre style. The no-key path remains a raster
 * CARTO/OSM fallback so a missing, restricted or invalid key never blanks the demo. */
export function mapStyle(forceFallback = false) {
  if (MAPTILER_KEY && !forceFallback) {
    return `https://api.maptiler.com/maps/${MAPTILER_STYLE}/style.json?key=${encodeURIComponent(MAPTILER_KEY)}`;
  }
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tileSize: 256,
        tiles: [
          'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        ],
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  };
}

function normaliseMapTilerStyle(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/\/maps\/([a-z0-9_-]+)\/style\.json/i);
  const slug = match?.[1] || raw;
  return /^[a-z0-9_-]+$/i.test(slug) ? slug : 'basic-v2-dark';
}

export async function reverseGeocode(lat, lng) {
  if (!GEOAPIFY_KEY) {
    return { available: false, reason: 'VITE_GEOAPIFY_API_KEY is not configured' };
  }
  const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('format', 'json');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('limit', '1');
  url.searchParams.set('apiKey', GEOAPIFY_KEY);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`Geoapify returned ${response.status}`);
    const payload = await response.json();
    const result = payload.results?.[0] || payload.features?.[0]?.properties;
    if (!result) return { available: false, reason: 'No matching place' };
    return {
      available: true,
      data: {
        formatted: result.formatted || result.address_line2 || result.name || 'Unnamed location',
        city: result.city || result.town || result.village || result.county,
        state: result.state,
        postcode: result.postcode,
        country: result.country,
        distance_m: result.distance,
      },
    };
  } catch (error) {
    return { available: false, reason: error.message || 'Geoapify request failed' };
  }
}

export async function inspectLocation(lat, lng, radius = 4000) {
  const path = `/api/geo/context?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius_m=${radius}`;
  const [backend, place] = await Promise.allSettled([
    api.get(path),
    reverseGeocode(lat, lng),
  ]);
  return {
    ...(backend.status === 'fulfilled'
      ? backend.value
      : {
          coordinates: { lat, lng },
          weather: { available: false, reason: backend.reason?.message || 'Provider gateway unavailable' },
          terrain: { available: false, reason: backend.reason?.message || 'Provider gateway unavailable' },
          osm: { available: false, reason: backend.reason?.message || 'Provider gateway unavailable' },
        }),
    place: place.status === 'fulfilled'
      ? place.value
      : { available: false, reason: place.reason?.message || 'Geoapify unavailable' },
  };
}
