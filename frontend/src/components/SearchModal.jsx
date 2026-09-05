import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Clock3, Database, LoaderCircle, Radio, Search, TrainFront, X,
} from 'lucide-react';
import { api } from '../api.js';

function matchesLive(train, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const route = (train.stations || []).map((stop) => `${stop.code} ${stop.name}`).join(' ');
  return [
    train.number, train.name, train.from_code, train.from_name,
    train.to_code, train.to_name, route,
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}

function liveResult(train) {
  return {
    number: train.number,
    name: train.name,
    from: train.from_code,
    to: train.to_code,
    type: train.ttype,
    kind: 'live',
    delay: train.delay,
  };
}

function catalogueResult(train) {
  return {
    number: train.number,
    name: train.name,
    from: train.source?.code || '—',
    to: train.destination?.code || '—',
    type: train.type,
    kind: train.live_demo_available ? 'live' : 'timetable',
    calls: train.scheduled_stop_count,
    quality: train.route_quality,
  };
}

export default function SearchModal({
  open,
  onClose,
  onSelect,
  liveTrains = [],
  initialQuery = '',
}) {
  const [query, setQuery] = useState('');
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setQuery(initialQuery || '');
    setCatalogue([]);
    setError('');
    setActiveIndex(0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 40);
    const escape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', escape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', escape);
      document.body.style.overflow = '';
    };
  }, [open, initialQuery, onClose]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setCatalogue([]);
      setLoading(false);
      setError('');
      return undefined;
    }
    let current = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      api.get(`/api/catalog/trains?q=${encodeURIComponent(query.trim())}&limit=12`)
        .then((payload) => {
          if (current) setCatalogue((payload.trains || []).map(catalogueResult));
        })
        .catch((requestError) => {
          if (current) {
            setCatalogue([]);
            setError(requestError.message || 'Catalogue search is unavailable');
          }
        })
        .finally(() => current && setLoading(false));
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const results = useMemo(() => {
    const live = liveTrains.filter((train) => matchesLive(train, query)).map(liveResult);
    const merged = [...live];
    const seen = new Set(live.map((train) => train.number));
    catalogue.forEach((train) => {
      if (!seen.has(train.number)) {
        merged.push(train);
        seen.add(train.number);
      }
    });
    return merged;
  }, [liveTrains, catalogue, query]);

  useEffect(() => setActiveIndex(0), [query]);

  if (!open) return null;

  const choose = (train) => {
    if (!train) return;
    onSelect(train);
  };

  const keyDown = (event) => {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/45 px-4 pt-[9vh] backdrop-blur-sm"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
    >
      <section
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,.28)]"
        role="dialog"
        aria-modal="true"
        aria-label="Search trains"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Search size={19} />
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={keyDown}
            placeholder="Train number, name, origin or route station"
            className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400"
            aria-label="Search train number, name or route"
          />
          {loading && <LoaderCircle size={17} className="animate-spin text-teal-600" />}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close search"
          >
            <X size={19} />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-2 text-[11px] text-slate-500">
          <span>{query.trim() ? 'Live services and uploaded timetable matches' : 'Live demo services'}</span>
          <span className="hidden items-center gap-1 sm:flex">
            <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5">↑</kbd>
            <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5">↓</kbd>
            to move · <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5">Enter</kbd> to open
          </span>
        </div>

        <div className="max-h-[58vh] overflow-y-auto p-2">
          {results.map((train, index) => {
            const isLive = train.kind === 'live';
            return (
              <button
                type="button"
                key={`${train.kind}-${train.number}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(train)}
                className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                  activeIndex === index ? 'bg-teal-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  isLive ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {isLive ? <TrainFront size={18} /> : <Database size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-sm font-bold text-slate-900">{train.number}</span>
                    <span className="truncate text-sm font-semibold text-slate-800">{train.name}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                    <span>{train.from} → {train.to}</span>
                    {train.type && <span>· {train.type}</span>}
                    {train.calls != null && <span>· {train.calls} calls</span>}
                  </div>
                </div>
                <span className={`hidden shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold sm:inline-flex ${
                  isLive ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-600'
                }`}>
                  {isLive ? <Radio size={10} /> : <Clock3 size={10} />}
                  {isLive ? 'LIVE DEMO' : 'TIMETABLE'}
                </span>
                <ArrowRight size={16} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-teal-600" />
              </button>
            );
          })}

          {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
            <div className="px-5 py-10 text-center">
              <TrainFront size={24} className="mx-auto text-slate-300" />
              <div className="mt-2 text-sm font-medium text-slate-700">No train matched “{query.trim()}”</div>
              <div className="mt-1 text-xs text-slate-400">Try a train number, station code, city, or service name.</div>
            </div>
          )}
          {error && (
            <div className="m-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Timetable search is temporarily unavailable. Live demo services remain selectable.
            </div>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
          <Database size={12} />
          Static timetable results are labelled separately and never presented as live telemetry.
        </footer>
      </section>
    </div>
  );
}
