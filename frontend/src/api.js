// Thin same-origin fetch wrapper (production: FastAPI serves this bundle).
async function req(path, opts = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  if (!response.ok) {
    let detail = `${response.status}`;
    try { detail = (await response.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return response.json();
}
export const api = {
  get: (p) => req(p),
  post: (p) => req(p, { method: 'POST' }),
};
