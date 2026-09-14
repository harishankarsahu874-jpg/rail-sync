import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { trainArt } from '../trainArt.js';

const fmtMin = (minutes) => {
  if (minutes == null || Number.isNaN(minutes)) return '—';
  const day = Math.floor(minutes / 1440);
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return day > 0 ? `${hh}:${mm} +${day}d` : `${hh}:${mm}`;
};

function PlatformArt() {
  return (
    <svg viewBox="0 0 800 300" className="st-art" role="img" aria-label="Station platform illustration">
      <defs>
        <linearGradient id="stsky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0ea5b7" stopOpacity=".25" />
          <stop offset="1" stopColor="#0ea5b7" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#stsky)" />
      <path d="M0 210h800" stroke="#94a3b8" strokeWidth="3" />
      <path d="M0 235h800" stroke="#cbd5e1" strokeWidth="2" />
      {[...Array(16)].map((_, i) => (
        <rect key={i} x={20 + i * 50} y={212} width="26" height="6" rx="2" fill="#94a3b8" opacity=".7" />
      ))}
      <rect x="60" y="90" width="300" height="86" rx="10" fill="#0d9488" />
      <rect x="76" y="106" width="60" height="40" rx="6" fill="#ccfbf1" />
      <rect x="150" y="106" width="60" height="40" rx="6" fill="#ccfbf1" />
      <rect x="224" y="106" width="60" height="40" rx="6" fill="#ccfbf1" />
      <circle cx="110" cy="188" r="14" fill="#0f172a" />
      <circle cx="300" cy="188" r="14" fill="#0f172a" />
      <rect x="430" y="60" width="10" height="150" fill="#64748b" />
      <rect x="392" y="42" width="150" height="34" rx="8" fill="#0f172a" />
      <text x="467" y="65" textAnchor="middle" fill="#5eead4" fontSize="17" fontFamily="monospace" fontWeight="700">PLATFORM 1</text>
      <rect x="600" y="120" width="120" height="70" rx="8" fill="#e2e8f0" />
      <rect x="612" y="132" width="40" height="26" rx="4" fill="#94a3b8" />
      <rect x="664" y="132" width="40" height="26" rx="4" fill="#94a3b8" />
    </svg>
  );
}

export default function Station() {
  const { number, code } = useParams();
  const location = useLocation();
  const passedHalt = location.state?.halt || null;
  const [dossier, setDossier] = useState(null);
  const [halt, setHalt] = useState(passedHalt);
  const [train, setTrain] = useState(null);

  useEffect(() => {
    let alive = true;
    const name = passedHalt?.name || '';
    api.get(`/api/station/${code}?name=${encodeURIComponent(name)}&train=${number}`)
      .then((d) => { if (alive) setDossier(d); })
      .catch(() => {});
    if (!passedHalt) {
      api.get(`/api/journey/${number}`)
        .then((j) => {
          if (!alive) return;
          setTrain(j.train);
          setHalt((j.halts || []).find((h) => h.code === code) || null);
        })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [code, number, passedHalt]);

  const services = useMemo(() => dossier?.services || [], [dossier]);
  const name = halt?.name || dossier?.name || code;

  return (
    <div className="wrap">
      <div className="st-crumbs">
        <Link to="/" className="chip chip-plain">← home</Link>
        <Link to={`/train/${number}`} className="chip chip-plain">#{number} journey</Link>
        <span className="chip chip-teal">station dossier</span>
      </div>

      <div className="panel st-hero">
        <div className="st-photo">
          {dossier?.image?.url
            ? <img src={dossier.image.url} alt={`${name} railway station`} loading="lazy" />
            : <PlatformArt />}
          <div className="st-photo-scrim" />
          <div className="st-photo-title">
            <h1>{name}</h1>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="mono chip chip-plain">{code}</span>
              <span className="chip chip-teal">{dossier?.services_count ?? '…'} services call here</span>
              {halt?.passed && <span className="chip chip-plain">PASSED on #{number}</span>}
              {halt?.next && <span className="chip chip-live"><span className="dot" />NEXT STOP of #{number}</span>}
            </div>
          </div>
        </div>
        {dossier?.image?.page && (
          <a className="st-credit" href={dossier.image.page} target="_blank" rel="noreferrer">
            📷 {dossier.image.title} · Wikimedia Commons
          </a>
        )}
      </div>

      <div className="grid-companion" style={{ marginTop: 16 }}>
        <div className="stack">
          <div className="panel panel-pad">
            <div className="card-title">About this station</div>
            <p className="st-summary">{dossier?.summary || 'Loading encyclopedia summary…'}</p>
            {halt && (
              <>
                <div className="card-title" style={{ marginTop: 14 }}>
                  On train #{number} today
                </div>
                <div className="stat-grid" style={{ marginTop: 8 }}>
                  <div className="stat"><div className="k">Scheduled</div><div className="v" style={{ fontSize: 16 }}>{halt.sched || '—'}</div></div>
                  <div className="stat"><div className="k">ETA (sched+delay)</div><div className="v" style={{ fontSize: 16 }}>{halt.passed ? '—' : fmtMin(halt.eta_min)}</div></div>
                  <div className="stat"><div className="k">RF final ETA</div>
                    <div className="v" style={{ fontSize: 16, color: 'var(--teal-ink)' }}>{halt.passed ? '—' : fmtMin(halt.eta_final_min)}</div></div>
                  <div className="stat"><div className="k">RF drift</div>
                    <div className="v" style={{ fontSize: 16 }}>
                      {halt.passed || halt.drift_min == null ? '—' : `${halt.drift_min > 0 ? '+' : ''}${halt.drift_min} min`}
                    </div></div>
                  <div className="stat"><div className="k">Distance</div><div className="v" style={{ fontSize: 16 }}>{Math.round(halt.distance_km)}<small> km</small></div></div>
                  <div className="stat"><div className="k">Journey day</div><div className="v" style={{ fontSize: 16 }}>{halt.day}</div></div>
                </div>
                {halt.weather && (
                  <div className="chip chip-plain" style={{ marginTop: 10 }}>
                    🌡 {Math.round(halt.weather.temperature_c)}°C · {halt.weather.condition} ·
                    wind {Math.round(halt.weather.wind_kmh)} km/h · RH {halt.weather.humidity_pct}%
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="panel panel-pad">
            <div className="card-title">Every catalogued train calling here</div>
            <div className="card-sub">From the uploaded all-India timetable — tap any service to open its live journey.</div>
            <div className="st-services" style={{ marginTop: 10 }}>
              {services.length === 0 && <div className="card-sub">Indexing the timetable…</div>}
              {services.map((s) => (
                <Link key={`${s.number}-${s.sched}`} to={`/train/${s.number}`} className="st-service">
                  <img className="st-thumb" src={trainArt(s)} alt="" />
                  <span className="mono st-snum">{s.number}</span>
                  <span className="st-sname">{s.name}</span>
                  <span className="mono st-smeta">{s.from}→{s.to} · {s.sched || '—'} · {s.days}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="footer">
        Station photography © Wikimedia Commons contributors · timetable uploaded ·
        live telemetry © RailRadar · not for operational use
      </div>
    </div>
  );
}
