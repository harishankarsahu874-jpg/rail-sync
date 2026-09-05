import { Gauge } from 'lucide-react';

/** green/yellow/red delay chip used across the app */
export function StatusChip({ t, showArrived = true }) {
  const d = t.delay;
  const cls =
    t.status === 'arrived'
      ? 'bg-ink-800 text-muted border-line'
      : d < 5
        ? 'bg-ok/10 text-ok border-ok/30'
        : d < 15
          ? 'bg-warn/10 text-warn border-warn/30'
          : d < 30
            ? 'bg-bad/10 text-bad border-bad/30'
            : 'bg-[#ff2d55]/10 text-[#ff2d55] border-[#ff2d55]/40';
  const label =
    t.status === 'arrived'
      ? 'ARRIVED'
      : t.at_station
        ? 'AT STATION'
        : d < 5
          ? 'ON TIME'
          : `+${Math.round(d)} MIN`;
  return <span className={`chip border ${cls} ${t.status === 'severe' ? 'animate-flash-row' : ''}`}>{label}</span>;
}

const CAUSE_STYLE = {
  weather: { label: 'Weather', color: '#5aa2ff' },
  congestion: { label: 'Congestion', color: '#ffc233' },
  signal: { label: 'Signal wait', color: '#ff5c5c' },
  dwell: { label: 'Station dwell', color: '#b48cff' },
  carry: { label: 'Carry-over', color: '#ff8fab' },
  low_priority: { label: 'Priority hold', color: '#9aa5c9' },
  rush: { label: 'Rush hour', color: '#67e8f9' },
  other: { label: 'Other', color: '#4b5878' },
};

export function causeStyle(cause) {
  return CAUSE_STYLE[cause] || CAUSE_STYLE.other;
}

/** stacked horizontal bar: the explainable delay-cause breakdown */
export function CauseBar({ cause, compact = false }) {
  if (!cause || cause.length === 0) {
    return (
      <div className="text-[11px] text-muted italic">
        No significant delay on this section right now
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-800 border border-line">
        {cause.map((c) => (
          <div
            key={c.cause}
            style={{ width: `${Math.max(2, c.pct)}%`, background: causeStyle(c.cause).color }}
            title={`${causeStyle(c.cause).label}: ${c.pct}% (${c.minutes} min)`}
          />
        ))}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {cause.map((c) => (
            <span key={c.cause} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="w-2 h-2 rounded-sm" style={{ background: causeStyle(c.cause).color }} />
              {causeStyle(c.cause).label}
              <span className="font-mono text-slate-300">{c.pct}%</span>
              <span className="font-mono">· {c.minutes}m</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function KpiCard({ label, value, sub, tone = 'default', icon: Icon }) {
  const toneCls =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-slate-100';
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</div>
        {Icon && <Icon size={15} className="text-muted/70" />}
      </div>
      <div className={`kpi-num mt-1.5 ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

/** big ETA readout: "14:41 ± 6 min" with source tag */
export function EtaBig({ t, size = 'lg' }) {
  if (t.status === 'arrived') {
    return <div className="text-muted text-sm">Arrived at destination</div>;
  }
  const sz = size === 'lg' ? 'text-3xl' : 'text-xl';
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className={`font-mono font-bold ${sz} tracking-tight`}>{t.eta_next_time}</span>
      <span className="font-mono text-muted text-sm">± {t.eta_range} min</span>
      <span
        className={`chip border ${
          t.eta_source === 'model'
            ? 'bg-ir-blue/10 text-ir-sky border-ir-blue/30'
            : 'bg-warn/10 text-warn border-warn/30'
        }`}
        title={t.eta_source === 'model' ? 'Live model ETA' : 'Feed stale — using historical route averages'}
      >
        {t.eta_source === 'model' ? 'MODEL' : 'HIST AVG'}
      </span>
    </div>
  );
}

export function SpeedGauge({ speed, max = 130 }) {
  const pct = Math.min(100, (speed / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <Gauge size={14} className="text-muted" />
      <div className="flex-1 h-1.5 rounded-full bg-ink-800 overflow-hidden">
        <div className="h-full rounded-full bg-ir-sky" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[12px] text-slate-200 w-14 text-right">{speed} km/h</span>
    </div>
  );
}
