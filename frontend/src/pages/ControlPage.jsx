import { useEffect, useMemo, useState } from 'react';
import {
  Pause, Play, Zap, CloudRain, Ban, TrafficCone,
  TrainFront, Timer, AlertTriangle, BellRing, Satellite, Layers3,
  Mountain, MapPinned, Database,
} from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { KpiCard, StatusChip, CauseBar } from '../components/bits.jsx';
import { fmtAbs, severityClass } from '../utils.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/**
 * Control room: operations view over the whole fleet — sortable by delay
 * severity, congestion ranking, predicted-vs-actual accuracy, plus the
 * demo levers (time acceleration, feed pause, incident injection).
 */
export default function ControlPage({ state }) {
  const [sortKey, setSortKey] = useState('delay');
  const [acc, setAcc] = useState(null);
  const { push } = useToast();

  useEffect(() => {
    let live = true;
    api.get('/api/accuracy').then((a) => live && setAcc(a)).catch(() => {});
    return () => { live = false; };
  }, [state?.meta?.tick]);

  if (!state) return <div className="p-8 text-muted text-sm">Loading control room…</div>;

  const trains = [...state.trains].sort((a, b) => {
    if (sortKey === 'delay') return b.delay - a.delay;
    if (sortKey === 'speed') return b.speed_kmh - a.speed_kmh;
    if (sortKey === 'number') return a.number.localeCompare(b.number);
    return 0;
  });

  const setControl = async (body) => {
    try {
      await api.post('/api/control', body);
    } catch (e) {
      push({ kind: 'bad', title: 'Control error', body: e.message });
    }
  };

  const spawn = async (type) => {
    try {
      const r = await api.post('/api/control/event', { type });
      push({ kind: 'warn', title: 'Incident injected', body: r.events?.[0]?.msg || '' });
    } catch (e) {
      push({ kind: 'bad', title: 'Event error', body: e.message });
    }
  };

  const Th = ({ k, children, right }) => (
    <th
      onClick={() => setSortKey(k)}
      className={`px-3 py-2 text-[10px] uppercase tracking-wider font-semibold cursor-pointer select-none hover:text-slate-200 ${right ? 'text-right' : 'text-left'} ${sortKey === k ? 'text-ir-sky' : 'text-muted'}`}
    >
      {children} {sortKey === k ? '↓' : ''}
    </th>
  );

  return (
    <div className="p-5 space-y-4 max-w-[1400px] mx-auto">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Services running" value={state.kpis.n_trains} icon={TrainFront} />
        <KpiCard label="On time" value={state.kpis.on_time} tone="ok" sub="< 5 min" />
        <KpiCard label="Minor delay" value={state.kpis.minor} tone="warn" sub="5–15 min" />
        <KpiCard label="Major delay" value={state.kpis.major + state.kpis.severe} tone="bad" sub="> 15 min" />
        <KpiCard label="Avg delay" value={`${state.kpis.avg_delay}m`} icon={Timer} />
        <KpiCard label="Active alerts" value={state.kpis.active_alerts} icon={BellRing} />
      </div>

      {/* demo levers */}
      <div className="panel p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Sim speed</span>
          {[1, 2, 4, 8, 16].map((x) => (
            <button
              key={x}
              onClick={() => setControl({ sim_speed: x })}
              className={`chip border font-mono ${state.meta.sim_speed === x ? 'bg-ir-blue/20 text-ir-sky border-ir-blue/50' : 'bg-ink-800 text-muted border-line hover:text-slate-200'}`}
            >
              ×{x}
            </button>
          ))}
        </div>
        <button
          onClick={() => setControl({ paused: !state.meta.paused })}
          className={`chip border ${state.meta.paused ? 'bg-ok/15 text-ok border-ok/40' : 'bg-warn/10 text-warn border-warn/40'}`}
        >
          {state.meta.paused ? <Play size={12} /> : <Pause size={12} />}
          {state.meta.paused ? 'Resume feed' : 'Pause feed (stale demo)'}
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Inject incident</span>
          <button onClick={() => spawn('storm')} className="chip border bg-ink-800 text-muted border-line hover:text-slate-200"><CloudRain size={12} /> Storm front</button>
          <button onClick={() => spawn('blockage')} className="chip border bg-ink-800 text-muted border-line hover:text-slate-200"><TrafficCone size={12} /> Line blockage</button>
          <button onClick={() => spawn('signal')} className="chip border bg-ink-800 text-muted border-line hover:text-slate-200"><Ban size={12} /> Signal hold</button>
        </div>
      </div>

      <div className="grid xl:grid-cols-[1.6fr_1fr] gap-4 items-start">
        {/* fleet table */}
        <div className="panel overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-[13px] font-semibold flex items-center gap-2">
            <Zap size={15} className="text-ir-sky" /> Fleet — sortable by severity
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead className="bg-ink-800/60">
                <tr>
                  <Th k="number">Train</Th>
                  <Th k="delay">Delay</Th>
                  <Th k="speed">Speed</Th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted text-left">Next</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted text-left">Sched → Predicted</th>
                  <th className="px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-muted text-left">Cause (live section)</th>
                </tr>
              </thead>
              <tbody>
                {trains.map((t) => (
                  <tr key={t.number} className="border-t border-line/60 hover:bg-ink-800/40">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-none" style={{ background: t.color }} />
                        <div>
                          <div className="font-mono font-semibold">{t.number} <span className="font-sans font-normal text-slate-300">{t.name}</span></div>
                          <div className="text-[10px] text-muted font-mono">{t.from_code} → {t.to_code}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5"><StatusChip t={t} /></td>
                    <td className="px-3 py-2.5 font-mono text-slate-300">{t.speed_kmh} km/h</td>
                    <td className="px-3 py-2.5 text-slate-300">{t.next_station_name || '—'}</td>
                    <td className="px-3 py-2.5 font-mono">
                      {t.status === 'arrived' ? (
                        <span className="text-muted">arrived</span>
                      ) : (
                        <><span className="text-muted">{fmtAbs(t.sched_next_min)}</span> → <span className="text-ir-sky">{t.eta_next_time}</span> <span className="text-muted text-[10px]">±{t.eta_range}</span></>
                      )}
                    </td>
                    <td className="px-3 py-2.5 min-w-[190px] max-w-[230px]">
                      {t.status === 'arrived' ? <span className="text-muted text-[11px]">—</span> : <CauseBar cause={t.cause} compact />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <ProviderHealth providers={state.providers} />

          {/* congestion */}
          <div className="panel p-4">
            <div className="text-[13px] font-semibold mb-3 flex items-center gap-2">
              <TrafficCone size={15} className="text-warn" /> Most congested sections
            </div>
            <div className="space-y-2.5">
              {state.congestion_rank.map((s) => (
                <div key={`${s.a}-${s.b}`}>
                  <div className="flex justify-between text-[11.5px] mb-1">
                    <span className="font-mono text-slate-200">{s.a} → {s.b}</span>
                    <span className="text-muted font-mono">
                      {Math.round(s.congestion * 100)}%{s.weather > 0.35 && <span className="text-ir-sky"> · wx {Math.round(s.weather * 100)}%</span>}{s.hold > 0 && <span className="text-bad"> · signal {Math.round(s.hold)}m</span>}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${s.congestion * 100}%`,
                        background: s.congestion > 0.6 ? '#ff5c5c' : s.congestion > 0.4 ? '#ffc233' : '#4f6ef7',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* event feed */}
          <div className="panel p-4">
            <div className="text-[13px] font-semibold mb-2.5 flex items-center gap-2">
              <AlertTriangle size={15} className="text-warn" /> Incident feed
            </div>
            {state.events.length === 0 && <div className="text-[12px] text-muted italic">No incidents yet this session.</div>}
            <div className="space-y-1.5">
              {state.events.map((e, i) => (
                <div key={i} className="text-[11.5px] text-slate-300 flex gap-2">
                  <span className="font-mono text-muted flex-none w-12">{fmtAbs(e.clock + 0)}</span>
                  <span>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* accuracy tracker */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[13px] font-semibold">Predicted vs actual arrival — model trust tracker</div>
          <div className="text-[11px] text-muted font-mono">
            rolling MAE (last 20 arrivals): <span className="text-ir-sky">{acc?.rolling_mae ?? '—'} min</span> · n={acc?.n ?? 0}
          </div>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="h-[220px]">
            {acc && acc.points.length >= 2 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={acc.points.map((p, i) => ({ i: i + 1, err: p.abs_error, label: `${p.train_number} @ ${p.station_code}` }))}>
                  <CartesianGrid stroke="#1c2951" strokeDasharray="3 3" />
                  <XAxis dataKey="i" tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" />
                  <YAxis tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" unit="m" width={40} />
                  <Tooltip
                    contentStyle={{ background: '#0c1226', border: '1px solid #1c2951', borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(l) => `arrival #${l}`}
                    formatter={(v, _n, item) => [`${v} min`, item.payload.label]}
                  />
                  <Line type="monotone" dataKey="err" stroke="#8fa5ff" strokeWidth={2} dot={{ r: 2.5, fill: '#8fa5ff' }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted text-[12px]">
                Waiting for arrivals… (trains land every few sim-hours — crank sim speed to ×16)
              </div>
            )}
          </div>
          <div className="overflow-auto max-h-[220px]">
            <table className="w-full text-[11.5px] font-mono">
              <thead className="sticky top-0 bg-ink-850">
                <tr className="text-muted text-[10px] uppercase tracking-wider">
                  <th className="text-left font-semibold px-2 py-1.5">When</th>
                  <th className="text-left font-semibold">Train</th>
                  <th className="text-left font-semibold">Station</th>
                  <th className="text-right font-semibold">Predicted</th>
                  <th className="text-right font-semibold">Actual</th>
                  <th className="text-right font-semibold px-2">|err|</th>
                </tr>
              </thead>
              <tbody>
                {(acc?.points || []).slice(-8).reverse().map((p, i) => (
                  <tr key={i} className="border-t border-line/50">
                    <td className="px-2 py-1.5 text-muted">{p.ts}</td>
                    <td>{p.train_number}</td>
                    <td>{p.station_code}</td>
                    <td className="text-right text-ir-sky">{p.predicted}</td>
                    <td className="text-right text-slate-200">{p.actual}</td>
                    <td className={`text-right px-2 ${p.abs_error > 8 ? 'text-bad' : p.abs_error > 4 ? 'text-warn' : 'text-ok'}`}>{p.abs_error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderHealth({ providers }) {
  const icons = {
    railradar: Satellite,
    maptiler: Layers3,
    openweather: CloudRain,
    opentopography: Mountain,
    geoapify: MapPinned,
    overpass: Database,
  };
  const rows = Object.entries(providers?.items || {});
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 mb-3">
        <Satellite size={15} className={providers?.mode === 'hybrid' ? 'text-ok' : 'text-ir-sky'} />
        <div className="text-[13px] font-semibold flex-1">External data fabric</div>
        <span className={`chip border ${providers?.mode === 'hybrid' ? 'bg-ok/10 text-ok border-ok/30' : 'bg-ink-800 text-muted border-line'}`}>
          {providers?.mode === 'hybrid' ? 'HYBRID LIVE' : 'FALLBACK READY'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map(([key, item]) => {
          const Icon = icons[key] || Database;
          const ready = item.active || (key === 'overpass' && item.mode !== 'degraded');
          return (
            <div key={key} className="rounded-lg bg-ink-800/60 border border-line/60 px-2.5 py-2 min-w-0" title={item.error || item.purpose}>
              <div className="flex items-center gap-1.5">
                <Icon size={11} className={ready ? 'text-ok' : item.configured ? 'text-warn' : 'text-muted'} />
                <span className="text-[10.5px] font-semibold truncate">{item.label}</span>
                <i className={`ml-auto w-1.5 h-1.5 rounded-full ${ready ? 'bg-ok' : item.configured ? 'bg-warn' : 'bg-slate-600'}`} />
              </div>
              <div className="text-[9px] text-muted mt-1 truncate">
                {item.error || (ready ? item.mode : item.configured ? 'configured · awaiting call' : 'key not set')}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-muted mt-2.5">
        Secrets stay server-side · failures degrade independently · health at /api/providers
      </div>
    </div>
  );
}
