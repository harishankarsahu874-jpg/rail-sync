// Thin fetch wrapper for the RailSync REST API (same origin in production;
// Vite proxies /api and /ws in dev).
async function req(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try { detail = (await r.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return r.json();
}

export const api = {
  get: (p) => req(p),
  post: (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) }),
  del: (p) => req(p, { method: 'DELETE' }),
};
