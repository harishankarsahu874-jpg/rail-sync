import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Clock3, Command, Database, Gauge, History,
  Landmark, Map, Radio, Search, ShieldCheck, TrainFront, Trash2,
} from 'lucide-react';
import SearchModal from '../components/SearchModal.jsx';
import { useLocalList } from '../hooks/useLocalList.js';

const FALLBACK_TRAINS = [
  { number: '12301', name: 'Howrah Rajdhani', from_code: 'HWH', to_code: 'NDLS', ttype: 'Rajdhani', delay: 0 },
  { number: '12951', name: 'Mumbai Tejas Rajdhani', from_code: 'MMCT', to_code: 'NDLS', ttype: 'Rajdhani', delay: 0 },
  { number: '12621', name: 'Tamil Nadu Express', from_code: 'MAS', to_code: 'NDLS', ttype: 'Superfast', delay: 0 },
  { number: '12841', name: 'Coromandel Express', from_code: 'HWH', to_code: 'MAS', ttype: 'Superfast', delay: 0 },
  { number: '12953', name: 'August Kranti Tejas Rajdhani', from_code: 'MMCT', to_code: 'NZM', ttype: 'Rajdhani', delay: 0 },
  { number: '12303', name: 'Poorva Express', from_code: 'HWH', to_code: 'NDLS', ttype: 'Mail', delay: 0 },
];

const EXAMPLES = ['12951 Rajdhani', 'Howrah', 'Kerala Express'];

export default function LandingPage({ state, mode }) {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState('');
  const recent = useLocalList('railsync.recent-trains', 7);

  const liveTrains = state?.trains || [];
  const cards = liveTrains.length ? liveTrains : FALLBACK_TRAINS;
  const catalogueCount = state?.meta?.train_catalogue?.trains;
  const measuredMae = state?.meta?.mae;
  const realProvider = state?.providers?.mode === 'hybrid';

  const openSearch = useCallback((query = '') => {
    setInitialQuery(query);
    setSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);

  useEffect(() => {
    const shortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [openSearch]);

  const liveNumbers = useMemo(() => new Set(cards.map((train) => train.number)), [cards]);

  const select = (train) => {
    const live = train.kind === 'live' || liveNumbers.has(train.number);
    const item = { ...train, kind: live ? 'live' : 'timetable' };
    recent.add(item);
    setSearchOpen(false);
    navigate(live
      ? `/live/${encodeURIComponent(train.number)}`
      : `/passengers?train=${encodeURIComponent(train.number)}`);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-white text-slate-900">
      <header className="relative z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-5 px-5 lg:px-8">
          <button type="button" onClick={() => navigate('/')} className="flex items-center gap-2.5" aria-label="RailSync home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm shadow-teal-600/25">
              <TrainFront size={21} />
            </span>
            <span className="text-xl font-extrabold tracking-tight">Rail<span className="text-teal-600">Sync</span></span>
          </button>

          <nav className="ml-8 hidden items-center gap-1 lg:flex">
            <NavButton icon={Map} label="Live network" onClick={() => navigate('/network')} />
            <NavButton icon={Landmark} label="Station boards" onClick={() => navigate('/stations')} />
            <NavButton icon={BarChart3} label="Model trust" onClick={() => navigate('/analytics')} />
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => openSearch()}
              className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-500 shadow-sm transition hover:border-teal-200 hover:text-teal-700 sm:flex"
            >
              <Search size={15} /> Search
              <kbd className="ml-1 flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                <Command size={10} />K
              </kbd>
            </button>
            <button
              type="button"
              onClick={() => openSearch()}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-600/20 transition hover:bg-teal-700"
            >
              <Radio size={15} /> Track a train
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative border-b border-slate-100">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <div className="absolute left-1/2 top-10 h-[480px] w-[780px] -translate-x-1/2 rounded-full bg-teal-50/80 blur-3xl" />
            <div className="rail-lines absolute inset-x-0 bottom-0 h-36 opacity-50" />
          </div>

          <div className="relative mx-auto max-w-5xl px-5 pb-16 pt-16 text-center sm:pt-20 lg:pb-20">
            <div className={`mx-auto inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-bold tracking-[.12em] ${
              realProvider
                ? 'border-teal-200 bg-teal-50 text-teal-800'
                : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}>
              <span className={`h-2 w-2 rounded-full ${realProvider ? 'animate-pulse bg-teal-500' : 'bg-amber-500'}`} />
              {realProvider ? 'HYBRID LIVE PROVIDERS' : 'SIMULATION FALLBACK · DEMO MODE'}
            </div>

            <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-[-.04em] text-slate-950 sm:text-6xl lg:text-[68px]">
              Find any train.<br />
              <span className="text-teal-600">Understand every delay.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-slate-500 sm:text-lg">
              Search the uploaded Indian coaching timetable, then follow active demo services with
              route maps, changing conditions, and explainable ETA predictions.
            </p>

            <button
              type="button"
              onClick={() => openSearch()}
              className="group mx-auto mt-9 flex w-full max-w-2xl items-center gap-3 rounded-2xl border-2 border-teal-100 bg-white px-5 py-4 text-left shadow-[0_16px_50px_rgba(13,148,136,.12)] transition hover:border-teal-300 hover:shadow-[0_20px_60px_rgba(13,148,136,.18)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                <Search size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-800">Search train number, name or route station</span>
                <span className="block truncate text-xs text-slate-400">e.g. 12951, Rajdhani, Howrah, HWH</span>
              </span>
              <span className="hidden items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500 sm:flex">
                <Command size={11} /> K
              </span>
              <ArrowRight size={18} className="text-teal-500 transition group-hover:translate-x-1" />
            </button>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
              <span className="text-slate-400">Try:</span>
              {EXAMPLES.map((example) => (
                <button
                  type="button"
                  key={example}
                  onClick={() => openSearch(example)}
                  className="rounded-full bg-teal-50 px-3 py-1.5 font-medium text-teal-700 transition hover:bg-teal-100"
                >
                  {example}
                </button>
              ))}
            </div>

            <div className="mx-auto mt-10 grid max-w-3xl grid-cols-3 divide-x divide-slate-200 rounded-2xl border border-slate-200 bg-white/80 px-2 py-4 shadow-sm backdrop-blur">
              <HeroStat icon={Database} value={catalogueCount ? catalogueCount.toLocaleString('en-IN') : '5,208'} label="timetable trains" />
              <HeroStat icon={Gauge} value={measuredMae != null ? `${measuredMae} min` : 'measured'} label="model MAE" />
              <HeroStat icon={Clock3} value="15 sec" label={mode === 'ws' ? 'WebSocket cadence' : 'refresh cadence'} />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[.16em] text-teal-700">Ready to explore</div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Active long-distance services</h2>
              <p className="mt-1 text-sm text-slate-500">These six services have changing position and ETA state in the prototype.</p>
            </div>
            <button type="button" onClick={() => navigate('/network')} className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 hover:text-teal-900">
              Open network map <ArrowRight size={15} />
            </button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((train) => (
              <button
                type="button"
                key={train.number}
                onClick={() => select({
                  number: train.number,
                  name: train.name,
                  from: train.from_code,
                  to: train.to_code,
                  kind: 'live',
                })}
                className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-lg hover:shadow-teal-900/5"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 transition group-hover:bg-teal-600 group-hover:text-white">
                    <TrainFront size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-slate-900">{train.number}</span>
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[9px] font-bold text-teal-700">ACTIVE DEMO</span>
                    </span>
                    <span className="mt-1 block truncate text-sm font-semibold text-slate-700">{train.name}</span>
                    <span className="mt-1 block text-xs text-slate-400">{train.from_code} → {train.to_code} · {train.ttype}</span>
                  </span>
                  <ArrowRight size={16} className="mt-3 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600" />
                </div>
              </button>
            ))}
          </div>

          {recent.items.length > 0 && (
            <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <History size={16} className="text-teal-700" /> Recent searches
                </div>
                <button type="button" onClick={recent.clear} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700">
                  <Trash2 size={12} /> Clear history
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {recent.items.map((train) => (
                  <span key={train.number} className="inline-flex items-center rounded-full border border-slate-200 bg-white py-1.5 pl-3 pr-1.5 text-xs shadow-sm">
                    <button type="button" onClick={() => select(train)} className="font-medium text-slate-700 hover:text-teal-700">
                      <span className="font-mono font-bold">{train.number}</span> {train.name}
                    </button>
                    <button type="button" onClick={() => recent.remove(train.number)} className="ml-2 rounded-full p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label={`Remove ${train.number} from history`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}
        </section>

        <section className="border-y border-slate-100 bg-slate-50">
          <div className="mx-auto grid max-w-7xl gap-4 px-5 py-9 md:grid-cols-3 lg:px-8">
            <TrustPoint icon={ShieldCheck} title="Honest model evidence" body="Measured error in minutes, a confidence range on every live ETA, and a published cause breakdown." />
            <TrustPoint icon={Database} title="Timetable is not telemetry" body="All uploaded schedule records carry provenance and are kept visibly separate from the six active services." />
            <TrustPoint icon={Radio} title="Fallback by design" body="WebSocket delivery falls back to REST polling; stale telemetry switches ETA presentation to historical estimates." />
          </div>
        </section>
      </main>

      <footer className="bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-7 text-xs text-slate-400 sm:flex-row sm:items-center lg:px-8">
          <div className="flex items-center gap-2 font-semibold text-slate-600"><TrainFront size={14} className="text-teal-600" /> RailSync · SIH prototype</div>
          <span className="sm:ml-auto">Simulation fallback is visibly labelled. No accuracy percentage is claimed.</span>
        </div>
      </footer>

      <SearchModal
        open={searchOpen}
        onClose={closeSearch}
        onSelect={select}
        liveTrains={liveTrains}
        initialQuery={initialQuery}
      />
    </div>
  );
}

function NavButton({ icon: Icon, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-teal-700">
      <Icon size={15} /> {label}
    </button>
  );
}

function HeroStat({ icon: Icon, value, label }) {
  return (
    <div className="px-2 text-center sm:px-5">
      <div className="flex items-center justify-center gap-1.5 text-base font-extrabold text-slate-900 sm:text-xl">
        <Icon size={15} className="hidden text-teal-600 sm:block" /> {value}
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-400 sm:text-[10px]">{label}</div>
    </div>
  );
}

function TrustPoint({ icon: Icon, title, body }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700"><Icon size={17} /></span>
      <span>
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{body}</span>
      </span>
    </div>
  );
}
