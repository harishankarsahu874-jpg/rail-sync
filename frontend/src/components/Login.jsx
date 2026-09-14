import React, { useState } from 'react';

const FEATS = [
  ['📍', 'Live Location', 'Track trains in real time'],
  ['📈', 'Dynamic ETA', 'Random-Forest predictions'],
  ['🔔', 'Live Alerts', 'Delays & disruptions'],
  ['🤝', 'Better Journey', 'Reliable · Accurate · Live'],
];

/**
 * IRCTC-grade split hero gate (demo auth, client-side only).
 * Left: photographic railway hero + feature strip + zone banner.
 * Right: welcome card with User / Partner tabs, Google demo button,
 * an inline real-world Sign-Up form (no page jump) and a guest path.
 */
export default function Login({ onDone }) {
  const [tab, setTab] = useState('user');
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [id, setId] = useState('');
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  /* signup-only fields */
  const [suName, setSuName] = useState('');
  const [suId, setSuId] = useState('');
  const [suPass, setSuPass] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [suTerms, setSuTerms] = useState(false);

  const finish = (session) => {
    const store = remember ? localStorage : sessionStorage;
    try { store.setItem('railsync_session', JSON.stringify({ ...session, at: Date.now() })); } catch { /* private mode */ }
    onDone({ ...session, at: Date.now() });
  };

  const submit = (e) => {
    e.preventDefault();
    if (mode === 'signup') {
      if (suName.trim().length < 2) { setError('Please enter your full name.'); return; }
      if (suId.trim().length < 3) { setError('Enter an email or mobile number for your account.'); return; }
      if (suPass.length < 4) { setError('Password needs at least 4 characters (demo).'); return; }
      if (suPass !== suConfirm) { setError('Passwords do not match — please re-type.'); return; }
      if (!suTerms) { setError('Please accept the Terms of Use to continue (demo).'); return; }
      setError('');
      setNote('Account created (demo) — welcome aboard! 🎉');
      const who = suName.trim();
      setTimeout(() => finish({ name: who, mode: 'passenger' }), 700);
      return;
    }
    if (tab === 'org') { finish({ name: id.trim() || 'Partner', mode: 'partner' }); return; }
    if (!id.trim()) { setError('Enter your email, mobile number or Travel ID — demo, anything works.'); return; }
    if (key.trim().length < 4) { setError('Password needs 4+ characters — demo, anything works.'); return; }
    setError('');
    finish({ name: id.trim().split('@')[0], mode: 'passenger' });
  };

  const search = (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    finish({ name: 'Guest', mode: 'guest', goto: `/train/${encodeURIComponent(q.trim())}` });
  };

  const googleBtn = (
    <button type="button" className="lg-google" onClick={() => finish({ name: 'Google Traveller', mode: 'google' })}>
      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z" /><path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A11.5 11.5 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.6 14.7a6.9 6.9 0 0 1 0-4.4v-3H1.8a11.5 11.5 0 0 0 0 10.4l3.8-3z" /><path fill="#EA4335" d="M12 4.6c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.5 11.5 0 0 0 1.8 7.3l3.8 3c.9-2.7 3.4-4.7 6.4-4.7z" /></svg>
      Continue with Google <span className="faint" style={{ fontSize: 10 }}>(demo)</span>
    </button>
  );

  return (
    <div className="lg-page">
      <header className="lg-nav">
        <span className="lg-brand">
          <span className="brand-logo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="5" y="3" width="14" height="13" rx="3" /><path d="M5 10h14" /><path d="M9 20l-1.5 2M15 20l1.5 2" />
              <circle cx="9" cy="13.5" r=".8" /><circle cx="15" cy="13.5" r=".8" />
            </svg>
          </span>
          <span>
            <b>Rail<em>Sync</em></b>
            <i>India Moves Together</i>
          </span>
        </span>
        <nav className="lg-links">
          {['Home', 'Live Trains', 'Train Schedule', 'Stations'].map((l) => (
            <button key={l} type="button" className="lg-link" onClick={() => setNote(`Sign in (or continue as guest) to open ${l} 🙂`)}>{l}</button>
          ))}
          <span className="lg-link more">More ⌄</span>
        </nav>
        <form className="lg-search" onSubmit={search}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Train No. / Name / Station" aria-label="Search train" />
        </form>
        <span className="lg-lang">🌐 English ⌄</span>
      </header>

      <main className="lg-main">
        <section className="lg-left">
          <img src="/login-hero.jpg" alt="Indian Railways express train at golden hour" className="lg-hero-img" />
          <div className="lg-left-scrim" />
          <div className="lg-left-copy">
            <h1>Track Every Train<br /><em>Across India</em></h1>
            <p>Live train locations, real-time RF ETA predictions and smarter travel information — all in one place.</p>
          </div>
          <div className="lg-feats">
            {FEATS.map(([icon, title, sub]) => (
              <div key={title} className="lg-feat">
                <span aria-hidden="true">{icon}</span>
                <b>{title}</b>
                <i>{sub}</i>
              </div>
            ))}
          </div>
          <div className="lg-banner">
            <span aria-hidden="true">🚆</span>
            <div>
              <b>Real-time train movement now across all Indian Railways zones</b>
              <i>Powered by live telemetry + our AI-based Random-Forest ETA engine · 5,139 catalogued services</i>
            </div>
            <button type="button" onClick={() => finish({ name: 'Guest', mode: 'guest' })}>Know More →</button>
          </div>
        </section>

        <aside className="lg-right">
          <form className="lg-card" onSubmit={submit}>
            {mode === 'signup' ? (
              <>
                <h2>Create your <em>RailSync</em> account</h2>
                <p className="lg-sub">One account for live tracking, ETA alerts and station dossiers. Demo build — nothing leaves your browser.</p>

                <label className="login-label" htmlFor="su-name">Full name</label>
                <div className="login-field">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 14.5-4 16 0" /></svg>
                  <input id="su-name" value={suName} onChange={(e) => setSuName(e.target.value)} placeholder="e.g. Ananya Sharma" autoComplete="name" />
                </div>

                <label className="login-label" htmlFor="su-id">Email / Mobile Number</label>
                <div className="login-field">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                  <input id="su-id" value={suId} onChange={(e) => setSuId(e.target.value)} placeholder="you@example.com or 10-digit mobile" autoComplete="email" />
                </div>

                <div className="login-label-row">
                  <label className="login-label" htmlFor="su-pass">Password</label>
                  <button type="button" className="login-mini" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</button>
                </div>
                <div className="login-field">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                  <input id="su-pass" type={showKey ? 'text' : 'password'} value={suPass} onChange={(e) => setSuPass(e.target.value)} placeholder="Choose a password (4+ chars)" autoComplete="new-password" />
                </div>
                <div className="login-field">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="m10 15 2 2 4-4" /></svg>
                  <input type={showKey ? 'text' : 'password'} value={suConfirm} onChange={(e) => setSuConfirm(e.target.value)} placeholder="Re-type password" autoComplete="new-password" />
                </div>

                <label className="login-remember lg-terms">
                  <input type="checkbox" checked={suTerms} onChange={(e) => setSuTerms(e.target.checked)} />
                  I agree to the Terms of Use &amp; Privacy Policy (demo)
                </label>

                {error && <div className="login-error">{error}</div>}
                {note && <div className="login-note">{note}</div>}

                <button type="submit" className="lg-submit">Create Account</button>
                <div className="login-divider"><span>OR</span></div>
                {googleBtn}
                <div className="lg-signup">
                  Already have an account?{' '}
                  <button type="button" className="login-mini" onClick={() => { setMode('login'); setError(''); setNote(''); }}>Sign In</button>
                </div>
              </>
            ) : (
              <>
                <h2>Welcome to <em>RailSync</em></h2>
                <p className="lg-sub">Sign in to access live train tracking, ETA predictions and more.</p>

                <div className="lg-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={tab === 'user'} className={tab === 'user' ? 'on' : ''} onClick={() => { setTab('user'); setError(''); }}>User Login</button>
                  <button type="button" role="tab" aria-selected={tab === 'org'} className={tab === 'org' ? 'on' : ''} onClick={() => { setTab('org'); setError(''); }}>Organization / Partner</button>
                </div>

                <label className="login-label" htmlFor="lg-id">
                  {tab === 'user' ? 'Email / Mobile Number / Travel ID' : 'Organization ID'}
                </label>
                <div className="login-field">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 14.5-4 16 0" /></svg>
                  <input id="lg-id" value={id} onChange={(e) => setId(e.target.value)} placeholder={tab === 'user' ? 'Enter your email, mobile number or user ID' : 'e.g. PARTNER-0042'} autoComplete="username" />
                </div>

                {tab === 'user' && (
                  <>
                    <div className="login-label-row">
                      <label className="login-label" htmlFor="lg-key">Password</label>
                      <button type="button" className="login-mini" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</button>
                    </div>
                    <div className="login-field">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                      <input id="lg-key" type={showKey ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder="Enter your password" autoComplete="current-password" />
                    </div>
                    <div className="lg-rem-row">
                      <label className="login-remember">
                        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                        Remember me
                      </label>
                      <button type="button" className="login-mini" onClick={() => setNote('Demo build — any password works, no reset needed 🙂')}>Forgot Password?</button>
                    </div>
                  </>
                )}
                {tab === 'org' && (
                  <div className="card-sub" style={{ marginTop: 4 }}>
                    Partner access is invite-only during the hackathon demo — sign in with your org ID or continue as guest.
                  </div>
                )}

                {error && <div className="login-error">{error}</div>}
                {note && <div className="login-note">{note}</div>}

                <button type="submit" className="lg-submit">{tab === 'user' ? 'Sign In' : 'Continue as Partner'}</button>

                {tab === 'user' && (
                  <>
                    <div className="login-divider"><span>OR</span></div>
                    {googleBtn}
                    <div className="lg-signup">
                      Don&apos;t have an account?{' '}
                      <button type="button" className="login-mini" onClick={() => { setMode('signup'); setError(''); setNote(''); }}>Sign Up</button>
                    </div>
                  </>
                )}
              </>
            )}
            <button type="button" className="login-guest-btn" onClick={() => finish({ name: 'Guest', mode: 'guest' })}>
              Exploring? Continue as Guest →
            </button>
          </form>
        </aside>
      </main>

      <footer className="lg-foot">
        <span className="lg-foot-brand">🚂 Rail<em>Sync</em> · Safety | Security | Punctuality</span>
        <span className="lg-foot-links">About · Contact Us · Terms of Use · Privacy Policy · Help & Support</span>
        <span className="mono lg-foot-demo">demo build · no real credentials stored</span>
      </footer>
    </div>
  );
}
