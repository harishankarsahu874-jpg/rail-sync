import { useEffect, useState } from 'react';
import { Radio, WifiOff, Clock, Satellite, Database } from 'lucide-react';

/**
 * Top bar: page title, simulated IST clock, and the data-freshness pill.
 * The pill is the "data freshness indicator" from the spec: LIVE when the
 * feed is < stale_after old, STALE (with seconds) when it isn't — in which
 * case the ETA engine has switched to historical averages.
 */
export default function TopBar({ state, mode, title }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!state) {
    return (
      <header className="h-14 flex-none border-b border-line bg-ink-900 flex items-center px-6">
        <span className="text-sm text-muted">Connecting to RailSync feed…</span>
      </header>
    );
  }

  const age = Math.max(0, Math.round(now / 1000 - state.meta.last_update));
  const stale = age > state.meta.stale_after;

  return (
    <header className="h-14 flex-none border-b border-line bg-ink-900 flex items-center gap-4 px-6">
      <h1 className="text-[15px] font-semibold flex-1">{title}</h1>

      <div className="flex items-center gap-2 text-[12px] text-muted">
        <Clock size={14} />
        <span className="font-mono text-slate-200">{state.meta.clock_iso}</span>
        <span className="chip bg-ink-800 border border-line text-muted">SIM ×{state.meta.sim_speed}</span>
        <span className={`chip border ${state.providers?.mode === 'hybrid' ? 'bg-ok/10 text-ok border-ok/30' : 'bg-ink-800 text-muted border-line'}`} title="External provider mode; fallbacks remain available">
          {state.providers?.mode === 'hybrid' ? <Satellite size={11} /> : <Database size={11} />}
          {state.providers?.mode === 'hybrid' ? `APIs ${state.providers.active_real}/5` : 'DEMO DATA'}
        </span>
        {state.meta.paused && <span className="chip bg-warn/15 text-warn border border-warn/30">FEED PAUSED</span>}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`chip border ${
            stale
              ? 'bg-warn/15 text-warn border-warn/40'
              : 'bg-ok/10 text-ok border-ok/30'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${stale ? 'bg-warn animate-pulse-dot-warn' : 'bg-ok animate-pulse-dot'}`} />
          {stale ? `STALE ${age}s — historical fallback` : `LIVE ${age}s`}
        </span>
        <span
          className={`chip border ${
            mode === 'ws'
              ? 'bg-ir-blue/10 text-ir-sky border-ir-blue/30'
              : 'bg-ink-800 text-muted border-line'
          }`}
          title="Transport: WebSocket push, with REST polling fallback"
        >
          {mode === 'ws' ? <Radio size={12} /> : <WifiOff size={12} />}
          {mode === 'ws' ? 'WS' : mode === 'poll' ? 'POLL' : '…'}
        </span>
      </div>
    </header>
  );
}
