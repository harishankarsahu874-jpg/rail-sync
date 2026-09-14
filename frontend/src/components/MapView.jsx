import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { baseStyle, MAP_TYPES, ALL_BASE_LAYERS } from '../geo.js';

const storedType = () => {
  try {
    const v = localStorage.getItem('rs_maptype');
    return MAP_TYPES.some((t) => t.id === v) ? v : 'sat';
  } catch {
    return 'sat';
  }
};

// Keyless glyph server so station-code labels render on raster basemaps.
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

/**
 * Live route map, RailRadar-style but realistic: satellite imagery by default
 * (passenger-switchable Satellite / Streets / Dark), the full scheduled route
 * as a teal line, every halt as a dot (grey once passed, amber ring on NEXT)
 * and the train as a pulsing marker at its exact live fix. Raster basemaps =
 * instant first tiles; vector layers re-attach after every style switch.
 */
export default function MapView({ position, running, routeGeo = [], track = null, onStationClick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const fittedRef = useRef(false);
  const propsRef = useRef({ position, running, routeGeo, track });
  propsRef.current = { position, running, routeGeo, track };
  const [mapType, setMapType] = useState(storedType);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const first = (routeGeo || [])[0];
    const center = position ? [position.lng, position.lat] : first ? [first.lng, first.lat] : [79.8, 23.4];
    const initialStyle = baseStyle();
    initialStyle.glyphs = GLYPHS;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center,
      zoom: position || routeGeo.length ? 5.2 : 4.4,
      minZoom: 3,
      maxZoom: 17,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');

    let tileErrors = 0;
    let windowStart = 0;
    const classicRef = { on: false };
    map.on('error', () => {
      const now = Date.now();
      if (now - windowStart > 30_000) { windowStart = now; tileErrors = 0; }
      tileErrors += 1;
      if (tileErrors < 8) return;
      tileErrors = 0;
      const cur = storedType();
      if (cur === 'streets' && !classicRef.on) {
        /* street tiles failing (quota/network): drop to the classic Esri
           street raster before giving up on streets altogether */
        classicRef.on = true;
        if (map.getLayer('rs-base-streets')) map.setLayoutProperty('rs-base-streets', 'visibility', 'none');
        if (map.getLayer('rs-base-streets-classic')) map.setLayoutProperty('rs-base-streets-classic', 'visibility', 'visible');
        setNote('Street tiles limited on this network — classic street view shown');
      } else if (cur !== 'sat') {
        setNote('Basemap unreachable from this network — satellite view restored');
        applyType('sat', true);
      }
    });

    const el = document.createElement('div');
    el.className = 'train-pulse';
    el.innerHTML = '<span class="ring"></span><span class="core"></span>';
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat(center).addTo(map);

    const addLayers = () => {
      if (map.getSource('rs-stops')) return;
      map.addSource('rs-route-passed', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('rs-route-ahead', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('rs-stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('rs-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'rs-track-glow', type: 'line', source: 'rs-track',
        paint: { 'line-color': '#14b8a6', 'line-width': 7, 'line-opacity': 0.25, 'line-blur': 3 },
      });
      map.addLayer({
        id: 'rs-track-line', type: 'line', source: 'rs-track',
        paint: { 'line-color': '#2dd4bf', 'line-width': 2.5, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'rs-route-passed-line', type: 'line', source: 'rs-route-passed',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#94a3b8', 'line-width': 2.5, 'line-opacity': 0.8, 'line-dasharray': [1.5, 1.5] },
      });
      map.addLayer({
        id: 'rs-route-ahead-line', type: 'line', source: 'rs-route-ahead',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#14b8a6', 'line-width': 3, 'line-opacity': 0.95 },
      });
      map.addLayer({
        id: 'rs-stops-halo', type: 'circle', source: 'rs-stops',
        paint: { 'circle-radius': ['case', ['get', 'next'], 9, 6], 'circle-color': 'rgba(13,148,136,0.25)' },
      });
      map.addLayer({
        id: 'rs-stops-dot', type: 'circle', source: 'rs-stops',
        paint: {
          'circle-radius': ['case', ['get', 'end'], 6, ['get', 'next'], 5, 3.4],
          'circle-color': ['case', ['get', 'passed'], '#cbd5e1', ['get', 'next'], '#f59e0b', '#0d9488'],
          'circle-stroke-width': 1.4,
          'circle-stroke-color': '#0b0f14',
        },
      });
      map.addLayer({
        id: 'rs-stops-label', type: 'symbol', source: 'rs-stops',
        layout: {
          'text-field': ['get', 'code'],
          'text-font': ['Noto Sans Regular'],
          'text-size': ['case', ['get', 'end'], 12, 10],
          'text-offset': [0, -1.15],
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-optional': true,
        },
        paint: {
          'text-color': '#f8fafc',
          'text-halo-color': 'rgba(2,6,12,0.92)',
          'text-halo-width': 1.5,
        },
      });
      map.on('click', 'rs-stops-dot', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties;
        const href = p.href ? `<a href="${p.href}" style="color:#0d9488;font-weight:700;text-decoration:none">Open station dossier →</a>` : '';
        new maplibregl.Popup({ maxWidth: '250px', offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font:600 12px/1.4 system-ui">${p.name}</div>
            <div style="font:11px/1.6 system-ui;color:#475569">${p.code} · sched ${p.sched || '—'}${p.eta ? `<br>predicted <b>${p.eta}</b>` : ''}${p.passed ? '<br><i>passed</i>' : ''}</div>
            ${href}`)
          .addTo(map);
        if (p.href && onStationClick) { /* link handles navigation */ }
      });
      map.on('mouseenter', 'rs-stops-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'rs-stops-dot', () => { map.getCanvas().style.cursor = ''; });
    };

    const paint = () => {
      if (!map.getSource('rs-stops')) return;
      const cur = propsRef.current;
      const posNow = cur.position;
      const runningNow = cur.running;
      const trackNow = cur.track;
      const pts = (cur.routeGeo || []).filter((p) => p.lat != null && p.lng != null);
      const firstCode = pts[0]?.code;
      const lastCode = pts[pts.length - 1]?.code;
      const trainAt = runningNow && posNow ? [posNow.lng, posNow.lat] : null;
      const passedPts = pts.filter((p) => p.passed).map((p) => [p.lng, p.lat]);
      const aheadPts = pts.filter((p) => !p.passed).map((p) => [p.lng, p.lat]);
      const passedLine = trainAt ? [...passedPts, trainAt] : passedPts;
      const aheadLine = trainAt ? [trainAt, ...aheadPts] : aheadPts;
      const line = (coords) => ({
        type: 'FeatureCollection',
        features: coords.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [],
      });
      map.getSource('rs-route-passed').setData(line(passedLine));
      map.getSource('rs-route-ahead').setData(line(aheadLine));
      map.getSource('rs-stops').setData({
        type: 'FeatureCollection',
        features: pts.map((p) => ({
          type: 'Feature',
          properties: {
            name: p.name, code: p.code || '', sched: p.sched || '', passed: Boolean(p.passed),
            next: Boolean(p.next), end: p.code === firstCode || p.code === lastCode,
            eta: p.eta_label || '', href: p.href || '',
          },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      });
      map.getSource('rs-track').setData({
        type: 'FeatureCollection',
        features: trackNow && trackNow.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trackNow.map(([a, b]) => [b, a]) } }] : [],
      });
      if (markerRef.current) markerRef.current.setLngLat(trainAt || center);
      if (!fittedRef.current && pts.length >= 2) {
        fittedRef.current = true;
        const bounds = pts.reduce((b, p) => b.extend([p.lng, p.lat]),
          new maplibregl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]));
        if (trainAt) bounds.extend(trainAt);
        map.fitBounds(bounds, { padding: 60, maxZoom: 6.5 });
      }
    };
    map._rsPaint = paint;
    map._rsFit = () => {
      const cur = propsRef.current;
      const pts = (cur.routeGeo || []).filter((p) => p.lat != null && p.lng != null);
      if (pts.length < 2) return;
      const bounds = pts.reduce((b, p) => b.extend([p.lng, p.lat]),
        new maplibregl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]));
      if (cur.running && cur.position) bounds.extend([cur.position.lng, cur.position.lat]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 9.5 });
    };

    /* Type switch = visibility flip inside ONE style: route/stops/labels
       (vector layers) are never wiped, unlike the old setStyle() path. */
    const applyType = (id, silent = false) => {
      const next = MAP_TYPES.find((t) => t.id === id) || MAP_TYPES[0];
      try { localStorage.setItem('rs_maptype', next.id); } catch { /* ignore */ }
      setMapType(next.id);
      const on = new Set(next.layers);
      ALL_BASE_LAYERS.forEach((lid) => {
        if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', on.has(lid) ? 'visible' : 'none');
      });
      if (next.id === 'streets' && classicRef.on
          && map.getLayer('rs-base-streets-classic')) {
        map.setLayoutProperty('rs-base-streets-classic', 'visibility', 'visible');
      }
      if (!silent) setNote('');
    };
    map._rsApplyType = applyType;

    map.on('load', () => { addLayers(); paint(); applyType(storedType(), true); });
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map?._rsPaint) map._rsPaint();
  }, [position, routeGeo, track, running]);

  return (
    <div className="map-shell">
      <div ref={containerRef} style={{ height: '100%' }} />
      <div className="map-types" role="group" aria-label="Map type">
        {MAP_TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`map-type ${mapType === t.id ? 'on' : ''}`}
            onClick={() => mapRef.current?._rsApplyType?.(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="map-type" title="Zoom to the full route"
          onClick={() => mapRef.current?._rsFit?.()}>
          ⤢ Full route
        </button>
      </div>
      {note && <div className="map-note">{note}</div>}
      <div className="map-legend">
        <span><i className="lg-train" /> train (live fix)</span>
        <span><i className="lg-ahead" /> route ahead</span>
        <span><i className="lg-passed" /> covered</span>
        <span><i className="lg-next" /> next halt</span>
      </div>
    </div>
  );
}
