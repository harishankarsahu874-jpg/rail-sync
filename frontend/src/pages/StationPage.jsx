import { useEffect, useMemo, useState } from 'react';
import { Database, Landmark, MapPin, Search, WifiOff } from 'lucide-react';
import { api } from '../api.js';

const QUICK_STOPS = ['NDLS', 'HWH', 'MMCT', 'MAS', 'NZM', 'BZA', 'BPL', 'CNB', 'DDU', 'PRYJ', 'KOTA', 'BBS', 'VSKP', 'NGP'];

/**
 * Searchable station display board. The catalogue search covers all 8,990
 * user-supplied records; only the handful of demo-route stops ride inside the
 * 15-second live snapshot.
 */
export default function StationPage({ state }) {
  const [code, setCode] = useState('NDLS');
  const [board, setBoard] = useState(null);
  const [err, setErr] = useState(null);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);

  const majors = useMemo(() => {
    if (!state) return [];
    const byCode = new Map(state.stations.map((station) => [station.code, station]));
    return QUICK_STOPS.map((stationCode) => byCode.get(stationCode)).filter(Boolean);
  }, [state]);
  const catalogue = state?.meta?.station_catalogue;

  useEffect(() => {
    let live = true;
    api.get(`/api/stations/${encodeURIComponent(code)}/board`)
      .then((result) => live && (setBoard(result), setErr(null)))
      .catch((error) => live && setErr(error.message));
    return () => { live = false; };
  }, [code, state?.meta?.tick]);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) {
      setMatches([]);
      setSearching(false);
      return undefined;
    }
    let live = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api.get(`/api/stations?q=${encodeURIComponent(needle)}&limit=8`)
        .then((result) => {
          if (live) setMatches(result.stations || []);
        })
        .catch(() => live && setMatches([]))
        .finally(() => live && setSearching(false));
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const choose = (station) => {
    setCode(station.code);
    setQuery('');
    setMatches([]);
  };

  return (
    <div className="p-5 max-w-5xl mx-auto space-y-4">
      <section className="panel p-4 relative z-20">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          <div className="flex-1">
            <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">
              Find any Indian railway station
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && matches[0]) choose(matches[0]);
                  if (event.key === 'Escape') { setQuery(''); setMatches([]); }
                }}
                placeholder="Search code, station, state or address — e.g. DDU, Howrah, Rajasthan"
                className="w-full bg-ink-800 border border-line rounded-lg pl-9 pr-20 py-2.5 text-[13px] placeholder:text-muted/60 focus:outline-none focus:border-ir-blue/60"
                aria-label="Search station catalogue"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted font-mono">
                {searching ? 'SEARCHING' : 'ENTER'}
              </span>
            </div>

            {query.trim() && (
              <div className="absolute left-4 right-4 md:right-auto md:w-[610px] top-[78px] rounded-xl border border-line bg-ink-900 shadow-2xl overflow-hidden">
                {matches.length === 0 && !searching && (
                  <div className="px-4 py-4 text-[12px] text-muted">No station matches that search.</div>
                )}
                {matches.map((station) => (
                  <button
                    key={station.code}
                    onClick={() => choose(station)}
                    className="w-full px-3.5 py-2.5 flex items-center gap-3 text-left border-b border-line/70 last:border-0 hover:bg-ink-800 transition-colors"
                  >
                    <span className="w-16 shrink-0 font-mono font-bold text-ir-sky text-[13px]">
                      {station.code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-slate-100 truncate">{station.name}</span>
                      <span className="block text-[10px] text-muted truncate">
                        {[station.state, station.zone, station.address].filter(Boolean).join(' · ') || 'Metadata not supplied'}
                      </span>
                    </span>
                    <span className={`text-[9px] font-mono ${station.coordinate_valid ? 'text-ok' : 'text-warn'}`}>
                      {station.coordinate_valid ? 'MAPPED' : 'NO COORD'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {catalogue && (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2.5 shrink-0">
              <Database size={15} className="text-ir-sky" />
              <div>
                <div className="text-[11px] font-mono text-slate-200">
                  {catalogue.source_records.toLocaleString('en-IN')} source records
                </div>
                <div className="text-[9px] text-muted">
                  {catalogue.valid_coordinates.toLocaleString('en-IN')} mapped · user catalogue
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-2">
          Demo route stops
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {majors.map((station) => (
            <button
              key={station.code}
              onClick={() => choose(station)}
              title={station.name}
              className={`chip border transition-colors ${
                code === station.code
                  ? 'bg-ir-blue/20 text-ir-sky border-ir-blue/50'
                  : 'bg-ink-850 text-muted border-line hover:text-slate-200'
              }`}
            >
              <Landmark size={12} />
              {station.code}
            </button>
          ))}
        </div>
      </section>

      {!board && !err && <div className="text-muted text-sm">Loading board…</div>}
      {err && <div className="text-bad text-sm">Board error: {err}</div>}

      {board && (
        <>
          <div className="rounded-2xl overflow-hidden border border-zinc-800 bg-black shadow-[0_0_60px_rgba(255,210,63,0.06)]">
            <div className="flex items-center justify-between gap-4 px-5 py-3 bg-[#101010] border-b border-zinc-800">
              <div className="font-mono text-board text-[17px] tracking-[0.15em] led truncate">
                {board.station.name.toUpperCase()}
                <span className="text-zinc-500 ml-3 tracking-normal text-[12px]">
                  ({board.station.code} · {board.station.state || board.station.zone || 'INDIA'})
                </span>
              </div>
              <div className="font-mono text-board text-[17px] led shrink-0">{board.clock}</div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[690px] font-mono text-[15px]">
                <thead>
                  <tr className="text-zinc-600 text-[11px] tracking-[0.25em]">
                    <th className="text-left font-medium px-5 py-2">EXPECTED</th>
                    <th className="text-left font-medium">TRAIN</th>
                    <th className="text-left font-medium">NO.</th>
                    <th className="text-left font-medium w-16">PLT</th>
                    <th className="text-right font-medium pr-6">STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-zinc-600 text-[12px] tracking-widest">
                        {board.served_by_demo
                          ? 'NO FURTHER ARRIVALS THIS TRIP WINDOW'
                          : 'CATALOGUE STATION — NO DEMO SERVICE ON THIS ROUTE'}
                      </td>
                    </tr>
                  )}
                  {board.rows.map((row) => {
                    const tone =
                      row.status === 'BOARDING'
                        ? 'text-[#4dd7ff]'
                        : row.status.startsWith('EARLY') || row.status === 'ON TIME'
                          ? 'text-[#39d98a]'
                          : row.delay >= 15
                            ? 'text-[#ff5c5c]'
                            : 'text-board';
                    return (
                      <tr key={`${row.number}-${row.time}`} className="border-t border-zinc-900 hover:bg-zinc-900/40">
                        <td className={`px-5 py-2.5 led ${tone}`}>{row.time}</td>
                        <td className={`py-2.5 truncate max-w-[300px] ${tone}`}>{row.name.toUpperCase()}</td>
                        <td className={`py-2.5 ${tone}`}>{row.number}</td>
                        <td className={`py-2.5 ${tone}`}>{String(row.platform).padStart(2, '0')}</td>
                        <td className={`py-2.5 pr-6 text-right ${tone} ${row.status.startsWith('DELAYED') && row.delay >= 15 ? 'animate-board-blink' : ''}`}>
                          {row.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel p-3.5 grid md:grid-cols-[1fr_auto] gap-3 items-center">
            <div className="flex items-start gap-2.5 min-w-0">
              <MapPin size={15} className={board.station.coordinate_valid ? 'text-ir-sky mt-0.5' : 'text-warn mt-0.5'} />
              <div className="min-w-0">
                <div className="text-[11px] text-slate-200 truncate">
                  {[board.station.address, board.station.state, board.station.zone].filter(Boolean).join(' · ') || 'No location metadata supplied'}
                </div>
                <div className="text-[10px] text-muted font-mono mt-0.5">
                  {board.station.coordinate_valid
                    ? `${board.station.lat.toFixed(5)}, ${board.station.lng.toFixed(5)}`
                    : 'Coordinates missing/invalid in source'}
                  {' · '}{board.station.source === 'catalogue_alias'
                    ? `current-code alias of ${board.station.alias_of}`
                    : 'user_station_catalogue'}
                </div>
                <div className="text-[10px] text-ir-sky mt-1">
                  {(board.catalogue_services || 0).toLocaleString('en-IN')} scheduled services in the currently installed train parts
                </div>
              </div>
            </div>
            <div className={`flex items-center gap-1.5 text-[10px] ${board.stale ? 'text-warn' : 'text-muted'}`}>
              {board.stale && <WifiOff size={12} />}
              {board.stale ? 'Feed stale — historical estimates' : 'Live feed · refreshes every 15s'}
            </div>
          </div>

          {board.rows.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {board.rows.slice(0, 4).map((row) => (
                <div key={`card-${row.number}`} className="panel p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-[13px]">{row.number}</span>
                    <span className={`text-[11px] font-mono ${row.delay >= 15 ? 'text-bad' : row.delay >= 5 ? 'text-warn' : 'text-ok'}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="text-[12px] text-slate-200 truncate mt-1">{row.name}</div>
                  <div className="text-[11px] text-muted font-mono mt-1.5">
                    sched {row.scheduled} · exp {row.time} · PF {row.platform}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
