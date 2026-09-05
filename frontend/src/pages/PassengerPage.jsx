import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, BellRing, CalendarDays, Clock3, Database, MapPin,
  Search, Trash2,
} from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { StatusChip, CauseBar, EtaBig } from '../components/bits.jsx';
import { fmtAbs } from '../utils.js';

/** Passenger search combines six live demo services with every train from the
 * incrementally installed timetable parts. Catalogue-only results never claim
 * a live ETA; they show supplied schedule/route provenance instead. */
export default function PassengerPage({ state }) {
  const initialTrain = useMemo(
    () => new URLSearchParams(window.location.search).get('train')?.trim() || '',
    [],
  );
  const [q, setQ] = useState(initialTrain);
  const [sel, setSel] = useState(null);
  const [catalogSel, setCatalogSel] = useState(initialTrain || null);
  const [catalogResults, setCatalogResults] = useState([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogDetail, setCatalogDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [threshold, setThreshold] = useState(10);
  const [phone, setPhone] = useState('+91 ');
  const initialApplied = useRef(false);
  const { push } = useToast();

  useEffect(() => {
    if (initialApplied.current || !initialTrain || !state) return;
    initialApplied.current = true;
    if (state.trains.some((item) => item.number === initialTrain)) {
      setSel(initialTrain);
      setCatalogSel(null);
    }
  }, [initialTrain, state]);

  const needle = q.trim().toLowerCase();
  const liveResults = useMemo(() => {
    if (!state) return [];
    if (!needle) return state.trains;
    return state.trains.filter((train) => {
      const upcoming = train.stations || [];
      return (
        train.number.includes(needle)
        || train.name.toLowerCase().includes(needle)
        || `${train.from_code} ${train.to_code}`.toLowerCase().includes(needle)
        || `${train.from_name} ${train.to_name}`.toLowerCase().includes(needle)
        || upcoming.some((stop) => `${stop.code} ${stop.name}`.toLowerCase().includes(needle))
      );
    });
  }, [state, needle]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setCatalogResults([]);
      setCatalogTotal(0);
      setCatalogLoading(false);
      return undefined;
    }
    let live = true;
    setCatalogLoading(true);
    const timer = window.setTimeout(() => {
      api.get(`/api/catalog/trains?q=${encodeURIComponent(term)}&limit=12`)
        .then((result) => {
          if (!live) return;
          setCatalogResults(result.trains || []);
          setCatalogTotal(result.total || 0);
        })
        .catch(() => {
          if (live) { setCatalogResults([]); setCatalogTotal(0); }
        })
        .finally(() => live && setCatalogLoading(false));
    }, 220);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    if (!catalogSel) {
      setCatalogDetail(null);
      setDetailLoading(false);
      return undefined;
    }
    let live = true;
    setDetailLoading(true);
    setCatalogDetail(null);
    api.get(`/api/catalog/trains/${encodeURIComponent(catalogSel)}`)
      .then((result) => live && setCatalogDetail(result))
      .catch((error) => live && setCatalogDetail({ error: error.message }))
      .finally(() => live && setDetailLoading(false));
    return () => { live = false; };
  }, [catalogSel]);

  const chooseLive = (number) => {
    setSel(number);
    setCatalogSel(null);
  };
  const chooseCatalogue = (number) => {
    setCatalogSel(number);
    setSel(null);
  };
  const changeQuery = (value) => {
    setQ(value);
    setSel(null);
    setCatalogSel(null);
  };

  const train = sel && state ? state.trains.find((item) => item.number === sel) : null;
  const alerts = state?.alerts || [];
  const catalogueCount = state?.meta?.train_catalogue?.trains || 0;

  const setAlert = async () => {
    if (!train) return;
    try {
      const alert = await api.post('/api/alerts', { train: train.number, threshold });
      push({
        kind: 'info',
        title: `Alert set on ${train.number}`,
        body: `${alert.message} (SMS/push is mocked in the prototype — you'll see a toast when it triggers.)`,
      });
    } catch (error) {
      push({ kind: 'bad', title: 'Could not set alert', body: error.message });
    }
  };

  const delAlert = async (id) => {
    try { await api.del(`/api/alerts/${id}`); } catch {}
  };

  const noResults = needle.length >= 2 && !catalogLoading
    && liveResults.length === 0 && catalogResults.length === 0;

  return (
    <div className="p-5 max-w-6xl mx-auto">
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4 items-start">
        <div className="space-y-3">
          <div className="panel p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">
                Find your train
              </div>
              <span className="chip border border-line bg-ink-800 text-muted">
                <Database size={10} /> {catalogueCount.toLocaleString('en-IN')} TIMETABLE TRAINS
              </span>
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(event) => changeQuery(event.target.value)}
                placeholder="Train no., name or any route station — e.g. 12301, Howrah, HWH…"
                className="w-full bg-ink-800 border border-line rounded-lg pl-9 pr-3 py-2.5 text-[14px] placeholder:text-muted/60 focus:outline-none focus:border-ir-blue/60"
              />
            </div>
            <div className="mt-2 text-[10px] text-muted">
              Live cards carry predicted ETA ± confidence. Timetable-only cards are clearly labelled and never presented as live.
            </div>
          </div>

          {liveResults.length > 0 && (
            <section className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold px-1">
                Live network · {liveResults.length}
              </div>
              {liveResults.map((item) => (
                <button
                  key={`live-${item.number}`}
                  onClick={() => chooseLive(item.number)}
                  className={`w-full panel p-3.5 text-left transition-colors ${
                    sel === item.number ? 'border-ir-blue/60' : 'hover:border-ir-blue/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-mono font-bold text-[14px]" style={{ color: item.color }}>{item.number}</span>
                    <span className="text-[13px] flex-1 truncate">{item.name}</span>
                    <span className="chip bg-ok/10 border border-ok/25 text-ok">LIVE ETA</span>
                    <StatusChip t={item} />
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted font-mono">
                    <span>{item.from_code} → {item.to_code}</span>
                    {item.status !== 'arrived' && (
                      <span className="ml-auto">next {item.next_station_code}: {item.eta_next_time} ±{item.eta_range}</span>
                    )}
                  </div>
                </button>
              ))}
            </section>
          )}

          {q.trim().length >= 2 && (
            <section className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">
                  Uploaded timetable catalogue · {catalogLoading ? 'searching…' : `${catalogTotal.toLocaleString('en-IN')} matches`}
                </div>
                {catalogTotal > catalogResults.length && (
                  <span className="text-[9px] text-muted">showing first {catalogResults.length}</span>
                )}
              </div>
              {catalogResults.map((item) => {
                const flagged = !item.route_quality.includes('clean');
                return (
                  <button
                    key={`catalog-${item.number}`}
                    onClick={() => chooseCatalogue(item.number)}
                    className={`w-full panel p-3.5 text-left transition-colors ${
                      catalogSel === item.number ? 'border-ir-blue/60' : 'hover:border-ir-blue/40'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-[14px] text-ir-sky">{item.number}</span>
                      <span className="text-[13px] flex-1 truncate">{item.name}</span>
                      {item.live_demo_available && <span className="chip bg-ok/10 border border-ok/25 text-ok">ALSO LIVE</span>}
                      <span className="chip border border-line bg-ink-800 text-muted">TIMETABLE</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted font-mono">
                      <span>{item.source.code} → {item.destination.code}</span>
                      <span>· {item.type}</span>
                      <span>· {Math.round(item.overall_distance_km || 0).toLocaleString('en-IN')} km</span>
                      <span className="ml-auto flex items-center gap-1">
                        {flagged && <AlertTriangle size={10} className="text-warn" />}
                        {item.scheduled_stop_count} calls
                      </span>
                    </div>
                  </button>
                );
              })}
            </section>
          )}

          {noResults && <div className="text-muted text-sm p-3 panel">No matching live or timetable service.</div>}
        </div>

        <div className="space-y-3">
          {!train && !catalogSel && (
            <div className="panel p-6 text-center text-muted text-[13px]">
              Select a live service for ETA and alerts, or a timetable result for its supplied schedule.
            </div>
          )}

          {catalogSel && (
            <CatalogueDetail
              detail={catalogDetail}
              loading={detailLoading}
              onOpenLive={(number) => chooseLive(number)}
            />
          )}

          {train && (
            <>
              <div className="panel p-4">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono font-extrabold text-lg px-2.5 py-1 rounded-lg border"
                        style={{ borderColor: train.color, color: train.color, background: `${train.color}14` }}>
                    {train.number}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[14px] truncate">{train.name}</div>
                    <div className="text-[11px] text-muted">{train.from_code} → {train.to_code} · {train.ttype}</div>
                  </div>
                  <span className="chip bg-ok/10 border border-ok/25 text-ok">LIVE MODEL</span>
                </div>

                {train.status !== 'arrived' && (
                  <div className="mt-3.5 space-y-3">
                    <div>
                      <div className="text-[11px] text-muted mb-1">
                        Predicted at {train.next_station_name} (sched {fmtAbs(train.sched_next_min)})
                      </div>
                      <EtaBig t={train} size="md" />
                    </div>
                    <CauseBar cause={train.cause} />
                  </div>
                )}
              </div>

              <div className="panel p-4">
                <div className="flex items-center gap-2 text-[13px] font-semibold mb-3">
                  <BellRing size={15} className="text-ir-sky" />
                  Delay alert
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] text-muted">
                    Notify me if delay changes by more than
                    <select
                      value={threshold}
                      onChange={(event) => setThreshold(+event.target.value)}
                      className="mt-1.5 w-full bg-ink-800 border border-line rounded-lg px-3 py-2 text-[13px] text-slate-100 focus:outline-none focus:border-ir-blue/60"
                    >
                      {[5, 10, 15, 30].map((value) => <option key={value} value={value}>{value} minutes</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] text-muted">
                    Phone (mock — no real SMS in prototype)
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      className="mt-1.5 w-full bg-ink-800 border border-line rounded-lg px-3 py-2 text-[13px] font-mono text-slate-100 focus:outline-none focus:border-ir-blue/60"
                    />
                  </label>
                </div>
                <button
                  onClick={setAlert}
                  className="mt-3 w-full bg-ir-blue hover:bg-ir-blue/80 text-white font-semibold text-[13px] rounded-lg py-2.5 transition-colors"
                >
                  Set alert on {train.number}
                </button>
              </div>

              <div className="panel p-4">
                <div className="text-[13px] font-semibold mb-2.5">My alerts</div>
                {alerts.length === 0 && <div className="text-[12px] text-muted italic">No active alerts yet.</div>}
                <div className="space-y-2">
                  {alerts.map((alert) => {
                    const alertTrain = state?.trains.find((item) => item.number === alert.train);
                    return (
                      <div key={alert.id} className={`rounded-lg border p-3 ${alert.status === 'triggered' ? 'border-warn/40 bg-warn/5' : 'border-line bg-ink-800'}`}>
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className="font-mono font-bold">{alert.train}</span>
                          <span className="text-muted">{alertTrain?.name}</span>
                          <span className="chip border bg-ink-850 text-muted border-line ml-auto">Δ &gt; {alert.threshold} min</span>
                          <button onClick={() => delAlert(alert.id)} className="text-muted hover:text-bad">
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <div className={`text-[11px] mt-1.5 ${alert.status === 'triggered' ? 'text-warn' : 'text-muted'}`}>
                          {alert.message}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CatalogueDetail({ detail, loading, onOpenLive }) {
  if (loading) return <div className="panel p-6 text-[12px] text-muted">Loading supplied timetable…</div>;
  if (!detail) return null;
  if (detail.error) return <div className="panel p-5 text-[12px] text-bad">{detail.error}</div>;

  const flagged = !detail.route_quality.includes('clean');
  const duration = detail.duration_min == null
    ? 'not derivable'
    : `${Math.floor(detail.duration_min / 60)}h ${Math.round(detail.duration_min % 60)}m`;

  return (
    <>
      <div className="panel p-4">
        <div className="flex items-center gap-2.5">
          <span className="font-mono font-extrabold text-lg px-2.5 py-1 rounded-lg border border-ir-blue/50 text-ir-sky bg-ir-blue/10">
            {detail.number}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-[14px] truncate">{detail.name}</div>
            <div className="text-[11px] text-muted">{detail.type} · uploaded timetable</div>
          </div>
          <Database size={16} className="text-muted" />
        </div>

        <div className="mt-3 rounded-lg border border-line bg-ink-800 p-3">
          <div className="flex items-center gap-2 text-[12px]">
            <MapPin size={13} className="text-ir-sky" />
            <span className="font-mono text-slate-200">{detail.source.code}</span>
            <span className="text-muted">→</span>
            <span className="font-mono text-slate-200">{detail.destination.code}</span>
            <span className="ml-auto text-muted">{Math.round(detail.overall_distance_km || 0).toLocaleString('en-IN')} km</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-muted">
            <span className="flex items-center gap-1.5"><Clock3 size={11} /> {detail.departure_time || '—'} → {detail.arrival_time || '—'} · {duration}</span>
            <span className="flex items-center gap-1.5 justify-end"><CalendarDays size={11} /> {detail.runs_daily ? 'Daily' : detail.running_days.join(' · ') || 'Days not supplied'}</span>
          </div>
        </div>

        {detail.live_demo_available && (
          <button
            onClick={() => onOpenLive(detail.number)}
            className="mt-3 w-full rounded-lg bg-ir-blue hover:bg-ir-blue/80 py-2.5 text-[12px] font-semibold text-white"
          >
            Open live ETA for {detail.number}
          </button>
        )}
      </div>

      <div className={`panel p-3.5 border ${flagged ? 'border-warn/30' : 'border-ok/20'}`}>
        <div className={`flex items-center gap-2 text-[11px] font-semibold ${flagged ? 'text-warn' : 'text-ok'}`}>
          {flagged ? <AlertTriangle size={13} /> : <Database size={13} />}
          {flagged ? 'Source route normalised with warnings' : 'Source route endpoints validated'}
        </div>
        <div className="text-[10px] text-muted mt-1 leading-relaxed">
          {flagged
            ? detail.route_quality.map((item) => item.replaceAll('_', ' ')).join(' · ')
            : `${detail.raw_route_count} supplied timing points · ${detail.scheduled_stop_count} calling stops`}
          {' · '}part {detail.source_part}
        </div>
        {flagged && (
          <div className="text-[9px] text-muted mt-1.5">
            Raw rows are retained for audit; RailSync does not invent missing endpoints or times.
          </div>
        )}
      </div>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Scheduled calling stops</span>
          <span className="font-mono text-[10px] text-muted">{detail.scheduled_stops.length}</span>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {detail.scheduled_stops.length === 0 && (
            <div className="p-4 text-[11px] text-muted">No reliable calling-stop times were derivable from this part.</div>
          )}
          {detail.scheduled_stops.map((stop, index) => (
            <div key={`${stop.sequence}-${stop.code}`} className="px-4 py-2.5 flex items-center gap-3 border-b border-line/60 last:border-0">
              <span className="w-5 text-[9px] text-muted font-mono">{index + 1}</span>
              <span className="w-14 font-mono font-semibold text-[11px] text-ir-sky">{stop.code}</span>
              <span className="flex-1 min-w-0 text-[11px] text-slate-200 truncate">{stop.name}</span>
              <span className="text-[10px] text-muted font-mono shrink-0">
                D{stop.journey_day} · {stop.arrival_time || 'START'} / {stop.departure_time || 'END'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
