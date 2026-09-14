// Browser keys are baked in by Vite from the repo-root .env.production.
export const MAPTILER_KEY = (import.meta.env.VITE_MAPTILER_API_KEY || '').trim();
export const MAPTILER_STYLE = (import.meta.env.VITE_MAPTILER_STYLE || 'basic-v2-dark').trim();
export const GEOAPIFY_KEY = (import.meta.env.VITE_GEOAPIFY_API_KEY || '').trim();

/* One combined keyless style: every Esri basemap lives in the same style as
   its own raster layer, and switching type only flips layer *visibility*.
   No setStyle() call ever happens, so the route line / halt dots / labels
   (vector layers added on top) survive every switch — the old setStyle path
   wiped them on Streets. */
export function baseStyle() {
  const raster = (tiles, attribution) => ({ type: 'raster', tileSize: 256, maxzoom: 19, tiles, attribution });
  const E = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  return {
    version: 8,
    sources: {
      esriSat: raster([`${E}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
        'Imagery © Esri, Maxar, Earthstar Geographics & the GIS User Community'),
      esriPlaces: raster([`${E}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`],
        'Places labels © Esri'),
      esriTransport: raster([`${E}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`],
        'Transport overlay © Esri'),
      /* OSM-derived streets via the committed Geoapify key: full India
         coverage at every zoom (Esri World Street Map serves gray
         "Map data not yet available" placeholders beyond z12-17 here). */
      geoapifyStreets: GEOAPIFY_KEY
        ? {
          type: 'raster', tileSize: 256, maxzoom: 20,
          tiles: [`https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_KEY}`],
          attribution: '© OpenStreetMap contributors, Geoapify',
        }
        : raster([`${E}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],
          '© Esri World Street Map contributors'),
      esriStreetsClassic: {
        ...raster([`${E}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],
          '© Esri World Street Map contributors'),
        maxzoom: 13,
      },
    },
    layers: [
      { id: 'rs-base-sat', type: 'raster', source: 'esriSat' },
      { id: 'rs-base-sat-transport', type: 'raster', source: 'esriTransport', paint: { 'raster-opacity': 0.5 } },
      { id: 'rs-base-sat-places', type: 'raster', source: 'esriPlaces' },
      { id: 'rs-base-streets', type: 'raster', source: 'geoapifyStreets', layout: { visibility: 'none' } },
      { id: 'rs-base-streets-classic', type: 'raster', source: 'esriStreetsClassic', layout: { visibility: 'none' } },
    ],
  };
}

/** The two basemaps the passenger can switch between — all keyless Esri. */
export const MAP_TYPES = [
  { id: 'sat', label: '🛰 Satellite', layers: ['rs-base-sat', 'rs-base-sat-transport', 'rs-base-sat-places'] },
  { id: 'streets', label: '🗺 Streets', layers: ['rs-base-streets'] },
];

export const ALL_BASE_LAYERS = MAP_TYPES.flatMap((t) => t.layers);

/** Reverse-geocode the live fix (Geoapify browser key, origin-restricted). */
export async function reverseGeocode(lat, lng) {
  if (!GEOAPIFY_KEY) return { available: false, reason: 'VITE_GEOAPIFY_API_KEY is not configured' };
  const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
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
