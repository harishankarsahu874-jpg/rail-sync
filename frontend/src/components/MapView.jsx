import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { mapStyle, MAPTILER_KEY } from '../geo.js';

/**
 * Live map: one marker (the train) + one polyline (the real OSM track it was
 * snapped to, when the snap succeeded). MapTiler vector style when the baked
 * key works; a restricted/quota-exceeded key flips ONCE to free CARTO raster
 * with a visible note — the map is never a black box.
 */
export default function MapView({ position, running }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const center = position ? [position.lng, position.lat] : [79.8, 23.4];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center,
      zoom: position ? 9.2 : 4.4,
      minZoom: 3.5,
      maxZoom: 16,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');
    map.on('movestart', () => { map._userMoved = true; });

    let fellBack = false;
    let tileErrors = 0;
    let windowStart = 0;
    const fallback = (reason) => {
      fellBack = true;
      setNote(reason);
      map.setStyle(mapStyle(true));
    };
    map.on('error', () => {
      if (!MAPTILER_KEY || fellBack) return;
      if (!map.isStyleLoaded()) {
        fallback('MapTiler style rejected — free OSM basemap shown');
        return;
      }
      const now = Date.now();
      if (now - windowStart > 30_000) { windowStart = now; tileErrors = 0; }
      tileErrors += 1;
      if (tileErrors >= 8) fallback('MapTiler tiles rejected — free OSM basemap shown');
    });

    map.on('load', () => {
      map.addSource('railsync-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'railsync-track-glow', type: 'line', source: 'railsync-track',
        paint: { 'line-color': '#14b8a6', 'line-width': 7, 'line-opacity': 0.25, 'line-blur': 3 },
      });
      map.addLayer({
        id: 'railsync-track', type: 'line', source: 'railsync-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0d9488', 'line-width': 2.6, 'line-opacity': 0.95 },
      });
    });

    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    const lngLat = [position.lng, position.lat];
    if (!markerRef.current) {
      const el = document.createElement('div');
      el.className = `pulse-marker${position.snapped ? ' snapped' : ''}`;
      el.title = position.snapped
        ? `Snapped to mapped OSM rail (${position.offset_m} m correction)`
        : 'Raw provider fix (outside snap guard)';
      markerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lngLat).addTo(map);
    } else {
      markerRef.current.getElement().className = `pulse-marker${position.snapped ? ' snapped' : ''}`;
      markerRef.current.setLngLat(lngLat);
    }
    const track = map.getSource('railsync-track');
    if (track) {
      track.setData(position.track
        ? {
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: position.track.map(([la, ln]) => [ln, la]) },
            }],
          }
        : { type: 'FeatureCollection', features: [] });
    }
    if (!map._userMoved) map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 9.2), duration: 800 });
  }, [position]);

  return (
    <div className="map-shell">
      <div ref={containerRef} style={{ height: '100%' }} />
      {note && <div className="map-note">{note}</div>}
      {!running && (
        <div className="map-note" style={{ top: 'auto', bottom: 10 }}>
          Journey not running right now — showing last known route state
        </div>
      )}
    </div>
  );
}
