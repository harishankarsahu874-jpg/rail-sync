import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { reverseGeocode } from '../geo.js';
import MapView from './MapView.jsx';

const POLL_MS = 20_000;

const fmtMin = (minutes) => {
  if (minutes == null || Number.isNaN(minutes)) return '—';
  const day = Math.floor(minutes / 1440);
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return day > 0 ? `${hh}:${mm} +${day}d` : `${hh}:${mm}`;
};

function WeatherIcon({ code }) {
  const rainy = code != null && (code >= 200 || (code >= 500 && code < 800) || code >= 80);
  const cloudy = code != null && (code >= 801 || (code >= 45 && code < 50));
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round">
      {rainy ? (<><path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.6A3.5 3.5 0 0 0 6.5 18z" /><path d="M8 21l-1 2" /><path d="M12 21l-1 2" /></>)
        : cloudy ? (<><path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.6A3.5 3.5 0 0 0 6.5 18z" /></>)
          : (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="M2 12h2" /><path d="M20 12h2" /></>)}
    </svg>
  );
}

export default function Journey() {
  const { number } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [place, setPlace] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [openStop, setOpenStop] = useState(null);

  const load = useCallback(async () => {
    try {
      const view = await api.get(`/api/journey/${number}`);
      setData(view);
      setError('');
    } catch (exc) {
      setError(exc.message || 'journey unavailable');
    }
  }, [number]);

  useEffect(() => {
    load();
    const handle = setInterval(load, POLL_MS);
    return () => clearInterval(handle);
  }, [load]);

  // Geoapify reverse-geocode of the live fix (browser key, cached per fix).
  useEffect(() => {
    const position = data?.train?.position;
    if (!position) { setPlace(null); return; }
    const key = `${position.lat.toFixed(3)},${position.lng.toFixed(3)}`;
    setPlace((prev) => (prev?.key === key ? prev : { key, loading: true }));
    if (place?.key !== key || place?.loading) {
      reverseGeocode(position.lat, position.lng).then((result) => setPlace({ key, ...result }));
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => {
    setRefreshing(true);
    try {
      setData(await api.post(`/api/journey/${number}/refresh`));
      setError('');
    } catch (exc) {
      setError(exc.message || 'refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const train = data?.train;
  const halts = useMemo(() => data?.halts || [], [data]);
  const upcoming = halts.filter((h) => !h.passed);
  const passed = halts.filter((h) => h.passed).slice(-3).reverse();
  const profile = useMemo(() => {
    const points = data?.elevation?.profile?.points || [];
    const elevations = data?.elevation?.profile?.elevations || [];
    return points.map((p, i) => ({ km: i, m: elevations[i] ?? null }));
  }, [data]);

  if (error && !data) {
    return (
      <div className="wrap">
        <div className="panel panel-pad error-card">
          <div className="card-title">Journey unavailable</div>
          <div className="card-sub" style={{ marginTop: 6 }}>{error}</div>
          <div style={{ marginTop: 12 }}>
            <Link to="/" className="chip chip-plain">← search another train</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!train) return <div className="wrap skeleton">Contacting RailRadar + 4 more providers…</div>;

  const providers = data.providers?.items || {};

  return (
    <div className="wrap">
      {/* ---------------------------------------------------------- header */}
      <div className="panel panel-pad">
        <div className="j-head">
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono chip chip-plain">#{train.number}</span>
              {train.running
                ? <span className="chip chip-live"><span className="dot" />LIVE · {train.status.toUpperCase()}</span>
                : <span className="chip chip-off">NOT RUNNING · {train.status.toUpperCase()}</span>}
              {train.position?.snapped
                ? <span className="chip chip-teal">TRACK-SNAPPED · {train.position.offset_m} m</span>
                : train.position
                  ? <span className="chip chip-plain">RAW FIX · outside snap guard</span>
                  : null}
            </div>
            <h1 className="j-title" style={{ marginTop: 10 }}>{train.name}</h1>
            <div className="j-sub">
              {train.running
                ? `Live fix ${train.age_s ?? '?'} s old · updates every ${POLL_MS / 1000} s`
                : 'This service is not running right now — route shown for reference'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="try-chip" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Force refresh'}
            </button>
            <Link to="/" className="try-chip" style={{ textDecoration: 'none' }}>New search</Link>
          </div>
        </div>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${Math.round(train.progress * 100)}%` }} />
        </div>
        <div className="progress-labels mono">
          <span>0 km</span>
          <span>{Math.round(train.progress * 100)}% of {Math.round(train.total_km)} km</span>
          <span>{Math.round(train.total_km)} km</span>
        </div>

        <div className="stat-grid">
          <div className="stat"><div className="k">Delay</div>
            <div className="v" style={{ color: train.delay_min > 15 ? 'var(--rose)' : 'var(--ok)' }}>
              {Math.round(train.delay_min)}<small> min</small></div></div>
          <div className="stat"><div className="k">Speed</div>
            <div className="v">{Math.round(train.speed_kmh)}<small> km/h</small></div></div>
          <div className="stat"><div className="k">Distance</div>
            <div className="v">{Math.round(train.pos_km)}<small> km</small></div></div>
          <div className="stat"><div className="k">Next halt</div>
            <div className="v" style={{ fontSize: 13 }}>{upcoming[0]?.name?.split(' ')[0] || '—'}</div></div>
          <div className="stat"><div className="k">ETA next</div>
            <div className="v" style={{ fontSize: 15 }}>{fmtMin(upcoming[0]?.eta_min)}</div></div>
        </div>

        {upcoming[0]?.eta_final_min != null && (
          <div className="eta-hero">
            <div>
              <div className="faint" style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                Predicted arrival · {upcoming[0].name}
              </div>
              <div className="big">{fmtMin(upcoming[0].eta_final_min)}</div>
            </div>
            <div className="parts">
              = scheduled <span className="mono">{upcoming[0].sched || '—'}</span>
              {' '}+ live delay <span className="mono">{Math.round(train.delay_min)} min</span>
              {' '}+ RF drift <span className="mono">{upcoming[0].drift_min > 0 ? '+' : ''}{upcoming[0].drift_min} min</span>
              <div style={{ marginTop: 6 }}>
                <span className="chip chip-teal">RANDOM FOREST · holdout MAE {data.model?.holdout_mae_min} min</span>
                <span className="chip chip-plain">{data.model?.trained_rows} training rows</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid-companion" style={{ marginTop: 18 }}>
        {/* ------------------------------------------------- left: map + tl */}
        <div className="stack">
          <div className="panel panel-pad">
            <div className="card-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11l18-8-8 18-2-8z" /></svg>
              Live position on real mapped track
            </div>
            <div className="card-sub">
              RailRadar fix → Overpass OSM snap (guard ±1.5 km) → MapTiler/CARTO basemap
            </div>
            <div style={{ marginTop: 12 }}>
              <MapView position={train.position} running={train.running} />
            </div>
            {place?.available && (
              <div className="chip chip-plain" style={{ marginTop: 10 }}>
                📍 {place.place} <span className="faint">· Geoapify reverse geocode</span>
              </div>
            )}
          </div>

          <div className="panel panel-pad">
            <div className="card-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
              Journey timeline · scheduled vs live ETA
            </div>
            <div className="card-sub">ETAs = published schedule + live RailRadar delay</div>
            <div className="tl" style={{ marginTop: 10 }}>
              {[...passed, ...upcoming.slice(0, 7)].map((halt, index, rows) => (
                <div key={`${halt.seq}-${halt.name}`} className={`tl-row ${halt.passed ? 'passed' : ''} ${halt.next ? 'next' : ''}`}>
                  <div className="tl-rail">
                    <div className="tl-dot" />
                    {index < rows.length - 1 && <div className="tl-line" />}
                  </div>
                  <div className="tl-main">
                    <div className="tl-name">{halt.name}</div>
                    <div className="tl-meta">
                      {halt.code && <span className="mono chip chip-plain">{halt.code}</span>}
                      {halt.passed && <span className="chip chip-teal">PASSED</span>}
                      {halt.next && <span className="chip chip-live"><span className="dot" />NEXT</span>}
                      {halt.weather && (
                        <span className="chip chip-plain">
                          <WeatherIcon code={halt.weather.condition_code} />
                          {Math.round(halt.weather.temperature_c)}° · {halt.weather.condition}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="tl-times">
                    <div>{halt.sched || '—'}</div>
                    {!halt.passed && <div className="eta">→ {fmtMin(halt.eta_min)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel panel-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div className="card-title">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 21V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v15" /><path d="M2 21h20" /><path d="M8 8h8" /><path d="M8 12h8" /></svg>
                  Station board · full route
                </div>
                <div className="card-sub">
                  {halts.length} stations · uploaded Indian timetable + live ETA overlay ·
                  {' '}{data?.catalogue?.in_catalogue ? 'in catalogue' : 'RailRadar route'}
                </div>
              </div>
              <button type="button" className="try-chip" onClick={() => setBoardOpen((v) => !v)}>
                {boardOpen ? 'Hide board' : `Show all ${halts.length} stations`}
              </button>
            </div>
            {boardOpen && (
              <div className="led" style={{ marginTop: 12 }}>
                <div className="led-head">
                  <span>#</span><span>CODE</span><span>STATION</span><span>SCHED</span><span>ETA FINAL</span><span>STATUS</span>
                </div>
                {halts.map((halt) => (
                  <React.Fragment key={`${halt.seq}-${halt.code || halt.name}`}>
                    <button
                      type="button"
                      className={`led-row ${halt.passed ? 'passed' : ''} ${halt.next ? 'next' : ''}`}
                      onClick={() => setOpenStop((s) => (s === halt.seq ? null : halt.seq))}
                    >
                      <span>{halt.seq}</span>
                      <span>{halt.code || '—'}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{halt.name}</span>
                      <span>{halt.sched || '—'}</span>
                      <span style={{ color: halt.passed ? undefined : '#34d399' }}>
                        {halt.passed ? '—' : fmtMin(halt.eta_final_min ?? halt.eta_min)}
                      </span>
                      <span className="st">{halt.passed ? 'PASSED' : halt.next ? 'NEXT' : 'UPCOMING'}</span>
                    </button>
                    {openStop === halt.seq && (
                      <div className="led-detail">
                        <span>📏 {Math.round(halt.distance_km)} km from origin</span>
                        {halt.day > 1 && <span>🗓 journey day {halt.day}</span>}
                        {!halt.passed && halt.drift_min != null && (
                          <span>🤖 RF drift {halt.drift_min > 0 ? '+' : ''}{halt.drift_min} min</span>
                        )}
                        {halt.weather && (
                          <span className="chip chip-plain">
                            {Math.round(halt.weather.temperature_c)}° · {halt.weather.condition} · RH {halt.weather.humidity_pct}%
                          </span>
                        )}
                        {!halt.weather && !halt.passed && <span>stop weather: geocode/pending or unavailable</span>}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------- right: wx + elevation */}
        <div className="stack">
          <div className="panel panel-pad">
            <div className="card-title">
              <WeatherIcon code={data.weather?.condition_code} /> Weather at the live fix
            </div>
            {data.weather ? (
              <>
                <div className="wx-row" style={{ borderBottom: 0 }}>
                  <div className="wx-temp">{Math.round(data.weather.temperature_c)}°C</div>
                  <div>
                    <div className="wx-desc">{data.weather.condition} · feels {Math.round(data.weather.feels_like_c)}°</div>
                    <div className="wx-place">{data.weather.place} · wind {Math.round(data.weather.wind_kmh)} km/h · RH {data.weather.humidity_pct}%</div>
                  </div>
                </div>
                <div className="card-sub" style={{ marginTop: 4 }}>
                  ETA severity input <span className="mono">{Math.round((data.weather.severity || 0) * 100)}%</span> (published, explainable)
                </div>
                <div className="sev-bar"><div className="sev-fill" style={{ width: `${Math.round((data.weather.severity || 0) * 100)}%` }} /></div>
              </>
            ) : <div className="card-sub">OpenWeather unavailable for this fix.</div>}

            <div className="card-title" style={{ marginTop: 16 }}>Upcoming stops weather</div>
            {upcoming.filter((h) => h.weather).slice(0, 3).map((halt) => (
              <div className="wx-row" key={halt.name}>
                <div className="wx-temp">{Math.round(halt.weather.temperature_c)}°</div>
                <div>
                  <div className="wx-desc">{halt.name}</div>
                  <div className="wx-place">{halt.weather.condition} · rain {halt.weather.rain_mm_h} mm/h</div>
                </div>
              </div>
            ))}
            {upcoming.filter((h) => h.weather).length === 0 && (
              <div className="card-sub">Geocoding upcoming halts…</div>
            )}
          </div>

          <div className="panel panel-pad">
            <div className="card-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 20l5-9 4 6 4-8 5 11z" /></svg>
              Terrain ahead · elevation profile
            </div>
            <div className="card-sub">
              Open-Meteo DEM along fix → next halts
              {data.elevation?.cop30 && <> · COP30 at fix: <span className="mono">{data.elevation.cop30.elevation_m} m</span></>}
            </div>
            <div style={{ height: 130, marginTop: 10 }}>
              <ResponsiveContainer>
                <AreaChart data={profile} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <XAxis dataKey="km" hide />
                  <YAxis unit=" m" tick={{ fontSize: 10, fill: '#94a3b8' }} width={52} />
                  <Tooltip formatter={(v) => [`${v} m`, 'elevation']} labelFormatter={() => ''} />
                  <Area dataKey="m" stroke="#0d9488" fill="#ccfbf1" strokeWidth={2} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel panel-pad">
            <div className="card-title">Provider health</div>
            <div className="provider-strip" style={{ marginTop: 10 }}>
              {Object.entries(providers).map(([key, row]) => (
                <span
                  key={key}
                  className={`chip ${row.mode === 'live' ? 'chip-live' : row.mode === 'browser' ? 'chip-teal' : row.mode === 'degraded' ? 'chip-bad' : 'chip-plain'}`}
                  title={row.error || row.purpose}
                >
                  {row.mode === 'live' && <span className="dot" />}
                  {row.label}
                </span>
              ))}
            </div>
            <div className="card-sub" style={{ marginTop: 8 }}>
              Keys ship in the repo (<span className="mono">.env.production</span>) · env vars override ·
              degraded providers fall back visibly, never crash.
            </div>
          </div>
        </div>
      </div>

      <div className="footer">
        RailSync Live · telemetry © RailRadar · weather © OpenWeather · elevation © OpenTopography & Open-Meteo ·
        track & places © OpenStreetMap (Overpass, Nominatim, Geoapify) · basemap © MapTiler/CARTO
      </div>
    </div>
  );
}
