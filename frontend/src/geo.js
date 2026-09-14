// Browser keys are baked in by Vite from the repo-root .env.production.
export const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_API_KEY || '').trim();
export const MAPTILER_STYLE = (import.meta.env.VITE_MAPTILER_STYLE || 'basic-v2-dark').trim();
export const GEOAPIFY_KEY = (import.meta.env.VITE_GEOAPIFY_API_KEY || '').trim();

/** Clean streets view — keyless OpenStreetMap standard raster. */
export function streetsStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

/** Night-mode look, keyless: OSM raster dimmed to a dark greyscale board. */
export function darkStyle() {
  const style = streetsStyle();
  style.layers = [{
    id: 'osm-dark',
    type: 'raster',
    source: 'osm',
    paint: {
      'raster-saturation': -1,
      'raster-brightness-min': 0.0,
      'raster-brightness-max': 0.55,
      'raster-contrast': 0.25,
      'raster-opacity': 1,
    },
  }];
  return style;
}

/** Legacy entry point kept for older imports: streets by default. */
export function mapStyle(forceFallback = false) {
  return streetsStyle();
}

/** Realistic satellite imagery (keyless Esri World Imagery raster). */
export function satelliteStyle() {
  return {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics & the GIS User Community',
      },
    },
    layers: [{ id: 'esri', type: 'raster', source: 'esri' }],
  };
}

/** The three basemaps the passenger can switch between — all keyless. */
export const MAP_TYPES = [
  { id: 'sat', label: '🛰 Satellite', build: () => satelliteStyle() },
  { id: 'streets', label: '🗺 Streets', build: () => streetsStyle() },
  { id: 'dark', label: '🌑 Dark', build: () => darkStyle() },
];

/** Reverse-geocode the live fix (Geoapify browser key, origin-restricted). */
export async function reverseGeocode(lat, lng) {
  if (!GEOAPIFY_KEY) return { available: false, reason: 'VITE_GEOAPIFY_API_KEY is not configured' };
  const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
  url.searchParams.set('lat', lat);
  url.searchParams.set('lon', lng);
  url.searchParams.set('format', 'json');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('limit', '1');
  url.searchParams.set('apiKey', GEOAPIFY_KEY);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`Geoapify ${response.status}`);
    const data = await response.json();
    const row = data.results?.[0];
    if (!row) return { available: false, reason: 'no result' };
    return {
      available: true,
      place: [row.name, row.city || row.county, row.state].filter(Boolean).join(', '),
    };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}
