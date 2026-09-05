import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live data hook.
 * Primary: WebSocket push from /ws (one full snapshot per 15s tick).
 * Fallback: REST polling of /api/state if the socket never opens
 * (e.g. behind a proxy without WS support) — same 15s cadence.
 */
export default function useLive(pollMs = 15000) {
  const [state, setState] = useState(null);
  const [mode, setMode] = useState('connecting'); // ws | poll | connecting
  const pollRef = useRef(null);

  useEffect(() => {
    let ws = null;
    let timer = null;
    let closed = false;

    const poll = async () => {
      try {
        const r = await fetch('/api/state');
        if (!r.ok) return;
        const s = await r.json();
        if (!closed) { setState(s); setMode((m) => (m === 'ws' ? m : 'poll')); }
      } catch { /* server briefly unreachable — retry next tick */ }
    };

    const startPoll = () => {
      if (!timer && !closed) timer = setInterval(poll, pollMs);
    };

    pollRef.current = poll;
    poll(); // immediate first frame, then keep-alive polling

    try {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws.onmessage = (e) => {
        try { setState(JSON.parse(e.data)); setMode('ws'); } catch {}
      };
      ws.onclose = () => { if (!closed) { setMode('poll'); startPoll(); } };
      ws.onerror = () => { try { ws.close(); } catch {} };
    } catch {
      startPoll();
    }

    return () => {
      closed = true;
      try { ws && ws.close(); } catch {}
      if (timer) clearInterval(timer);
      if (pollRef.current === poll) pollRef.current = null;
    };
  }, [pollMs]);

  const refresh = useCallback(() => pollRef.current?.(), []);
  return { state, mode, refresh };
}
