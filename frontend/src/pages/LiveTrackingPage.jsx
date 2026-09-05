import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, BellRing,
  CheckCircle2, Clock3, CloudRain, Database, Gauge, Landmark, Layers3,
  LoaderCircle, Map as MapIcon, MapPin, Mountain, Navigation, Radio,
  RefreshCw, Route, Satellite, Search, ShieldCheck, TrainFront, WifiOff,
  Wind,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api.js';
import LiveRailMap from '../components/LiveRailMap.jsx';
import { fmtAbs } from '../utils.js';

const CAUSE_LABELS = {
  weather: 'Weather',
  congestion: 'Track congestion',
  signal: 'Signal wait',
  dwell: 'Station dwell',
  carry: 'Carried delay',
  low_priority: 'Priority hold',
  rush: 'Rush-hour load',
  other: 'Other conditions',
};

export default function LiveTrackingPage({ state, mode, refreshState }) {
  const params = useParams();
  const navigate = useNavigate();
  const number = String(params.trainNumber || '').toUpperCase();
  const train = state?.trains?.find((row) => row.number === number) || null;
  const stateReady = Boolean(state);
  const [tab, setTab] = useState('map');
  const [stationFilter, setStationFilter] = useState('');
  const [now, setNow] = useState(Date.now());
  const [context, setContext] = useState(null);
  const [mapPosition, setMapPosition] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const [catalogue, setCatalogue] = useState(null);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [syncingRailRadar, setSyncingRailRadar] = useState(false);
  const [railRadarMessage, setRailRadarMessage] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setTab('map');
    setStationFilter('');
    setContext(null);
    setMapPosition(null);
    setContextError('');
    setCatalogue(null);
    setRailRadarMessage('');
  }, [number]);

  useEffect(() => {
    if (!state || train || !number) return undefined;
    let current = true;
    setCatalogueLoading(true);
    api.get(`/api/catalog/trains/${encodeURIComponent(number)}`)
      .then((payload) => current && setCatalogue(payload))
      .catch((error) => current && setCatalogue({ error: error.message }))
      .finally(() => current && setCatalogueLoading(false));
    return () => { current = false; };
  }, [stateReady, train?.number, number]);

  const loadContext = useCallback(async () => {
    if (!train) return;
    setContextLoading(true);
    setContextError('');
    try {
      const lat = mapPosition?.lat ?? train.lat;
      const lng = mapPosition?.lng ?? train.lng;
      const payload = await api.get(
        `/api/geo/context?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&radius_m=3500`,
      );
      setContext(payload);
    } catch (error) {
      setContextError(error.message || 'Location context is unavailable');
    } finally {
      setContextLoading(false);
    }
  }, [train?.number, train?.lat, train?.lng, mapPosition?.lat, mapPosition?.lng]);

  useEffect(() => {
    if ((tab === 'weather' || tab === 'terrain') && !context && !contextLoading && !contextError) {
      loadContext();
    }
  }, [tab, context, contextLoading, contextError, loadContext]);

  const syncRailRadar = useCallback(async () => {
    setSyncingRailRadar(true);
    setRailRadarMessage('');
    try {
      const result = await api.post('/api/providers/refresh', {
        provider: 'railradar', train: number, force: false,
      });
      const row = result.trains?.[0];
      if (row?.applied) {
        setRailRadarMessage(row.position_mode === 'provider_coordinate'
          ? `RailRadar reported coordinate applied (${row.provider_age_s}s old).`
          : 'RailRadar route-distance anchor applied; no coordinate was supplied.');
      } else {
        const status = row?.provider_status || row?.error || 'no active journey';
        setRailRadarMessage(`RailRadar reports ${status}; the labelled simulation remains active.`);
      }
      await refreshState?.();
    } catch (error) {
      setRailRadarMessage(error.message || 'RailRadar refresh failed.');
    } finally {
      setSyncingRailRadar(false);
    }
  }, [number, refreshState]);

  const focusedState = useMemo(() => {
    if (!state || !train) return null;
    return {
      ...state,
      trains: [train],
      routes: (state.routes || []).filter((routeRow) => routeRow.train === train.number),
    };
  }, [state, train]);

  if (!state) {
    return <LoadingScreen message="Connecting to the RailSync feed…" />;
  }

  if (!train) {
    return (
      <TimetableFallback
        number={number}
        detail={catalogue}
        loading={catalogueLoading}
        onBack={() => navigate('/')}
        onOpenCatalogue={() => navigate(`/passengers?train=${encodeURIComponent(number)}`)}
      />
    );
  }

  const age = state.meta?.last_update
    ? Math.max(0, Math.round(now / 1000 - state.meta.last_update))
    : 0;
  const stale = Boolean(state.kpis?.stale || age > state.meta?.stale_after);
  const providerReported = train.position_source === 'railradar_reported';
  const providerLive = train.position_source?.startsWith('railradar_');
  const railRadarConfigured = Boolean(state.providers?.items?.railradar?.configured);
  const status = trainStatus(train);
  const currentSection = train.at_station
    ? train.last_station_name
    : `${train.last_station_code} → ${train.next_station_code || train.to_code}`;
  const section = (state.segments || []).find((row) => (
    row.a === train.last_station_code && row.b === train.next_station_code
  ));

  return (
    <div className="min-h-screen bg-[#f7faf9] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1500px] items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={() => navigate('/')} className="flex items-center gap-2.5" aria-label="RailSync home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white"><TrainFront size={19} /></span>
            <span className="hidden text-lg font-extrabold tracking-tight sm:inline">Rail<span className="text-teal-600">Sync</span></span>
          </button>
          <span className="mx-2 hidden h-6 w-px bg-slate-200 sm:block" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">Train {train.number} · {train.name}</div>
            <div className="hidden text-[10px] uppercase tracking-wider text-slate-400 sm:block">live intelligence workspace</div>
          </div>
          <DataPill positionSource={train.position_source} stale={stale} age={providerLive ? (train.telemetry_age_s ?? age) : age} />
          <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-500 lg:inline-flex">
            {mode === 'ws' ? 'WEBSOCKET' : mode === 'poll' ? 'REST POLL' : 'CONNECTING'}
          </span>
          <button type="button" onClick={() => navigate('/')} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-teal-200 hover:text-teal-700">
            <Search size={14} /> <span className="hidden sm:inline">New search</span>
          </button>
          <button type="button" onClick={() => navigate('/network')} className="hidden items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 md:inline-flex">
            <MapIcon size={14} /> Network
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:py-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg bg-teal-50 px-2.5 py-1 font-mono text-sm font-extrabold text-teal-800">#{train.number}</span>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${status.className}`}>{status.label}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  providerLive ? 'bg-teal-100 text-teal-800' : 'bg-amber-50 text-amber-800'
                }`}>
                  {providerLive ? <Satellite size={10} /> : <Database size={10} />}
                  {providerReported
                    ? 'RAILRADAR REPORTED POINT'
                    : providerLive
                      ? 'RAILRADAR-ANCHORED ESTIMATE'
                      : 'SIMULATED POSITION'}
                </span>
                {['mapped_rail_snap', 'track_route_snap'].includes(mapPosition?.method) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-800 ring-1 ring-teal-200">
                    <Route size={10} /> TRACK-SNAPPED · {Math.round(mapPosition.snapOffsetKm * 1000)} m
                  </span>
                )}
                {train.eta_source === 'historical_fallback' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                    <WifiOff size={10} /> HISTORICAL ETA FALLBACK
                  </span>
                )}
                <button
                  type="button"
                  onClick={syncRailRadar}
                  disabled={!railRadarConfigured || syncingRailRadar}
                  className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2.5 py-1 text-[10px] font-bold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  title={railRadarConfigured ? 'Quota-cached on-demand provider refresh' : 'RAILRADAR_API_KEY is not configured'}
                >
                  <RefreshCw size={10} className={syncingRailRadar ? 'animate-spin' : ''} />
                  {syncingRailRadar ? 'SYNCING…' : 'REFRESH RAILRADAR'}
                </button>
              </div>
              <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">{train.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span className="font-semibold text-slate-700">{train.from_name}</span>
                <ArrowRight size={14} className="text-teal-500" />
                <span className="font-semibold text-slate-700">{train.to_name}</span>
                <span>· {train.ttype}</span>
                <span>· {train.coaches} coaches</span>
              </div>
              {railRadarMessage && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] text-slate-600">
                  <Radio size={11} className="text-teal-600" /> {railRadarMessage}
                </div>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <SummaryStat icon={MapPin} label="Current section" value={currentSection} sub={train.at_station ? `station report ${train.last_station_time}` : `last report ${train.last_station_time}`} />
                <SummaryStat icon={Gauge} label="Current speed" value={`${Math.round(train.speed_kmh)} km/h`} sub={providerLive ? 'RailRadar-reported speed' : 'demo movement model'} />
                <SummaryStat icon={Route} label="Distance covered" value={`${Math.round(train.pos_km).toLocaleString('en-IN')} km`} sub={`of ${Math.round(train.total_km).toLocaleString('en-IN')} km · ${Math.round(train.progress * 100)}%`} />
              </div>

              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-teal-600 transition-[width] duration-700" style={{ width: `${Math.min(100, Math.max(0, train.progress * 100))}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between font-mono text-[10px] text-slate-400">
                  <span>{train.from_code}</span><span>{Math.round(train.progress * 100)}% complete</span><span>{train.to_code}</span>
                </div>
              </div>
            </div>

            <EtaCard train={train} measuredMae={state.meta?.mae} stale={stale} />
          </div>
        </section>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_410px]">
          <section className="min-w-0">
            <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
              <TabButton active={tab === 'map'} icon={MapIcon} onClick={() => setTab('map')}>Live map</TabButton>
              <TabButton active={tab === 'weather'} icon={CloudRain} onClick={() => setTab('weather')}>Weather</TabButton>
              <TabButton active={tab === 'terrain'} icon={Mountain} onClick={() => setTab('terrain')}>Terrain & analytics</TabButton>
            </div>

            <div className="mt-3 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              {tab === 'map' && (
                <div>
                  <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Navigation size={15} className="text-teal-600" /> Interactive route map</div>
                    <span className="ml-auto text-[10px] text-slate-400">Map remains mounted while WebSocket state updates</span>
                  </div>
                  <div className="relative h-[430px] bg-slate-900 sm:h-[520px]">
                    <LiveRailMap
                      state={focusedState}
                      selected={train.number}
                      onPositionResolved={setMapPosition}
                    />
                    <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-20 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-[10px] text-slate-300 backdrop-blur sm:right-auto">
                      <span><b className="font-semibold text-white">{train.number}</b> · {providerReported ? 'RailRadar reported point' : providerLive ? 'RailRadar-anchored estimate' : 'station-chain simulation'}</span>
                      {['mapped_rail_snap', 'track_route_snap'].includes(mapPosition?.method) && <span className="font-semibold text-teal-300">Turf snap correction {Math.round(mapPosition.snapOffsetKm * 1000)} m</span>}
                      {mapPosition?.method === 'track_along' && <span className="font-semibold text-teal-300">Turf along true track geometry</span>}
                      {mapPosition?.method === 'route_along' && <span className="text-amber-300">Turf along simplified route · mapped-rail snap unavailable/outside guard</span>}
                      {mapPosition?.method === 'provider_raw' && <span className="text-amber-300">Raw provider coordinate · track snap unavailable/outside guard</span>}
                      <span className="inline-flex items-center gap-1"><i className="h-[2px] w-5 bg-white" /> mapped railway</span>
                      <span className="inline-flex items-center gap-1"><i className="h-[3px] w-5 rounded" style={{ background: train.color }} /> timetable path</span>
                    </div>
                  </div>
                </div>
              )}

              {tab === 'weather' && (
                <WeatherPanel
                  train={train}
                  section={section}
                  context={context}
                  loading={contextLoading}
                  error={contextError}
                  onRefresh={loadContext}
                />
              )}

              {tab === 'terrain' && (
                <TerrainPanel
                  train={train}
                  context={context}
                  loading={contextLoading}
                  error={contextError}
                  onRefresh={loadContext}
                />
              )}
            </div>
          </section>

          <StationTimeline
            train={train}
            filter={stationFilter}
            onFilter={setStationFilter}
            onAlert={() => navigate(`/passengers?train=${encodeURIComponent(train.number)}`)}
          />
        </div>
      </main>
    </div>
  );
}

function EtaCard({ train, measuredMae, stale }) {
  if (train.status === 'arrived') {
    return (
      <div className="w-full rounded-2xl border border-teal-200 bg-teal-50 p-5 xl:w-[520px]">
        <div className="flex items-center gap-2 font-semibold text-teal-800"><CheckCircle2 size={18} /> Arrived at destination</div>
        <div className="mt-2 text-sm text-teal-700">This service has completed its current simulated run.</div>
      </div>
    );
  }
  const causes = train.cause || [];
  return (
    <div className="w-full rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-5 xl:w-[520px]">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-[185px] flex-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-teal-800">
            <Activity size={12} /> Predicted ETA · {train.next_station_code}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-3xl font-extrabold tracking-tight text-slate-950">{train.eta_next_time}</span>
            <span className="font-mono text-sm font-semibold text-teal-700">± {train.eta_range} min</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            scheduled {train.sched_next_time} · {train.next_station_name}
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
            <span className={`rounded-full px-2.5 py-1 font-bold ${
              stale ? 'bg-amber-100 text-amber-800' : 'bg-white text-teal-800 ring-1 ring-teal-200'
            }`}>
              {stale ? 'HISTORICAL FALLBACK' : 'EXPLAINABLE MODEL'}
            </span>
            {measuredMae != null && <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-slate-600 ring-1 ring-slate-200">measured MAE {measuredMae} min</span>}
          </div>
        </div>

        <div className="min-w-[220px] flex-1 border-t border-teal-100 pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800"><ShieldCheck size={14} className="text-teal-600" /> Why this ETA?</div>
          {causes.length ? (
            <div className="mt-2.5 space-y-2">
              {causes.slice(0, 5).map((cause) => (
                <div key={cause.cause}>
                  <div className="flex items-center justify-between text-[10px] text-slate-600">
                    <span>{CAUSE_LABELS[cause.cause] || cause.cause}</span>
                    <span className="font-mono font-semibold text-slate-800">{cause.pct}% · {cause.minutes}m</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-teal-100">
                    <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(2, cause.pct)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-[11px] leading-5 text-slate-500 ring-1 ring-teal-100">
              No significant extra delay is attributed on the current section.
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 border-t border-teal-100 pt-2 text-[10px] text-slate-400">
        The ± range is part of the prediction—not an accuracy percentage. Cause contributions come from the published linear explainer.
      </div>
    </div>
  );
}

function WeatherPanel({ train, section, context, loading, error, onRefresh }) {
  const contextualWeather = context?.weather?.available ? context.weather.data : null;
  const weather = train.weather_live || contextualWeather;
  const source = train.weather_live ? 'OpenWeather synced to train' : contextualWeather ? 'OpenWeather point observation' : 'simulation scenario';
  const severity = weather?.severity ?? section?.weather ?? 0;
  return (
    <div className="p-5 sm:p-6">
      <PanelTitle icon={CloudRain} title="Weather companion" subtitle="Current track conditions and their transparent ETA impact" loading={loading} onRefresh={onRefresh} />

      {weather ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LightMetric label={weather.place || 'Track section'} value={`${weather.temperature_c}°C`} sub={titleCase(weather.condition)} icon={CloudRain} />
          <LightMetric label="Feels like" value={`${weather.feels_like_c}°C`} sub={`Humidity ${weather.humidity_pct}%`} icon={Activity} />
          <LightMetric label="Wind" value={`${weather.wind_kmh} km/h`} sub={`Visibility ${weather.visibility_km} km`} icon={Wind} />
          <LightMetric label="ETA severity input" value={`${Math.round((weather.severity || 0) * 100)}%`} sub="deterministic weather score" icon={Gauge} />
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <div className="text-sm font-semibold text-amber-900">Live weather observation unavailable</div>
              <div className="mt-1 text-xs leading-5 text-amber-800">
                {context?.weather?.reason || error || 'OpenWeather is not configured.'} RailSync continues with the visibly labelled simulation scenario; it does not invent a temperature.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current section</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{train.last_station_code} → {train.next_station_code || train.to_code}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
            <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(2, severity * 100)}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-slate-500">
            <span>Weather severity {Math.round(severity * 100)}%</span>
            <span>{section?.weather_source || source}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-teal-100 bg-teal-50/60 p-4 text-xs leading-5 text-slate-600">
          <div className="font-semibold text-teal-800">How it affects ETA</div>
          <div className="mt-1">This bounded 0–100% condition score enters the simple residual model and the published cause explainer. Provider failure leaves the simulation fallback operational.</div>
        </div>
      </div>
    </div>
  );
}

function TerrainPanel({ train, context, loading, error, onRefresh }) {
  const terrain = context?.terrain;
  const osm = context?.osm;
  const chart = (train.stations || []).map((stop) => ({
    station: stop.code,
    delay: stop.delay_min,
  }));
  return (
    <div className="p-5 sm:p-6">
      <PanelTitle icon={Mountain} title="Terrain & route analytics" subtitle="Provider-backed point elevation plus the predicted delay profile" loading={loading} onRefresh={onRefresh} />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <LightMetric
          label="Current elevation"
          value={terrain?.available ? `${terrain.data.elevation_m} m` : 'Unavailable'}
          sub={terrain?.available ? `${terrain.data.dataset} · provider data` : (terrain?.reason || error || 'OpenTopography not configured')}
          icon={Mountain}
          muted={!terrain?.available}
        />
        <LightMetric
          label="Nearby railway"
          value={osm?.available ? `${osm.data.railway_way_count} ways` : 'Unavailable'}
          sub={osm?.available && osm.data.stations?.[0]
            ? `${osm.data.stations[0].name} · ${osm.data.stations[0].distance_km} km`
            : (osm?.reason || 'Overpass context pending')}
          icon={Layers3}
          muted={!osm?.available}
        />
        <LightMetric label="Remaining route" value={`${chart.length} stops`} sub={`${Math.round((1 - train.progress) * train.total_km).toLocaleString('en-IN')} km estimated`} icon={Route} />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-800">Predicted delay along the remaining route</div>
            <div className="text-[11px] text-slate-400">Minutes against schedule at each future calling stop</div>
          </div>
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-700">MODEL OUTPUT</span>
        </div>
        <div className="mt-3 h-[260px]">
          {chart.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="delayGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="station" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} unit="m" />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 11 }} formatter={(value) => [`${value} min`, 'Predicted delay']} />
                <Area type="monotone" dataKey="delay" stroke="#0d9488" strokeWidth={2.5} fill="url(#delayGradient)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">No remaining stops—the service has arrived.</div>
          )}
        </div>
      </div>

      {!terrain?.available && !loading && (
        <div className="mt-3 text-[10px] leading-5 text-slate-400">
          No elevation profile is fabricated when OpenTopography is unavailable. The delay chart above remains measured model output, not terrain data.
        </div>
      )}
    </div>
  );
}

function StationTimeline({ train, filter, onFilter, onAlert }) {
  const rows = useMemo(() => {
    const current = {
      key: `current-${train.last_station_code}`,
      code: train.last_station_code,
      name: train.last_station_name,
      scheduled_min: null,
      eta_min: null,
      delay_min: train.delay,
      tag: train.at_station ? 'current' : 'last',
    };
    return [current, ...(train.stations || []).map((row) => ({ ...row, key: `${row.seq}-${row.code}` }))];
  }, [train]);
  const needle = filter.trim().toLowerCase();
  const visible = rows.filter((row) => !needle || `${row.code} ${row.name}`.toLowerCase().includes(needle));

  return (
    <aside className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-[88px]">
      <div className="border-b border-slate-100 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Landmark size={16} className="text-teal-600" /> Station timeline</div>
            <div className="mt-0.5 text-[10px] text-slate-400">Current report and remaining model ETAs</div>
          </div>
          <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-bold text-teal-700">{rows.length} SHOWN</span>
        </div>
        <div className="relative mt-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="Filter stations…"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-xs text-slate-800 outline-none transition focus:border-teal-300 focus:bg-white focus:ring-2 focus:ring-teal-100"
          />
        </div>
      </div>

      <div className="max-h-[600px] overflow-y-auto px-4 py-2">
        {visible.map((stop, index) => {
          const isCurrent = stop.tag === 'current' || stop.tag === 'last';
          const isNext = stop.tag === 'next';
          const delay = Number(stop.delay_min || 0);
          return (
            <div key={stop.key} className="relative flex gap-3 py-3">
              {index < visible.length - 1 && <span className="absolute bottom-[-10px] left-[13px] top-8 w-px bg-slate-200" />}
              <span className={`relative z-10 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${
                isCurrent
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : isNext
                    ? 'border-teal-500 bg-white text-teal-600'
                    : 'border-slate-200 bg-white text-slate-400'
              }`}>
                {isCurrent ? <Navigation size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </span>
              <div className={`min-w-0 flex-1 rounded-xl border p-3 ${
                isCurrent ? 'border-teal-200 bg-teal-50/70' : isNext ? 'border-teal-100 bg-white' : 'border-slate-100 bg-slate-50/50'
              }`}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-800">{stop.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                      <span className="rounded bg-white px-1.5 py-0.5 font-mono font-bold ring-1 ring-slate-200">{stop.code}</span>
                      {isCurrent && <span className="font-bold text-teal-700">{train.at_station ? 'AT STATION' : 'LAST PASSED'}</span>}
                      {isNext && <span className="font-bold text-teal-700">NEXT</span>}
                      {isNext && train.next_platform && <span>PF {train.next_platform}</span>}
                    </div>
                  </div>
                  {!isCurrent && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[9px] font-bold ${delayTone(delay)}`}>
                      {delay > 1 ? `+${Math.round(delay)}m` : delay < -1 ? `${Math.round(delay)}m` : 'ON TIME'}
                    </span>
                  )}
                </div>
                {!isCurrent && (
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-[10px]">
                    <span className="text-slate-400">Scheduled <b className="ml-1 font-mono font-medium text-slate-600">{fmtAbs(stop.scheduled_min)}</b></span>
                    <span className="text-right text-slate-400">Predicted <b className="ml-1 font-mono font-semibold text-teal-700">{fmtAbs(stop.eta_min)}</b></span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <div className="px-3 py-10 text-center text-xs text-slate-400">No station matches that filter.</div>}
      </div>

      <div className="border-t border-slate-100 p-4">
        <button type="button" onClick={onAlert} className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-xs font-bold text-white transition hover:bg-teal-700">
          <BellRing size={14} /> Set a delay alert
        </button>
      </div>
    </aside>
  );
}

function DataPill({ positionSource, stale, age }) {
  if (stale) {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800"><WifiOff size={11} /> STALE {age}s</span>;
  }
  const reported = positionSource === 'railradar_reported';
  const anchored = positionSource === 'railradar_dead_reckoning';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${reported ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-800'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${reported ? 'animate-pulse bg-teal-500' : 'bg-amber-500'}`} />
      {reported ? `REPORTED ${age}s` : anchored ? `DEAD RECKONED ${age}s` : `DEMO ${age}s`}
    </span>
  );
}

function SummaryStat({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Icon size={12} className="text-teal-600" /> {label}</div>
      <div className="mt-1 truncate text-sm font-bold text-slate-800" title={value}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-slate-400" title={sub}>{sub}</div>
    </div>
  );
}

function TabButton({ active, icon: Icon, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
      active ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-teal-700'
    }`}>
      <Icon size={14} /> {children}
    </button>
  );
}

function PanelTitle({ icon: Icon, title, subtitle, loading, onRefresh }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Icon size={19} /></span>
      <div>
        <div className="text-sm font-bold text-slate-800">{title}</div>
        <div className="text-[11px] text-slate-400">{subtitle}</div>
      </div>
      <button type="button" onClick={onRefresh} disabled={loading} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] font-semibold text-slate-500 hover:border-teal-200 hover:text-teal-700 disabled:opacity-50">
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh context
      </button>
    </div>
  );
}

function LightMetric({ label, value, sub, icon: Icon, muted = false }) {
  return (
    <div className={`rounded-2xl border p-4 ${muted ? 'border-slate-200 bg-slate-50' : 'border-teal-100 bg-teal-50/40'}`}>
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400"><span>{label}</span><Icon size={13} className={muted ? 'text-slate-400' : 'text-teal-600'} /></div>
      <div className={`mt-2 text-xl font-extrabold ${muted ? 'text-slate-500' : 'text-slate-900'}`}>{value}</div>
      <div className="mt-1 min-h-[2.5em] text-[10px] leading-4 text-slate-400">{sub}</div>
    </div>
  );
}

function trainStatus(train) {
  if (train.status === 'arrived') return { label: 'ARRIVED', className: 'bg-slate-100 text-slate-600' };
  if (train.at_station && train.delay >= 5) return { label: `AT STATION · ${Math.round(train.delay)} MIN LATE`, className: 'bg-red-50 text-red-700' };
  if (train.at_station) return { label: 'AT STATION', className: 'bg-teal-100 text-teal-800' };
  if (train.delay >= 5) return { label: `${Math.round(train.delay)} MIN LATE`, className: 'bg-red-50 text-red-700' };
  if (train.delay <= -2) return { label: `${Math.abs(Math.round(train.delay))} MIN EARLY`, className: 'bg-teal-100 text-teal-800' };
  return { label: 'ON TIME', className: 'bg-teal-100 text-teal-800' };
}

function delayTone(delay) {
  if (delay >= 15) return 'bg-red-50 text-red-700';
  if (delay >= 5) return 'bg-amber-50 text-amber-700';
  return 'bg-teal-50 text-teal-700';
}

function titleCase(value) {
  return String(value || 'Unknown').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function LoadingScreen({ message }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-slate-900">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 text-white"><TrainFront size={23} /></span>
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={15} className="animate-spin text-teal-600" /> {message}</div>
      </div>
    </div>
  );
}

function TimetableFallback({ number, detail, loading, onBack, onOpenCatalogue }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-[68px] max-w-5xl items-center px-5">
          <button type="button" onClick={onBack} className="flex items-center gap-2 text-lg font-extrabold"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white"><TrainFront size={19} /></span><span>Rail<span className="text-teal-600">Sync</span></span></button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-16">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-700"><ArrowLeft size={14} /> Back to search</button>
        <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle size={16} className="animate-spin text-teal-600" /> Checking active and timetable data…</div>
          ) : detail && !detail.error ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600"><Database size={11} /> UPLOADED TIMETABLE · NOT LIVE</span>
              <div className="mt-4 font-mono text-sm font-bold text-teal-700">#{detail.number}</div>
              <h1 className="mt-1 text-2xl font-extrabold">{detail.name}</h1>
              <p className="mt-2 text-sm text-slate-500">{detail.source?.name || detail.source?.code || 'Source not supplied'} → {detail.destination?.name || detail.destination?.code || 'Destination not supplied'} · {detail.type}</p>
              <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
                This train is present in the static timetable catalogue but has no active RailSync telemetry. A position or ML ETA will not be fabricated.
              </div>
              <button type="button" onClick={onOpenCatalogue} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700">Open timetable details <ArrowRight size={15} /></button>
            </>
          ) : (
            <>
              <AlertTriangle size={24} className="text-amber-600" />
              <h1 className="mt-3 text-xl font-bold">Train {number} was not found</h1>
              <p className="mt-2 text-sm text-slate-500">Try another train number or search the full uploaded timetable.</p>
              <button type="button" onClick={onBack} className="mt-5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white">Search trains</button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
