import { NavLink } from 'react-router-dom';
import { BarChart3, Gauge, House, Landmark, Map, TrainFront, UserSearch } from 'lucide-react';

const NAV = [
  { to: '/', label: 'Public Home', icon: House },
  { to: '/network', label: 'Live Network', icon: Map },
  { to: '/stations', label: 'Station Boards', icon: Landmark },
  { to: '/passengers', label: 'Passengers', icon: UserSearch },
  { to: '/control', label: 'Control Room', icon: Gauge },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
];

export default function Sidebar({ state }) {
  const delayed = state ? state.trains.filter((train) => train.delay >= 5 && train.status !== 'arrived').length : 0;
  return (
    <aside className="flex w-[232px] flex-none flex-col border-r border-line bg-ink-900">
      <NavLink to="/" className="border-b border-line px-5 pb-4 pt-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-ir-blue/40 bg-ir-blue/15">
            <TrainFront size={19} className="text-ir-sky" />
          </div>
          <div>
            <div className="text-[17px] font-extrabold leading-none tracking-tight">
              Rail<span className="text-ir-sky">Sync</span>
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted">Coach-train intelligence</div>
          </div>
        </div>
      </NavLink>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px] font-medium transition-colors ${
                isActive
                  ? 'border-ir-blue/30 bg-ir-blue/15 text-ir-sky'
                  : 'border-transparent text-muted hover:bg-ink-800 hover:text-slate-100'
              }`
            }
          >
            <Icon size={16} />
            <span className="flex-1">{label}</span>
            {to === '/network' && delayed > 0 && (
              <span className="chip border border-bad/30 bg-bad/15 text-bad">{delayed}</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 border-t border-line px-4 py-4">
        {state && (
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>Model MAE (measured)</span>
            <span className="font-mono text-ir-sky">{state.meta.mae} min</span>
          </div>
        )}
        <div className="text-[10px] leading-relaxed text-muted/70">
          SIH 2026 prototype · simulation fallback · 15&nbsp;sec cadence
        </div>
      </div>
    </aside>
  );
}
