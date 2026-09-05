import { useRef, useState } from 'react';
import {
  CloudRain, Database, Flag, Layers3, LocateFixed, MapPin, Mountain,
  Radio, RefreshCw, Satellite, X,
} from 'lucide-react';
import { api } from '../api.js';
import LiveRailMap from '../components/LiveRailMap.jsx';
import { StatusChip, CauseBar, EtaBig, SpeedGauge } from '../components/bits.jsx';
import { fmtAbs } from '../utils.js';
import { inspectLocation, MAPTILER_KEY, GEOAPIFY_KEY } from '../services/geography.js';

export default function MapPage({ state }) {
  const [sel, setSel] = useState(null);
  const [inspector, setInspector] = useState(null);
  const inspectSeq = useRef(0);

  if (!state) {
    return <div className="p-8 text-muted text-sm">Loading live network…</div>;
  }

  const selected = sel ? state.trains.find((t) => t.number === sel) : null;

  const inspect = async (lat, lng) => {
    const seq = ++inspectSeq.current;
    setInspector({ loading: true, lat, lng });
    try {
      const data = await inspectLocation(lat, lng);
      if (seq === inspectSeq.current) setInspector({ loading: false, lat, lng, data });
    } catch (error) {
      if (seq === inspectSeq.current) setInspector({ loading: false, lat, lng, error: error.message });
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 relative min-w-0 overflow-hidden">
        <LiveRailMap
          state={state}
          selected={sel}
          onSelect={setSel}
          onInspect={inspect}
        />

        <ProviderStrip providers={state.providers} />
        {inspector && <GeoInspector value={inspector} onClose={() => setInspector(null)} />}

        <div className="absolute bottom-4 left-4 right-4 z-20 panel px-3.5 py-2.5 text-[11px] text-muted flex flex-wrap items-center gap-x-4 gap-y-1.5 shadow-xl">
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-ok inline-block" /> on time</span>
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-warn inline-block" /> 5–15 min</span>
          <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-bad inline-block" /> &gt;15 min</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-[2px] w-5 bg-white" /> mapped railway</span>
          <span>coloured path = timetable station chain</span>
          <span>click map for live geo context</span>
        </div>
      </div>

      <div className="w-[392px] flex-none border-l border-line bg-ink-900 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {selected ? (
            <TrainDetail
              t={selected}
              providers={state.providers}
              onBack={() => setSel(null)}
              onInspect={() => inspect(selected.lat, selected.lng)}
            />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                  Services running ({state.trains.length})
                </div>
                <span className={`chip border ${state.providers?.mode === 'hybrid' ? 'text-ok border-ok/30 bg-ok/10' : 'text-muted border-line bg-ink-800'}`}>
                  {state.providers?.mode === 'hybrid' ? <Satellite size={11} /> : <Database size={11} />}
                  {state.providers?.mode === 'hybrid' ? 'HYBRID LIVE' : 'DEMO FALLBACK'}
                </span>
              </div>
              <div className="space-y-2">
                {[...state.trains]
                  .sort((a, b) => b.delay - a.delay)
                  .map((t) => (
                    <button
                      key={t.number}
                      onClick={() => setSel(t.number)}
                      className="w-full panel p-3 text-left hover:border-ir-blue/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: t.color }} />
                        <span className="font-mono font-bold text-[13px]">{t.number}</span>
                        <span className="text-[13px] text-slate-200 flex-1 truncate">{t.name}</span>
                        <StatusChip t={t} />
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-[11px] text-muted">
                        <MapPin size={11} />
                        <span>{t.from_code} → {t.to_code}</span>
                        <span className="flex-1" />
                        {t.position_source?.startsWith('railradar_') && (
                          <span className="text-ok flex items-center gap-1"><Radio size={10} /> RR</span>
                        )}
                        {t.status !== 'arrived' && (
                          <span className="font-mono">ETA {t.eta_next_time} ±{t.eta_range}</span>
                        )}
                      </div>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ProviderStrip({ providers }) {
  const p = providers?.items || {};
  const rows = [
    { key: 'railradar', short: 'RailRadar', icon: Satellite },
    { key: 'maptiler', short: 'MapTiler', icon: Layers3, clientConfigured: !!MAPTILER_KEY },
    { key: 'openweather', short: 'Weather', icon: CloudRain },
    { key: 'opentopography', short: 'Terrain', icon: Mountain },
    { key: 'geoapify', short: 'Geoapify', icon: LocateFixed, clientConfigured: !!GEOAPIFY_KEY },
    { key: 'overpass', short: 'OSM', icon: Database },
  ];
  return (
    <div className="absolute top-4 left-4 z-20 panel px-2.5 py-2 flex items-center gap-1.5 flex-wrap shadow-xl" style={{ maxWidth: 'calc(100% - 5rem)' }}>
      {rows.map(({ key, short, icon: Icon, clientConfigured }) => {
        const item = p[key] || {};
        const configured = clientConfigured ?? item.configured;
        const active = item.active || (key === 'overpass' && item.mode !== 'degraded');
        return (
          <span
            key={key}
            title={`${item.label || short}: ${item.error || item.mode || (configured ? 'configured' : 'fallback')}`}
            className={`chip border px-2 ${active ? 'bg-ok/10 text-ok border-ok/25' : configured ? 'bg-warn/10 text-warn border-warn/25' : 'bg-ink-800/90 text-muted border-line'}`}
          >
            <Icon size={10} /> {short}
            <i className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-ok' : configured ? 'bg-warn' : 'bg-slate-600'}`} />
          </span>
        );
      })}
    </div>
  );
}

function GeoInspector({ value, onClose }) {
  const { data } = value;
  const weather = data?.weather;
  const terrain = data?.terrain;
  const osm = data?.osm;
  const place = data?.place;
  const nearest = osm?.available ? osm.data.stations?.[0] : null;
  return (
    <div className="absolute top-16 left-4 z-20 w-[330px] panel shadow-2xl overflow-hidden">
      <div className="px-3.5 py-3 border-b border-line flex items-center gap-2">
        <LocateFixed size={14} className="text-ir-sky" />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-200">Location intelligence</div>
          <div className="text-[10px] text-muted font-mono">{value.lat.toFixed(4)}, {value.lng.toFixed(4)}</div>
        </div>
        <button onClick={onClose} className="text-muted hover:text-slate-100"><X size={14} /></button>
      </div>
      {value.loading ? (
        <div className="p-4 text-[12px] text-muted flex items-center gap-2">
          <RefreshCw size={13} className="animate-spin" /> querying Geoapify, weather, terrain and OSM…
        </div>
      ) : value.error ? (
        <div className="p-4 text-[12px] text-bad">{value.error}</div>
      ) : (
        <div className="p-3 space-y-2 text-[11px]">
          <ContextRow icon={MapPin} label="Geoapify" ok={place?.available}
            value={place?.available ? place.data.formatted : compactReason(place?.reason)} />
          <ContextRow icon={CloudRain} label="OpenWeather" ok={weather?.available}
            value={weather?.available
              ? `${titleCase(weather.data.condition)} · ${weather.data.temperature_c}°C · severity ${Math.round(weather.data.severity * 100)}%`
              : compactReason(weather?.reason)} />
          <ContextRow icon={Mountain} label="OpenTopography" ok={terrain?.available}
            value={terrain?.available
              ? `${terrain.data.elevation_m} m · ${terrain.data.dataset}${terrain.data.vertical_datum ? ` / ${terrain.data.vertical_datum}` : ''}`
              : compactReason(terrain?.reason)} />
          <ContextRow icon={Database} label="Overpass OSM" ok={osm?.available}
            value={osm?.available
              ? nearest
                ? `${nearest.name} ${nearest.distance_km} km away · ${osm.data.railway_way_count} nearby rail ways`
                : `${osm.data.railway_way_count} nearby rail ways · no named station within ${osm.data.radius_m / 1000} km`
              : compactReason(osm?.reason)} />
          <div className="pt-1 text-[9px] text-muted border-t border-line/60">
            Partial-success gateway: one failed provider never hides the others.
          </div>
        </div>
      )}
    </div>
  );
}

function ContextRow({ icon: Icon, label, ok, value }) {
  return (
    <div className="rounded-lg bg-ink-800/70 border border-line/60 p-2.5 flex gap-2.5">
      <Icon size={13} className={ok ? 'text-ok mt-0.5' : 'text-muted mt-0.5'} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-slate-300">
          {label}<i className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-ok' : 'bg-slate-600'}`} />
        </div>
        <div className="text-muted mt-0.5 leading-relaxed break-words">{value || 'Unavailable'}</div>
      </div>
    </div>
  );
}

function TrainDetail({ t, providers, onBack, onInspect }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');
  const rail = providers?.items?.railradar;

  const syncRailRadar = async () => {
    setSyncing(true);
    setSyncResult('');
    try {
      const result = await api.post('/api/providers/refresh', {
        provider: 'railradar', train: t.number, force: false,
      });
      const row = result.trains?.[0];
      setSyncResult(row?.applied
        ? `${row.position_mode === 'provider_coordinate' ? 'RailRadar reported coordinate' : 'RailRadar route-distance anchor'}${row.cached ? ' (cache)' : ''} · ${row.delay_min >= 0 ? '+' : ''}${row.delay_min} min`
        : `RailRadar reports ${row?.provider_status || row?.error || 'no active journey'}; labelled simulation retained`);
    } catch (error) {
      setSyncResult(error.message || 'RailRadar refresh failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-[12px] text-muted hover:text-slate-200 flex items-center gap-1">
        ← all services
      </button>

      <div className="panel p-4">
        <div className="flex items-center gap-2.5">
          <span
            className="font-mono font-extrabold text-lg px-2.5 py-1 rounded-lg border"
            style={{ borderColor: t.color, color: t.color, background: `${t.color}14` }}
          >
            {t.number}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[15px] truncate">{t.name}</div>
            <div className="text-[11px] text-muted">{t.ttype} · {t.coaches} coaches · priority {Math.round(t.priority * 100)}%</div>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-[12px]">
          <span className="text-muted">{t.from_code} → {t.to_code}</span>
          <StatusChip t={t} />
        </div>

        <div className="mt-2.5">
          <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${t.progress * 100}%`, background: t.color }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted mt-1 font-mono">
            <span>{Math.round(t.pos_km)} km</span>
            <span>{Math.round(t.progress * 100)}%</span>
            <span>{Math.round(t.total_km)} km</span>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <SpeedGauge speed={t.speed_kmh} />
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
              <MapPin size={12} /> last: <span className="text-slate-200">{t.last_station_name}</span>
              <span className="font-mono">({t.last_station_time})</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Flag size={12} /> next: <span className="text-slate-200">{t.next_station_name || '—'}</span>
            </span>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-line flex items-center gap-2">
          <span className={`chip border ${t.position_source?.startsWith('railradar_') ? 'bg-ok/10 text-ok border-ok/30' : 'bg-ink-800 text-muted border-line'}`}>
            {t.position_source?.startsWith('railradar_') ? <Satellite size={11} /> : <Database size={11} />}
            {t.position_source === 'railradar_reported'
              ? `RAILRADAR REPORTED · ${t.telemetry_age_s}s`
              : t.position_source === 'railradar_dead_reckoning'
                ? `RAILRADAR ESTIMATE · ${t.telemetry_age_s}s`
                : 'STATION-CHAIN SIMULATION'}
          </span>
          <span className="flex-1" />
          <button onClick={onInspect} className="text-[10px] text-ir-sky hover:text-white flex items-center gap-1">
            <LocateFixed size={11} /> inspect
          </button>
        </div>
        <button
          onClick={syncRailRadar}
          disabled={!rail?.configured || syncing}
          className="mt-2 w-full rounded-lg border border-line bg-ink-800 px-3 py-2 text-[11px] font-semibold text-slate-300 hover:border-ir-blue/50 disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          title={rail?.configured ? 'Uses a cached call for 5 minutes to protect quota' : 'Add RAILRADAR_API_KEY to .env'}
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Contacting RailRadar…' : rail?.configured ? 'Sync live RailRadar telemetry' : 'RailRadar key not configured'}
        </button>
        {syncResult && <div className="mt-2 text-[10px] text-muted leading-relaxed">{syncResult}</div>}
      </div>

      {t.weather_live && (
        <div className="panel p-3 flex items-center gap-3">
          <CloudRain size={17} className="text-ir-sky" />
          <div className="flex-1">
            <div className="text-[11px] font-semibold text-slate-200">OpenWeather · {titleCase(t.weather_live.condition)}</div>
            <div className="text-[10px] text-muted">{t.weather_live.temperature_c}°C · wind {t.weather_live.wind_kmh} km/h · ETA severity {Math.round(t.weather_live.severity * 100)}%</div>
          </div>
          <span className="chip bg-ok/10 text-ok border border-ok/25">LIVE</span>
        </div>
      )}

      {t.status !== 'arrived' && (
        <div className="panel p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">
            Predicted arrival — {t.next_station_name}
          </div>
          <EtaBig t={t} />
          <div className="mt-1 text-[11px] text-muted font-mono">
            scheduled {fmtAbs(t.sched_next_min)} · delay now {t.delay > 0 ? '+' : ''}{Math.round(t.delay)} min
          </div>
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">
              Why — expected delay on current section
            </div>
            <CauseBar cause={t.cause} />
          </div>
        </div>
      )}

      {t.stations && t.stations.length > 0 && (
        <div className="panel p-4">
          <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">
            Route ETA (model)
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted">
                <th className="text-left font-semibold pb-1.5">Station</th>
                <th className="text-right font-semibold pb-1.5">Sched</th>
                <th className="text-right font-semibold pb-1.5">Predicted</th>
                <th className="text-right font-semibold pb-1.5">Δ</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {t.stations.map((s) => (
                <tr key={s.seq} className="border-t border-line/60">
                  <td className="py-1.5 text-slate-200 font-sans">
                    {s.code}<span className="text-muted text-[10px] ml-1.5">{s.name}</span>
                  </td>
                  <td className="text-right text-muted">{fmtAbs(s.scheduled_min)}</td>
                  <td className={`text-right ${s.tag === 'next' ? 'text-ir-sky font-semibold' : 'text-slate-200'}`}>
                    {fmtAbs(s.eta_min)}
                    {s.range_min != null && <span className="text-muted text-[10px]"> ±{s.range_min}</span>}
                  </td>
                  <td className={`text-right ${s.delay_min >= 15 ? 'text-bad' : s.delay_min >= 5 ? 'text-warn' : s.delay_min <= 0 ? 'text-ok' : 'text-muted'}`}>
                    {s.delay_min > 0 ? '+' : ''}{Math.round(s.delay_min)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function compactReason(value) {
  if (!value) return 'Unavailable';
  return String(value)
    .replace('OPENWEATHER_API_KEY is not configured', 'API key not configured')
    .replace('OPENTOPOGRAPHY_API_KEY is not configured', 'API key not configured')
    .replace('VITE_GEOAPIFY_API_KEY is not configured', 'API key not configured');
}

function titleCase(value) {
  return String(value || '').replace(/\b\w/g, (m) => m.toUpperCase());
}
