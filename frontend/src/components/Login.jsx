import React, { useState } from 'react';
import RailwayArt from './RailwayArt.jsx';

/**
 * Minimalist passenger gate (demo auth, client-side only):
 * any Travel ID + 4-char key signs in, or "Continue as Guest" skips ahead.
 * Nothing is ever sent to a server; "remember" picks local vs session storage.
 */
export default function Login({ onDone }) {
  const [id, setId] = useState('');
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');

  const finish = (session) => {
    const store = remember ? localStorage : sessionStorage;
    try { store.setItem('railsync_session', JSON.stringify({ ...session, at: Date.now() })); } catch { /* private mode */ }
    onDone({ ...session, at: Date.now() });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!id.trim()) { setError('Enter your username or Travel ID — demo, anything works.'); return; }
    if (key.trim().length < 4) { setError('Security key needs 4+ characters — demo, anything works.'); return; }
    setError('');
    finish({ name: id.trim(), mode: 'passenger' });
  };

  return (
    <div className="login-wrap">
      <div className="login-bg" aria-hidden="true">
        <RailwayArt />
        <div className="login-bg-fade" />
      </div>

      <div className="login-card-wrap">
        <div className="login-brand">
          <span className="brand-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="5" y="3" width="14" height="13" rx="3" /><path d="M5 10h14" /><path d="M9 20l-1.5 2M15 20l1.5 2" />
              <circle cx="9" cy="13.5" r=".8" /><circle cx="15" cy="13.5" r=".8" />
            </svg>
          </span>
          <span className="login-title">Rail<em>Sync</em> · Passenger Login</span>
        </div>

        <h1 className="login-h1">Board Your Next Journey</h1>
        <p className="login-sub">
          Live positions, full station boards and Random-Forest ETAs
          across every catalogued train in India.
        </p>

        <form className="panel panel-pad login-card" onSubmit={submit}>
          <label className="login-label" htmlFor="ls-id">Username or Travel ID</label>
          <div className="login-field">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M6.5 16c.6-1.6 4.4-1.6 5 0M14 9h5M14 13h5" /></svg>
            <input id="ls-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. hari.traveller or IR-892401" autoComplete="username" />
          </div>

          <label className="login-label" htmlFor="ls-key">Security Key</label>
          <div className="login-field">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
            <input id="ls-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </div>

          <label className="login-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember this device
          </label>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-submit">Sign In & Plan Journey <span aria-hidden="true">→</span></button>
          <button type="button" className="login-guest-btn" onClick={() => finish({ name: 'Guest', mode: 'guest' })}>
            Continue as Guest →
          </button>
        </form>

        <div className="login-privacy mono">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" /></svg>
          Demo sign-in · nothing leaves this browser
        </div>
      </div>
    </div>
  );
}
