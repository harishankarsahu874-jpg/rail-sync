import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { mapStyle, MAPTILER_KEY } from '../geo.js';

/**
 * Live route map, RailRadar-style: the full scheduled route as a teal line,
 * every halt as a dot (grey once passed), the NEXT halt ringed in amber and
 * the train itself as a pulsing marker at its exact live fix (snapped to the
 * real OSM track when inside the guard). Heavy layers update in place when the
 * background enrichment lands, so first paint stays instant.
 */
export default function MapView({ position, running, routeGeo = [], track = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const fittedRef = useRef(false);
  const propsRef = useRef({ position, running, routeGeo, track });
  propsRef.current = { position, running, routeGeo, track };
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const first = routeGeo[0];
    const center = position ? [position.lng, position.lat] : first ? [first.lng, first.lat] : [79.8, 23.4];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center,
      zoom: position || routeGeo.length ? 5.2 : 4.4,
      minZoom: 3.5,
      maxZoom: 16,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');

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

    const el = document.createElement('div');
    el.className = 'train-pulse';
    el.innerHTML = '<span class="ring"></span><span class="core"></span>';
    markerRef.current = new maplibregl.Marker({ element: el }).setLngLat(center).addTo(map);

    map.on('load', () => {
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
        paint: { 'line-color': '#64748b', 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [1.5, 1.5] },
      });
      map.addLayer({
        id: 'rs-route-ahead-line', type: 'line', source: 'rs-route-ahead',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#14b8a6', 'line-width': 3, 'line-opacity': 0.95 },
      });
      map.addLayer({
        id: 'rs-stops-dot', type: 'circle', source: 'rs-stops',
        paint: {
          'circle-radius': ['case', ['get', 'next'], 5, 3.2],
          'circle-color': ['case', ['get', 'passed'], '#94a3b8', ['get', 'next'], '#f59e0b', '#0d9488'],
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#0b0f14',
        },
      });
      map.on('click', 'rs-stops-dot', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties;
        new maplibregl.Popup({ maxWidth: '240px', offset: 8 })
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font:600 12px/1.4 system-ui">${p.name}</div>
            <div style="font:11px/1.5 system-ui;color:#475569">${p.code} · sched ${p.sched || '—'}${p.eta ? `<br>predicted <b>${p.eta}</b>` : ''}${p.passed ? '<br><i>passed</i>' : ''}</div>`)
          .addTo(map);
      });
      map.on('mouseenter', 'rs-stops-dot', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'rs-stops-dot', () => { map.getCanvas().style.cursor = ''; });
      map._rsReady = true;
      paint();
    });

    const paint = () => {
      if (!map._rsReady || !map.getSource('rs-stops')) return;
      const cur = propsRef.current;
      const posNow = cur.position;
      const runningNow = cur.running;
      const trackNow = cur.track;
      const pts = (cur.routeGeo || []).filter((p) => p.lat != null && p.lng != null);
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
          properties: { name: p.name, code: p.code || '', sched: p.sched || '', passed: Boolean(p.passed), next: Boolean(p.next), eta: p.eta_label || '' },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      });
      map.getSource('rs-track').setData({
        type: 'FeatureCollection',
        features: trackNow && trackNow.length >= 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trackNow.map(([a, b]) => [b, a]) } }] : [],
      });
      if (trainAt && markerRef.current) markerRef.current.setLngLat(trainAt);
      else if (markerRef.current) markerRef.current.setLngLat(center);
      if (!fittedRef.current && pts.length >= 2) {
        fittedRef.current = true;
        const bounds = pts.reduce((b, p) => b.extend([p.lng, p.lat]), new maplibregl.LngLatBounds([pts[0].lng, pts[0].lat], [pts[0].lng, pts[0].lat]));
        if (trainAt) bounds.extend(trainAt);
        map.fitBounds(bounds, { padding: 56, maxZoom: 9.5 });
      }
    };
    map._rsPaint = paint;
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
