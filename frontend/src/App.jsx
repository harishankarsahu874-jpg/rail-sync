import React, { useEffect, useState } from 'react';
import { Route, Routes, Link, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import Journey from './components/Journey.jsx';

const TRAIN_ICON = (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="16" height="13" rx="3" /><path d="M4 11h16" /><path d="M8 19l-2 3" /><path d="M16 19l2 3" />
    <circle cx="8.5" cy="14.5" r="1" fill="currentColor" /><circle cx="15.5" cy="14.5" r="1" fill="currentColor" />
  </svg>
);

function TopBar() {
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
        <span className="chip chip-teal"><span className="dot" />5 APIs · LIVE</span>
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
    <div>
      <section className="hero">
        <span className="chip chip-live"><span className="dot" />HYBRID LIVE PROVIDERS</span>
        <h1>Where is your train, right now?<span>Down to the track it stands on.</span></h1>
        <p>
          RailSync fuses live Indian Railways telemetry with weather, terrain,
          OpenStreetMap track geometry and reverse geocoding — one honest,
          explainable journey view.
        </p>
        <form className="searchbox" onSubmit={(e) => { e.preventDefault(); if (query.trim()) go(query.trim()); }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Train number or name — e.g. 12841, Coromandel"
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
      </section>

      <div className="wrap" style={{ paddingTop: 8 }}>
        <div className="grid-companion" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[
            ['RailRadar', 'Live position, speed & delay straight from Indian Railways telemetry.'],
            ['OpenWeather + OpenTopography', 'Live weather severity and COP30 elevation at the exact fix.'],
            ['OSM + Geoapify + MapTiler', 'Track snapping on real mapped rail, place names, vector basemap.'],
          ].map(([title, body]) => (
            <div key={title} className="panel panel-pad">
              <div className="card-title">{title}</div>
              <div className="card-sub" style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.55 }}>{body}</div>
            </div>
          ))}
        </div>
        <div className="footer">
          RailSync Live · hackathon prototype · telemetry © RailRadar, map data © OpenStreetMap
          contributors, elevation © OpenTopography / Open-Meteo · not for operational use
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <TopBar />
      <Routes>
        <Route path="/" element={<Hero />} />
        <Route path="/train/:number" element={<Journey />} />
      </Routes>
    </>
  );
}
