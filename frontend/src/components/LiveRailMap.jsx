import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { MAPTILER_KEY, mapStyle } from '../services/geography.js';
import { resolveMarkerPosition } from '../services/positioning.js';
import { severityClass } from '../utils.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

function routeGeoJSON(state, selected) {
  return {
    type: 'FeatureCollection',
    features: state.routes.map((route) => ({
      type: 'Feature',
      properties: {
        train: route.train,
        color: route.color,
        selected: route.train === selected ? 1 : 0,
        geometry_source: route.geometry_source || 'unknown',
        track_snapped: route.track_snapped ? 1 : 0,
      },
      geometry: {
        type: 'LineString',
        coordinates: route.coords.map(([lat, lng]) => [lng, lat]),
      },
    })),
  };
}

function stationGeoJSON(state) {
  return {
    type: 'FeatureCollection',
    features: state.stations.filter((s) => s.major).map((station) => ({
      type: 'Feature',
      properties: {
        code: station.code,
        name: station.name,
        state: station.state,
      },
      geometry: { type: 'Point', coordinates: [station.lng, station.lat] },
    })),
  };
}

function railwaySource(map) {
  const style = map.getStyle();
  const baseRailLayer = (style?.layers || []).find((layer) => layer['source-layer'] === 'railway');
  const sourceId = baseRailLayer?.source;
  if (!sourceId || style?.sources?.[sourceId]?.type !== 'vector') return null;
  return { sourceId, sourceLayer: baseRailLayer['source-layer'] };
}

function loadedRailFeatures(map) {
  const source = railwaySource(map);
  if (!source || map.getZoom() < 6) return [];
  try {
    return map.querySourceFeatures(source.sourceId, { sourceLayer: source.sourceLayer });
  } catch {
    return [];
  }
}

function ensureBaseRailOverlay(map) {
  if (map.getLayer('railsync-actual-rail')) return;
  const source = railwaySource(map);
  if (!source) return;
  const { sourceId, sourceLayer } = source;

  // MapTiler hybrid-v4 contains railway vectors from zoom 6, but its stock
  // style does not draw them until zoom 11. These two contrast layers expose
  // the real mapped railway at corridor zoom without inventing geometry.
  map.addLayer({
    id: 'railsync-actual-rail-casing',
    type: 'line',
    source: sourceId,
    'source-layer': sourceLayer,
    minzoom: 6,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': 'rgba(15, 23, 42, 0.88)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.2, 10, 3.4, 14, 5.2],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.68, 9, 0.84],
    },
    filter: ['all',
      ['==', ['geometry-type'], 'LineString'],
      ['any', ['==', ['get', 'construction'], false], ['!', ['has', 'construction']]],
    ],
  });
  map.addLayer({
    id: 'railsync-actual-rail',
    type: 'line',
    source: sourceId,
    'source-layer': sourceLayer,
    minzoom: 6,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': 'rgba(248, 250, 252, 0.94)',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 10, 1.3, 14, 2.1],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.78, 9, 0.96],
    },
    filter: ['all',
      ['==', ['geometry-type'], 'LineString'],
      ['any', ['==', ['get', 'construction'], false], ['!', ['has', 'construction']]],
    ],
  });
}

function ensureRailLayers(map, catalogueData = EMPTY) {
  ensureBaseRailOverlay(map);
  if (!map.getSource('railsync-routes')) {
    map.addSource('railsync-routes', { type: 'geojson', data: EMPTY });
    map.addLayer({
      id: 'railsync-route-glow',
      type: 'line',
      source: 'railsync-routes',
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['==', ['get', 'selected'], 1], 9, 5],
        'line-opacity': ['case', ['==', ['get', 'selected'], 1], 0.16, 0.07],
        'line-blur': 3,
      },
    });
    map.addLayer({
      id: 'railsync-routes',
      type: 'line',
      source: 'railsync-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['==', ['get', 'selected'], 1], 4, 2],
        'line-opacity': ['case', ['==', ['get', 'selected'], 1], 0.95, 0.4],
        'line-dasharray': [2.4, 1.2],
      },
    });
  }
  if (!map.getSource('railsync-catalogue')) {
    map.addSource('railsync-catalogue', {
      type: 'geojson',
      data: catalogueData,
      cluster: true,
      clusterMaxZoom: 9,
      clusterRadius: 36,
    });
    map.addLayer({
      id: 'railsync-catalogue-clusters',
      type: 'circle',
      source: 'railsync-catalogue',
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 11, 25, 15, 100, 20],
        'circle-color': ['step', ['get', 'point_count'], '#263765', 25, '#304b87', 100, '#3f62b7'],
        'circle-stroke-color': '#91a9ff',
        'circle-stroke-width': 1,
        'circle-opacity': 0.76,
      },
    });
    if (map.getStyle()?.glyphs) {
      map.addLayer({
        id: 'railsync-catalogue-counts',
        type: 'symbol',
        source: 'railsync-catalogue',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 10,
        },
        paint: { 'text-color': '#e4eaff' },
      });
    }
    map.addLayer({
      id: 'railsync-catalogue-points',
      type: 'circle',
      source: 'railsync-catalogue',
      minzoom: 6,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 2, 11, 4.5],
        'circle-color': '#7388d4',
        'circle-stroke-color': '#182345',
        'circle-stroke-width': 1,
        'circle-opacity': 0.76,
      },
    });
    if (map.getStyle()?.glyphs) {
      map.addLayer({
        id: 'railsync-catalogue-labels',
        type: 'symbol',
        source: 'railsync-catalogue',
        minzoom: 9,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['concat', ['get', 'code'], '  ', ['get', 'name']],
          'text-size': 10,
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#bdc9f3',
          'text-halo-color': '#11182b',
          'text-halo-width': 1.2,
        },
      });
    }
  }
  if (!map.getSource('railsync-stations')) {
    map.addSource('railsync-stations', { type: 'geojson', data: EMPTY });
    map.addLayer({
      id: 'railsync-stations',
      type: 'circle',
      source: 'railsync-stations',
      paint: {
        'circle-radius': 4,
        'circle-color': '#8fa5ff',
        'circle-stroke-color': '#293969',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.95,
      },
    });
  }
}

/** MapLibre renders MapTiler vector tiles when a key exists and a CARTO/OSM
 * raster fallback otherwise. Live trains stay as accessible HTML markers. */
export default function LiveRailMap({ state, selected, onSelect, onInspect, onPositionResolved }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const markerUpdaterRef = useRef(null);
  const resolvedPositionRef = useRef(new Map());
  const callbacksRef = useRef({ onSelect, onInspect, onPositionResolved });
  const stateRef = useRef(state);
  const selectedRef = useRef(selected);
  const catalogueRef = useRef(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [mapError, setMapError] = useState('');

  callbacksRef.current = { onSelect, onInspect, onPositionResolved };
  stateRef.current = state;
  selectedRef.current = selected;

  markerUpdaterRef.current = () => {
    const map = mapRef.current;
    const current = stateRef.current;
    if (!map || !current) return;

    const railFeatures = loadedRailFeatures(map);
    const routes = new Map((current.routes || []).map((route) => [route.train, route]));
    const present = new Set();

    current.trains.forEach((train) => {
      present.add(train.number);
      const route = routes.get(train.number);
      const resolved = resolveMarkerPosition(train, route, railFeatures) || {
        coordinates: [train.lng, train.lat], method: 'state_fallback', snapOffsetKm: null,
      };
      const [lng, lat] = resolved.coordinates;

      let marker = markersRef.current.get(train.number);
      if (!marker) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'trn-map-marker';
        el.setAttribute('aria-label', `Open train ${train.number}`);
        const dot = document.createElement('span');
        dot.className = 'dot';
        const label = document.createElement('span');
        label.className = 'label';
        el.append(dot, label);
        el.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          callbacksRef.current.onSelect?.(train.number);
        });
        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .addTo(map);
        markersRef.current.set(train.number, marker);
      }

      const el = marker.getElement();
      const severity = severityClass(train.delay, train.status);
      const isSelected = selectedRef.current === train.number;
      el.className = `trn-map-marker ${severity}${isSelected ? ' selected' : ''}`;
      el.dataset.positionMethod = resolved.method;
      el.querySelector('.label').textContent = train.number;
      el.querySelector('.dot').className = `dot ${severity}`;

      const sourceLabel = train.position_source === 'railradar_reported'
        ? 'RailRadar reported coordinate'
        : train.position_source === 'railradar_dead_reckoning'
          ? 'RailRadar-anchored estimate'
          : 'timetable station-chain simulation';
      const placementLabel = resolved.method === 'mapped_rail_snap' || resolved.method === 'track_route_snap'
        ? `display snapped ${Math.round(resolved.snapOffsetKm * 1000)} m to ${resolved.method === 'track_route_snap' ? 'route track' : 'mapped rail'}`
        : resolved.method === 'track_along'
          ? 'placed by distance along track geometry'
          : resolved.method === 'route_along'
            ? 'placed along simplified route; no acceptable mapped-rail match'
            : resolved.method === 'provider_raw'
              ? 'raw provider coordinate; track snap unavailable or outside guard'
              : 'state coordinate; no acceptable mapped-rail match';
      el.title = `${train.name} · ${Math.round(train.speed_kmh)} km/h · ${sourceLabel} · ${placementLabel}`;
      marker.setLngLat([lng, lat]);

      if (isSelected && callbacksRef.current.onPositionResolved) {
        const signature = `${resolved.method}:${lng.toFixed(6)}:${lat.toFixed(6)}:${resolved.snapOffsetKm}`;
        if (resolvedPositionRef.current.get(train.number) !== signature) {
          resolvedPositionRef.current.set(train.number, signature);
          callbacksRef.current.onPositionResolved({
            train: train.number,
            lat,
            lng,
            method: resolved.method,
            snapOffsetKm: resolved.snapOffsetKm,
            routeGeometrySource: resolved.routeGeometrySource,
          });
        }
      }
    });

    markersRef.current.forEach((marker, number) => {
      if (!present.has(number)) {
        marker.remove();
        markersRef.current.delete(number);
        resolvedPositionRef.current.delete(number);
      }
    });
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const initialTrain = stateRef.current?.trains?.find(
      (train) => train.number === selectedRef.current,
    );
    const initialRoute = stateRef.current?.routes?.find(
      (route) => route.train === selectedRef.current,
    );
    const initialPosition = initialTrain
      ? resolveMarkerPosition(initialTrain, initialRoute, [])?.coordinates
      : null;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: initialPosition || [79.8, 23.4],
      zoom: initialPosition ? 8.35 : 4.35,
      minZoom: 3.5,
      maxZoom: 15,
      attributionControl: true,
      cooperativeGestures: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');

    // The complete 8,697-point map layer is fetched once and browser-cached;
    // it is deliberately not part of every 15-second WebSocket snapshot.
    const catalogueAbort = new AbortController();
    fetch('/api/stations/geojson', { signal: catalogueAbort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`station catalogue ${response.status}`);
        return response.json();
      })
      .then((data) => {
        catalogueRef.current = data;
        mapRef.current?.getSource('railsync-catalogue')?.setData(data);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setMapError('Station catalogue layer unavailable');
      });

    let fellBack = false;
    let markerFrame = null;
    const scheduleMarkerUpdate = () => {
      if (markerFrame != null) return;
      markerFrame = window.requestAnimationFrame(() => {
        markerFrame = null;
        markerUpdaterRef.current?.();
      });
    };
    const install = () => {
      try {
        ensureRailLayers(map, catalogueRef.current);
        map.getSource('railsync-catalogue')?.setData(catalogueRef.current);
        const current = stateRef.current;
        if (current) {
          map.getSource('railsync-routes')?.setData(routeGeoJSON(current, selectedRef.current));
          map.getSource('railsync-stations')?.setData(stationGeoJSON(current));
        }
        setLoaded(true);
        scheduleMarkerUpdate();
      } catch (error) {
        setMapError(error.message || 'Could not initialise map overlays');
      }
    };
    map.on('load', install);
    map.on('style.load', install);
    map.on('error', (event) => {
      // An invalid/restricted MapTiler key must not blank the demo. Fall back
      // once to the OSM raster style; later tile errors are harmless.
      if (MAPTILER_KEY && !fellBack && !map.isStyleLoaded()) {
        fellBack = true;
        setMapError('MapTiler unavailable — showing OSM fallback');
        map.setStyle(mapStyle(true));
      }
    });
    const handleRailSourceData = (event) => {
      const source = railwaySource(map);
      if (source && event.sourceId === source.sourceId) scheduleMarkerUpdate();
    };
    map.on('sourcedata', handleRailSourceData);
    map.on('moveend', scheduleMarkerUpdate);

    const stationLayers = () => [
      'railsync-stations',
      'railsync-catalogue-points',
      'railsync-catalogue-clusters',
    ].filter((id) => map.getLayer(id));
    map.on('mousemove', (event) => {
      const layers = stationLayers();
      const hit = layers.length && map.queryRenderedFeatures(event.point, { layers })[0];
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
    });
    map.on('click', (event) => {
      const layers = stationLayers();
      const features = layers.length ? map.queryRenderedFeatures(event.point, { layers }) : [];
      const cluster = features.find((feature) => feature.properties?.point_count);
      if (cluster) {
        map.easeTo({
          center: cluster.geometry.coordinates,
          zoom: Math.min(map.getZoom() + 2.2, 10),
          duration: 650,
        });
        return;
      }
      const station = features.find((feature) => feature.properties?.code);
      if (station) {
        const p = station.properties;
        const place = [p.code, p.state, p.zone].filter(Boolean).join(' · ');
        new maplibregl.Popup({ closeButton: false, offset: 8 })
          .setLngLat(station.geometry.coordinates)
          .setHTML(`<strong>${escapeHTML(p.name)}</strong><br><span>${escapeHTML(place)}</span>`)
          .addTo(map);
      }
      callbacksRef.current.onInspect?.(event.lngLat.lat, event.lngLat.lng);
    });

    return () => {
      catalogueAbort.abort();
      if (markerFrame != null) window.cancelAnimationFrame(markerFrame);
      map.off('sourcedata', handleRailSourceData);
      map.off('moveend', scheduleMarkerUpdate);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      resolvedPositionRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !state) return;
    try {
      ensureRailLayers(map, catalogueRef.current);
      map.getSource('railsync-catalogue')?.setData(catalogueRef.current);
      map.getSource('railsync-routes')?.setData(routeGeoJSON(state, selected));
      map.getSource('railsync-stations')?.setData(stationGeoJSON(state));
    } catch {
      return;
    }

    // The map and markers are persistent. Only source data and each marker's
    // LngLat are updated when a WebSocket frame arrives.
    markerUpdaterRef.current?.();
  }, [state, selected, loaded]);

  useEffect(() => {
    if (!selected || !state || !mapRef.current || !loaded) return;
    const train = state.trains.find((t) => t.number === selected);
    const route = state.routes?.find((row) => row.train === selected);
    const resolved = train ? resolveMarkerPosition(train, route, []) : null;
    if (train) mapRef.current.easeTo({ center: resolved?.coordinates || [train.lng, train.lat], zoom: 8.35, duration: 900 });
  }, [selected, loaded]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {mapError && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 chip bg-warn/15 text-warn border border-warn/30">
          {mapError}
        </div>
      )}
    </div>
  );
}

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
