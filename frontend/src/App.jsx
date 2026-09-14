import React, { useEffect, useRef, useState } from 'react';
import { Route, Routes, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Journey from './components/Journey.jsx';
import Login from './components/Login.jsx';
import RailwayArt from './components/RailwayArt.jsx';
import Station from './components/Station.jsx';
import Saathi from './components/Saathi.jsx';
import { trainArt, fetchTrainPhotos } from './trainArt.js';

const TRAIN_ICON = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="13" rx="3" /><path d="M4 11h16" /><path d="M8 19l-2 3" /><path d="M16 19l2 3" />
    <circle cx="8.5" cy="14.5" r="1" fill="currentColor" /><circle cx="15.5" cy="14.5" r="1" fill="currentColor" />
  </svg>
);

/** Perspective railway artwork behind the hero: tracks, sleepers, catenary. */
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
        {session && (
          <span className="user-pill" title={`signed in via ${session.mode}`}>
            <span className="user-ava">{(session.name || 'G').trim().charAt(0).toUpperCase()}</span>
            <span className="user-meta">
              <b>{session.name}</b>
              <i>{{ passenger: 'Passenger', guest: 'Guest mode', google: 'Google demo', partner: 'Partner' }[session.mode] || 'Traveller'}</i>
            </span>
            <button type="button" className="user-out" onClick={onSignOut} title="Sign out" aria-label="Sign out">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
            </button>
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
  const [resPhotos, setResPhotos] = useState({});
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
        .then((data) => {
          const rows = data.results || [];
          setResults(rows);
          fetchTrainPhotos(rows.map((r) => r.number)).then((m) => setResPhotos((prev) => ({ ...prev, ...m }))).catch(() => {});
        })
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
                <img className="res-thumb" src={resPhotos[row.number]?.url || trainArt(row)} alt="" />
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

function StaleBundleGuard() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const h = await api.get('/api/health');
        if (!alive || !h.asset) return;
        const mine = (import.meta.url || '').split('/').pop();
        const served = h.asset.split('/').pop();
        if (mine && served && mine !== served) setStale(true);
      } catch { /* offline */ }
    };
    check();
    const iv = setInterval(check, 45_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  if (!stale) return null;
  return (
    <div className="stale-toast" role="alert">
      <span>🚂 A newer RailSync build is on the server — your tab is on an old one.</span>
      <button type="button" onClick={() => window.location.reload()}>Load new version</button>
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
  const navigate = useNavigate();
  useEffect(() => {
    if (session && session.goto) {
      const to = session.goto;
      setSession({ ...session, goto: undefined });
      navigate(to);
    }
  }, [session, navigate]);
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
        <Login onDone={setSession} />
      </>
    );
  }
  return (
    <>
      <StaleBundleGuard />
      <TopBar session={session} onSignOut={signOut} />
      <Routes>
        <Route path="/" element={<Hero />} />
        <Route path="/train/:number" element={<Journey />} />
        <Route path="/train/:number/station/:code" element={<Station />} />
      </Routes>
      <Saathi />
    </>
  );
}
