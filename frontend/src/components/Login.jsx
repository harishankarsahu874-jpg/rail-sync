import React, { useState } from 'react';

const ROUTE = [
  ['HWH', 'Howrah'],
  ['BBS', 'Bhubaneswar'],
  ['VSKP', 'Visakhapatnam'],
  ['MAS', 'Chennai'],
];

const PERKS = [
  ['🎫', 'Instant e-ticket view', 'Live coach & platform context'],
  ['📡', 'Live tracking', 'Exact fix on the real track'],
  ['🤖', 'RF ETA', 'Schedule + delay + drift'],
];

/**
 * Demo passenger gate (client-side only, like the OmniRail reference):
 * any Travel ID + 4-char key signs in, biometric is a simulated scan,
 * and "Continue as Guest" skips straight to the companion.
 * Nothing is ever sent to a server; "remember" picks local vs session storage.
 */
export default function Login({ onDone }) {
  const [id, setId] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [bio, setBio] = useState('idle');

  const finish = (session) => {
    const store = remember ? localStorage : sessionStorage;
    try { store.setItem('railsync_session', JSON.stringify({ ...session, at: Date.now() })); } catch { /* private mode */ }
    onDone({ ...session, at: Date.now() });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!id.trim()) { setError('Enter your username or Travel ID (demo — anything works).'); return; }
    if (key.trim().length < 4) { setError('Security key needs 4+ characters (demo — anything works).'); return; }
    setError('');
    finish({ name: id.trim(), mode: 'passenger' });
  };

  const biometric = () => {
    if (bio !== 'idle') return;
    setBio('scanning');
    setTimeout(() => {
      setBio('ok');
      setTimeout(() => finish({ name: 'Passenger', mode: 'biometric' }), 550);
    }, 1500);
  };

  return (
    <div className="login-wrap">
      <header className="login-top">
        <span className="brand-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="5" y="3" width="14" height="13" rx="3" /><path d="M5 10h14" /><path d="M9 20l-1.5 2M15 20l1.5 2" />
            <circle cx="9" cy="13.5" r=".8" /><circle cx="15" cy="13.5" r=".8" />
          </svg>
        </span>
        <span className="login-title">Passenger Login</span>
        <span className="login-help" title="Demo gate — no real credentials, nothing leaves your browser">?</span>
      </header>

      <div className="login-route mono">
        {ROUTE.map(([code, name], i) => (
          <React.Fragment key={code}>
            {i > 0 && <span className="lr-line" />}
            <span className={`lr-stop ${i === ROUTE.length - 1 ? 'end' : ''}`} title={name}>{code}</span>
          </React.Fragment>
        ))}
        <span className="lr-chip">5,139 SERVICES</span>
      </div>

      <span className="chip chip-teal login-badge">⚡ INDIAN RAILWAYS · LIVE JOURNEY COMPANION</span>
      <h1 className="login-h1">Board Your Next Journey</h1>
      <p className="login-sub">
        Live positions, full station boards and Random-Forest ETAs across
        5,139 catalogued services. Any origin, any destination.
      </p>

      <form className="panel panel-pad login-card" onSubmit={submit}>
        <div className="login-card-head">
          <div>
            <div className="faint" style={{ fontSize: 10, letterSpacing: '.12em' }}>PASSENGER PORTAL</div>
            <div className="card-title" style={{ marginTop: 2 }}>RailSync Sign-In</div>
          </div>
          <span className="brand-logo soft">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="3" width="14" height="13" rx="3" /><path d="M5 10h14" /></svg>
          </span>
        </div>

        <label className="login-label" htmlFor="ls-id">Username or Travel ID</label>
        <div className="login-field">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6.5 16c.6-1.6 4.4-1.6 5 0M14 9h5M14 13h5" /></svg>
          <input id="ls-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. hari.traveller or IR-892401" autoComplete="username" />
        </div>

        <div className="login-label-row">
          <label className="login-label" htmlFor="ls-key">Security Key / Password</label>
          <button type="button" className="login-mini" onClick={() => setShowKey((v) => !v)}>
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <div className="login-field">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          <input id="ls-key" type={showKey ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder="••••••••••••" autoComplete="current-password" />
        </div>

        <label className="login-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this terminal device
        </label>

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="login-submit">
          Sign In & Plan Journey <span aria-hidden="true">→</span>
        </button>

        <div className="login-divider"><span>OR INSTANTANEOUS BIOMETRIC</span></div>
        <button type="button" className={`login-bio ${bio}`} onClick={biometric} disabled={bio !== 'idle'}>
          <span className="bio-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 11c0 3-.5 6-1.5 8.5" /><path d="M8.5 8.7A5 5 0 0 1 17 12c0 2-.2 4-.6 6" />
              <path d="M5.5 6.5A8.5 8.5 0 0 1 20.5 12c0 1.5-.1 3-.3 4.5" /><path d="M3.8 10a9.8 9.8 0 0 1 1.4-2.6" /><path d="M12 12a3 3 0 0 0-3-3" />
            </svg>
          </span>
          {bio === 'idle' && 'Sign In via Face ID / Biometrics'}
          {bio === 'scanning' && 'Scanning… hold still'}
          {bio === 'ok' && 'Verified ✓ boarding pass synced'}
        </button>
      </form>

      <div className="panel panel-pad login-guest">
        <div className="login-guest-head">
          <div>
            <div className="card-title" style={{ fontSize: 14 }}>Traveling without an account?</div>
            <div className="card-sub" style={{ marginTop: 2 }}>Full companion, zero signup.</div>
          </div>
          <button type="button" className="login-guest-btn" onClick={() => finish({ name: 'Guest', mode: 'guest' })}>
            Continue as Guest →
          </button>
        </div>
        <div className="login-perks">
          {PERKS.map(([icon, title, sub]) => (
            <div key={title} className="login-perk">
              <span aria-hidden="true">{icon}</span>
              <b>{title}</b>
              <i>{sub}</i>
            </div>
          ))}
        </div>
      </div>

      <div className="login-foot">
        New passenger aboard RailSync? <button type="button" className="login-mini" onClick={() => finish({ name: 'New Passenger', mode: 'guest' })}>Create Account</button>
      </div>
      <div className="login-privacy mono">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /></svg>
        Demo auth · no credentials leave this browser · keys stay in .env.production
      </div>
    </div>
  );
}
