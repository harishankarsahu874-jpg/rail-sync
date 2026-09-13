import React, { useEffect, useRef, useState } from 'react';
import { Route, Routes, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Journey from './components/Journey.jsx';
import Login from './components/Login.jsx';

const TRAIN_ICON = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="13" rx="3" /><path d="M4 11h16" /><path d="M8 19l-2 3" /><path d="M16 19l2 3" />
    <circle cx="8.5" cy="14.5" r="1" fill="currentColor" /><circle cx="15.5" cy="14.5" r="1" fill="currentColor" />
  </svg>
);

/** Perspective railway artwork behind the hero: tracks, sleepers, catenary. */
function RailwayArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 1200 520" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f6faf9" /><stop offset="1" stopColor="#e7f5f2" />
          </linearGradient>
        </defs>
        <rect width="1200" height="520" fill="url(#sky)" />
        {/* sleepers */}
        {Array.from({ length: 14 }).map((_, i) => {
          const t = i / 14;
          const y = 210 + Math.pow(t, 1.9) * 310;
          const half = 8 + Math.pow(t, 1.8) * 330;
          return <rect key={i} x={600 - half} y={y} width={half * 2} height={2 + t * 7} rx="2" fill="#0d9488" opacity={0.10 + t * 0.10} />;
        })}
        {/* rails */}
        <path d="M600 208 L260 520" stroke="#0f766e" strokeWidth="3.4" opacity=".5" fill="none" />
        <path d="M600 208 L940 520" stroke="#0f766e" strokeWidth="3.4" opacity=".5" fill="none" />
        <path d="M600 208 L470 520" stroke="#14b8a6" strokeWidth="1.6" opacity=".35" fill="none" />
        <path d="M600 208 L730 520" stroke="#14b8a6" strokeWidth="1.6" opacity=".35" fill="none" />
        {/* catenary masts */}
        {[150, 330, 870, 1050].map((x, i) => (
          <g key={x} stroke="#94a3b8" strokeWidth="2" opacity=".4">
            <path d={`M${x} ${520 - i * 8} V ${300 - i * 14}`} />
            <path d={`M${x} ${308 - i * 14} h ${x < 600 ? 46 : -46}`} />
          </g>
        ))}
        {/* distant train silhouette */}
        <g opacity=".5" transform="translate(588 176)">
          <rect x="0" y="0" width="24" height="14" rx="4" fill="#0f766e" />
          <rect x="3" y="3" width="5" height="5" rx="1" fill="#e7f5f2" />
          <rect x="10" y="3" width="5" height="5" rx="1" fill="#e7f5f2" />
          <circle cx="6" cy="16" r="2.4" fill="#334155" /><circle cx="18" cy="16" r="2.4" fill="#334155" />
        </g>
        <circle cx="600" cy="208" r="26" fill="#14b8a6" opacity=".12" />
      </svg>
    </div>
  );
}

/** Soft teal ring that follows the pointer and grows over interactive bits. */
function CursorFX() {
  const ref = useRef(null);
  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return undefined;
    const move = (e) => {
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate(${e.clientX}px, ${e.clientY}px) ${el.classList.contains('hot') ? 'scale(1.65)' : ''}`;
      el.style.left = '0px';
      el.style.top = '0px';
      el.classList.add('on');
      el.style.marginLeft = `${e.clientX - 17}px`;
      el.style.marginTop = `${e.clientY - 17}px`;
      el.style.transform = '';
    };
    const over = (e) => {
      const hot = e.target.closest?.('a, button, input, [role="button"], .led-row, .try-chip');
      ref.current?.classList.toggle('hot', Boolean(hot));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseover', over);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseover', over); };
  }, []);
  return <div ref={ref} className="cursor-glow" aria-hidden="true" />;
}

function TopBar({ session, onSignOut }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand">
          <span className="brand-logo">{TRAIN_ICON}</span>
          <span>
            <span className="brand-name">Rail<em>Sync</em></span>
            <span className="brand-sub" style={{ display: 'block' }}>live journey companion</span>
          </span>
        </Link>
        <span className="topbar-spacer" />
        <span className="chip chip-teal"><span className="dot" />LIVE</span>
        {session && (
          <span className="chip chip-plain topbar-user" title={`signed in via ${session.mode}`}>
            👤 {session.name}
            <button type="button" className="topbar-signout" onClick={onSignOut} title="Sign out">×</button>
          </span>
        )}
      </div>
    </header>
  );
}

const TRY = [
  ['12841', 'Coromandel Express'],
  ['12951', 'Mumbai Tejas Rajdhani'],
  ['12301', 'Howrah Rajdhani'],
  ['12621', 'Tamil Nadu Express'],
];

function Hero() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [runningNow, setRunningNow] = useState([]);

  useEffect(() => {
    api.get('/api/running').then((d) => setRunningNow(d.observed || [])).catch(() => {});
    const handle = setInterval(() => {
      api.get('/api/running').then((d) => setRunningNow(d.observed || [])).catch(() => {});
    }, 60_000);
    return () => clearInterval(handle);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return undefined; }
    const handle = setTimeout(() => {
      api.get(`/api/search?q=${encodeURIComponent(query)}`)
        .then((data) => setResults(data.results || []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const go = (number) => navigate(`/train/${number}`);

  return (
    <div className="hero-wrap">
      <RailwayArt />
      <section className="hero hero-inner">
        <span className="chip chip-live"><span className="dot" />HYBRID LIVE PROVIDERS</span>
        <h1>Where is your train, right now?<span>Down to the track it stands on.</span></h1>
        <p>
          RailSync fuses live Indian Railways telemetry with weather, terrain,
          OpenStreetMap track geometry and a Random-Forest ETA model —
          one honest, explainable journey view for every catalogued train in India.
        </p>
        <form className="searchbox" onSubmit={(e) => { e.preventDefault(); if (query.trim()) go(query.trim()); }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Any Indian train — number or name (5,139 catalogued)"
            aria-label="Search train"
          />
          <button type="submit">Track live</button>
        </form>
        {results.length > 0 && (
          <div className="search-results">
            {results.map((row) => (
              <button key={row.number} type="button" onClick={() => go(row.number)}>
                <span className="mono" style={{ color: 'var(--teal-ink)', fontWeight: 600 }}>{row.number}</span>
                <span>{row.name}</span>
                <span className="faint" style={{ marginLeft: 'auto', fontSize: 11 }}>
                  {row.from}→{row.to} · {row.stops} stops
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="try-row">
          <span className="faint" style={{ alignSelf: 'center', fontSize: 12 }}>Try:</span>
          {TRY.map(([number, name]) => (
            <button key={number} type="button" className="try-chip" onClick={() => go(number)}>
              {number} · {name}
            </button>
          ))}
        </div>
        {runningNow.length > 0 && (
          <div className="running-strip" style={{ marginTop: 18 }}>
            <span className="chip chip-live"><span className="dot" />OBSERVED RUNNING NOW · exact live positions</span>
            <div className="running-rows">
              {runningNow.map((row) => (
                <button key={row.number} type="button" className="running-row" onClick={() => go(row.number)}>
                  <span className="mono rr-num">{row.number}</span>
                  <span className="rr-name">{row.name}</span>
                  {row.lat != null ? (
                    <span className="rr-pos mono">
                      {row.lat.toFixed(2)}, {row.lng.toFixed(2)} · {Math.round((row.progress || 0) * 100)}%
                      {row.next_name ? ` · → ${row.next_name}` : ''}
                    </span>
                  ) : (
                    <span className="rr-pos faint">position lands on open</span>
                  )}
                  {row.delay_min != null && (
                    <span className={`rr-delay mono ${row.delay_min > 15 ? 'late' : ''}`}>
                      {row.delay_min > 0 ? '+' : ''}{Math.round(row.delay_min)} min
                    </span>
                  )}
                  <span className="rr-go">track →</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="wrap hero-inner" style={{ paddingTop: 8 }}>
        <div className="grid-companion" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[
            ['RailRadar + 5,139-train catalogue', 'Live position, speed & delay for running services; full scheduled route board for every catalogued train.'],
            ['Random-Forest dynamic ETA', 'Final ETA = schedule + live delay + RF-predicted drift, with the model card published in-app.'],
            ['OSM + Geoapify + MapTiler', 'Track snapping on real mapped rail, place names at the fix, vector basemap with free-tile fallback.'],
          ].map(([title, body]) => (
            <div key={title} className="panel panel-pad">
              <div className="card-title">{title}</div>
              <div className="card-sub" style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.55 }}>{body}</div>
            </div>
          ))}
        </div>
        <div className="footer">
          RailSync Live · hackathon prototype · telemetry © RailRadar, timetable catalogue uploaded,
          map data © OpenStreetMap contributors, elevation © OpenTopography / Open-Meteo · not for operational use
        </div>
      </div>
    </div>
  );
}

function readSession() {
  try {
    const raw = localStorage.getItem('railsync_session') || sessionStorage.getItem('railsync_session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(readSession);
  const signOut = () => {
    try {
      localStorage.removeItem('railsync_session');
      sessionStorage.removeItem('railsync_session');
    } catch { /* ignore */ }
    setSession(null);
  };
  if (!session) {
    return (
      <>
        <CursorFX />
        <Login onDone={setSession} />
      </>
    );
  }
  return (
    <>
      <CursorFX />
      <TopBar session={session} onSignOut={signOut} />
      <Routes>
        <Route path="/" element={<Hero />} />
        <Route path="/train/:number" element={<Journey />} />
      </Routes>
    </>
  );
}
