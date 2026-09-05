import { useEffect, useState } from 'react';
import { ShieldCheck, LineChart as LIcon } from 'lucide-react';
import { api } from '../api.js';
import { causeStyle } from '../components/bits.jsx';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell, ScatterChart, Scatter, ZAxis, ReferenceLine,
} from 'recharts';

const TOOLTIP_STYLE = { background: '#0c1226', border: '1px solid #1c2951', borderRadius: 8, fontSize: 12 };

/**
 * Historical analytics + the "no 99% claims" page:
 * the model's measured error, what drives delays, 60-day trends, and
 * predicted-vs-actual evidence from live runs.
 */
export default function AnalyticsPage({ state }) {
  const [model, setModel] = useState(null);
  const [trends, setTrends] = useState(null);
  const [acc, setAcc] = useState(null);

  useEffect(() => {
    api.get('/api/analytics/model').then(setModel).catch(() => {});
    api.get('/api/analytics/trends').then(setTrends).catch(() => {});
    api.get('/api/accuracy').then(setAcc).catch(() => {});
  }, []);

  const trainColors = state ? Object.fromEntries(state.trains.map((t) => [t.number, t.color])) : {};

  return (
    <div className="p-5 space-y-4 max-w-[1400px] mx-auto">
      {/* honest model card */}
      <div className="panel p-5 border-ir-blue/30">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-ir-blue/15 border border-ir-blue/40 flex items-center justify-center">
              <ShieldCheck size={22} className="text-ir-sky" />
            </div>
            <div>
              <div className="font-semibold text-[15px]">Explainable model, measured error</div>
              <div className="text-[12px] text-muted max-w-xl leading-relaxed">
                We report the error we <span className="text-slate-200">actually measured</span> on a 10-day
                holdout of per-leg delay records — not a claimed accuracy. ETAs always carry a confidence
                range, and the baseline schedule is the fallback when live data goes stale.
              </div>
            </div>
          </div>
          {model && (
            <div className="flex gap-8 ml-auto">
              <Metric label="MAE (legs)" value={`${model.mae_minutes} min`} accent />
              <Metric label="RMSE" value={`${model.rmse_minutes} min`} />
              <Metric label="R²" value={model.r2} />
              <Metric label="Training legs" value={model.n_samples} />
              <Metric label="Holdout" value={`${model.holdout[0].slice(5)} → ${model.holdout[1].slice(5)}`} />
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* 60-day trends */}
        <div className="panel p-4">
          <div className="text-[13px] font-semibold mb-1 flex items-center gap-2">
            <LIcon size={15} className="text-ir-sky" /> Avg delay per day, per service (60 days)
          </div>
          <div className="text-[11px] text-muted mb-3">Historical seed data, calibrated to realistic IR delay distributions.</div>
          <div className="h-[280px]">
            {trends && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trends.days}>
                  <CartesianGrid stroke="#1c2951" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" unit="m" width={42} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#e8ecff' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {trends.days.length > 0 &&
                    Object.keys(trends.days[0])
                      .filter((k) => k !== 'date')
                      .map((num) => (
                        <Line key={num} type="monotone" dataKey={num} stroke={trainColors[num] || '#8fa5ff'}
                              strokeWidth={1.8} dot={false} isAnimationActive={false} />
                      ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* by hour */}
        <div className="panel p-4">
          <div className="text-[13px] font-semibold mb-1">Average delay by departure hour</div>
          <div className="text-[11px] text-muted mb-3">Rush-hour windows (07–10, 16–21) run slower — the model learns this pattern.</div>
          <div className="h-[280px]">
            {trends && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends.by_hour}>
                  <CartesianGrid stroke="#1c2951" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" />
                  <YAxis tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" unit="m" width={42} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} min`, 'avg delay']} labelFormatter={(h) => `${h}:00`} />
                  <Bar dataKey="avg_delay" radius={[3, 3, 0, 0]}>
                    {trends.by_hour.map((h, i) => (
                      <Cell key={i} fill={(h.hour >= 7 && h.hour < 10) || (h.hour >= 16 && h.hour < 21) ? '#ffc233' : '#4f6ef7'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* feature importance */}
        <div className="panel p-4">
          <div className="text-[13px] font-semibold mb-1">What the predictor weighs</div>
          <div className="text-[11px] text-muted mb-3">RandomForest feature importance (residual model).</div>
          {model && (
            <div className="space-y-2.5">
              {Object.entries(model.feature_importance).map(([name, v]) => (
                <div key={name}>
                  <div className="flex justify-between text-[11.5px] mb-1">
                    <span className="text-slate-200">{name.replace('_', ' ')}</span>
                    <span className="font-mono text-muted">{(v * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-ink-800 overflow-hidden">
                    <div className="h-full bg-ir-sky rounded-full" style={{ width: `${v * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* explainer coefficients */}
        <div className="panel p-4">
          <div className="text-[13px] font-semibold mb-1">Cause coefficients (published)</div>
          <div className="text-[11px] text-muted mb-3">
            Linear explainer: fraction of scheduled leg-time added per unit of cause — leg-length independent,
            so the same numbers explain every section.
          </div>
          {model && (
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted">
                  <th className="text-left font-semibold pb-2">Cause</th>
                  <th className="text-right font-semibold pb-2">Coefficient</th>
                  <th className="text-left font-semibold pl-4 pb-2">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(model.cause_coefficients).map(([name, v]) => (
                  <tr key={name} className="border-t border-line/50">
                    <td className="py-1.5 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-sm" style={{ background: causeStyle(name).color }} />
                      {causeStyle(name).label}
                    </td>
                    <td className="text-right font-mono text-slate-200">{v > 0 ? '+' : ''}{v}</td>
                    <td className="text-left pl-4 text-[11px] text-muted">{COEF_MEANING[name] || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* predicted vs actual scatter */}
        <div className="panel p-4">
          <div className="text-[13px] font-semibold mb-1">Predicted vs actual (live runs)</div>
          <div className="text-[11px] text-muted mb-3">
            Every arrival the sim completes is logged against the last model prediction. Aim near the diagonal.
          </div>
          <div className="h-[240px]">
            {acc && acc.points.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid stroke="#1c2951" strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="predicted" name="Predicted" tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" domain={['dataMin - 10', 'dataMax + 10']} />
                  <YAxis type="number" dataKey="actual" name="Actual" tick={{ fill: '#8b96c2', fontSize: 10 }} stroke="#1c2951" domain={['dataMin - 10', 'dataMax + 10']} width={48} />
                  <ZAxis range={[40, 40]} />
                  <ReferenceLine
                    segment={[
                      { x: Math.min(...acc.points.map((p) => p.predicted)) - 10, y: Math.min(...acc.points.map((p) => p.actual)) - 10 },
                      { x: Math.max(...acc.points.map((p) => p.predicted)) + 10, y: Math.max(...acc.points.map((p) => p.actual)) + 10 },
                    ]}
                    stroke="#4f6ef7" strokeDasharray="5 4"
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [Math.round(v * 10) / 10, n]} />
                  <Scatter data={acc.points} fill="#8fa5ff" isAnimationActive={false} />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted text-[12px]">No arrivals logged yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-muted pb-2">
        Data note: historical records are seeded with a documented delay process calibrated to realistic IR
        distributions. Swap in real NTES/Kaggle delay data via <span className="font-mono text-slate-300">scripts/import_real.py</span> —
        the feature schema is the contract.
      </div>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      <div className={`font-mono text-lg font-bold mt-0.5 ${accent ? 'text-ir-sky' : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

const COEF_MEANING = {
  weather: 'per +1.0 severity (storm)',
  signal: 'per minute of hold',
  congestion: 'per +1.0 section load',
  dwell: 'per min extra dwell',
  carry: 'per min carried delay',
  low_priority: 'per +0.1 lower priority',
  rush: 'peak-hour window',
};
