// Browser keys are baked in by Vite from the repo-root .env.production.
export const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_API_KEY || '').trim();
export const MAPTILER_STYLE = (import.meta.env.VITE_MAPTILER_STYLE || 'basic-v2-dark').trim();
export const GEOAPIFY_KEY = (import.meta.env.VITE_GEOAPIFY_API_KEY || '').trim();

/** Clean streets view — keyless OpenStreetMap standard raster. */
/** Night-mode look, keyless: OSM raster dimmed to a dark greyscale board. */
/** Realistic satellite imagery (keyless Esri World Imagery) + place labels. */
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
        attribution: 'Imagery \u00a9 Esri, Maxar, Earthstar Geographics & the GIS User Community',
      },
      esriPlaces: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: 'Places labels \u00a9 Esri',
      },
      esriTransport: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: 'Transport overlay \u00a9 Esri',
      },
    },
    layers: [
      { id: 'esri', type: 'raster', source: 'esri' },
      { id: 'esri-transport', type: 'raster', source: 'esriTransport', paint: { 'raster-opacity': 0.5 } },
      { id: 'esri-places', type: 'raster', source: 'esriPlaces' },
    ],
  };
}

/** Streets \u2014 keyless Esri World Street Map (OSM volunteer tiles block cloud IPs). */
export function streetsStyle() {
  return {
    version: 8,
    sources: {
      esriStreets: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: '\u00a9 Esri World Street Map contributors',
      },
    },
    layers: [{ id: 'esri-streets', type: 'raster', source: 'esriStreets' }],
  };
}

/** Night board \u2014 keyless Esri dark-gray canvas. */
export function darkStyle() {
  return {
    version: 8,
    sources: {
      esriDark: {
        type: 'raster',
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        ],
        attribution: '\u00a9 Esri Canvas World Dark',
      },
    },
    layers: [{ id: 'esri-dark', type: 'raster', source: 'esriDark' }],
  };
}

/** Legacy entry point kept for older imports: streets by default. */
export function mapStyle(forceFallback = false) {
  return streetsStyle();
}

/** Realistic satellite imagery (keyless Esri World Imagery raster). */
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
