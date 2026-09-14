import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { saathiReply } from '../saathi.js';

const CHIPS = [
  'Where is my train now?',
  'What is the expected arrival?',
  'Which station is next?',
  'Why is my train delayed?',
  'Show the full route',
  'Trains at Bhubaneswar?',
];

/**
 * RailSync Saathi — floating AI journey companion.
 * Rule-based brain (src/saathi.js) grounded in the live backend feeds;
 * structured replies, quick-query chips and in-app action buttons.
 */
export default function Saathi() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [nudge, setNudge] = useState(true);
  const boxRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  const ctxTrain = (location.pathname.match(/\/train\/(\d{5})/) || [])[1] || null;

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [msgs, typing, open]);

  useEffect(() => {
    if (open && msgs.length === 0) {
      setMsgs([{
        who: 'bot',
        text: `Namaste! 🙏 I'm RailSync Saathi — your AI journey companion.${ctxTrain ? ` I can see you're watching train ${ctxTrain}; ask me anything about it.` : ' Ask me about any train in India.'}`,
        chips: true,
      }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ask = async (raw) => {
    const text = (raw || '').trim();
    if (!text || typing) return;
    setInput('');
    setNudge(false);
    setMsgs((m) => [...m, { who: 'user', text }]);
    setTyping(true);
    let reply;
    try {
      reply = await saathiReply(text, { train: ctxTrain });
    } catch {
      reply = { text: 'My live feeds just hiccuped — give me a moment and ask again 🙏' };
    }
    const think = 500 + Math.min(900, (reply.text || '').length * 3);
    setTimeout(() => {
      setTyping(false);
      setMsgs((m) => [...m, { who: 'bot', text: reply.text, actions: reply.actions || null }]);
    }, think);
  };

  return (
    <>
      {open && (
        <div className="saathi-panel" role="dialog" aria-label="RailSync Saathi chat">
          <header className="saathi-head">
            <img src="/saathi.png" alt="RailSync Saathi" className="saathi-ava" />
            <div className="saathi-id">
              <b>RailSync Saathi</b>
              <i><span className="saathi-dot" /> Online · AI journey companion</i>
            </div>
            <button type="button" className="saathi-x" onClick={() => setOpen(false)} aria-label="Minimise chat">—</button>
          </header>

          <div className="saathi-msgs" ref={boxRef}>
            {msgs.map((m, i) => (
              <div key={i} className={`saathi-row ${m.who}`}>
                {m.who === 'bot' && <img src="/saathi.png" alt="" className="saathi-mini" />}
                <div className="saathi-bubble">
                  <span className="saathi-text">{m.text}</span>
                  {m.actions && m.actions.length > 0 && (
                    <div className="saathi-actions">
                      {m.actions.map((a) => (
                        <button key={a.label} type="button" className="saathi-act" onClick={() => { navigate(a.to); setOpen(false); }}>
                          {a.label} →
                        </button>
                      ))}
                    </div>
                  )}
                  {m.chips && (
                    <div className="saathi-chips">
                      {CHIPS.map((c) => (
                        <button key={c} type="button" className="saathi-chip" onClick={() => ask(c === 'Where is my train now?' && !ctxTrain ? 'where is 12841?' : c)}>
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {typing && (
              <div className="saathi-row bot">
                <img src="/saathi.png" alt="" className="saathi-mini" />
                <div className="saathi-bubble typing"><span /><span /><span /></div>
              </div>
            )}
          </div>

          <form className="saathi-input" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Ask Saathi… e.g. "where is 12841?"'
              aria-label="Message RailSync Saathi"
            />
            <button type="submit" className="saathi-send" aria-label="Send message" disabled={!input.trim() || typing}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></svg>
            </button>
          </form>
          <div className="saathi-foot">Saathi answers from live RailSync feeds · demo companion</div>
        </div>
      )}

      <button type="button" className={`saathi-launcher ${open ? 'open' : ''}`} onClick={() => { setOpen((v) => !v); setNudge(false); }} aria-label="Chat with RailSync Saathi">
        {!open && nudge && <span className="saathi-nudge">Hi! I&apos;m Saathi 👋</span>}
        <span className="saathi-ring" />
        <img src="/saathi.png" alt="" />
        <span className="saathi-live" />
      </button>
    </>
  );
}
