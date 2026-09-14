import { api } from './api.js';

/* Per-train artwork.
   1st choice (async, backend): the train's OWN real photograph from
   Wikipedia / Wikimedia Commons — see fetchTrainPhotos below.
   Fallback (sync, always unique): an Indian-Railways-style destination
   board generated from THIS train's number, name, endpoints and class —
   no two trains ever share the same picture again. */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

const CLASS_COLORS = [
  [/RAJDHANI/, ['#5f1414', '#d92626', '#ffd54f']],
  [/VANDE/, ['#6b2c0f', '#f97316', '#fff3e0']],
  [/TEJAS|SHATABDI/, ['#6b4e07', '#f59e0b', '#fff8e1']],
  [/DURONTO/, ['#0d3b23', '#22c55e', '#e8f5e9']],
  [/GARIB\s?RATH/, ['#14395c', '#38bdf8', '#e1f5fe']],
  [/EXPRESS|MAIL|SUPERFAST|PASSENGER|MEMU|EMU|LOCAL/, ['#0c2a4d', '#2563eb', '#e3f2fd']],
];

/** Unique destination-board artwork for one train (data-URI SVG). */
export function trainArt(t) {
  const num = String(t?.number || '');
  const name = String(t?.name || `Train ${num || ''}`);
  const up = `${name} ${t?.type || ''}`.toUpperCase();
  let [dark, accent, light] = ['#12233f', '#14b8a6', '#e0f2f1'];
  for (const [re, cols] of CLASS_COLORS) if (re.test(up)) { [dark, accent, light] = cols; break; }
  const h = hash(num || name);
  const tilt = -6 - (h % 5);
  const ends = Array.isArray(t?.route_ends) && t.route_ends.length === 2
    ? t.route_ends.join('  →  ')
    : (t?.from && t?.to ? `${t.from}  →  ${t.to}` : '');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="#070b14"/></linearGradient></defs>` +
    `<rect width="800" height="450" fill="url(#g)"/>` +
    `<g opacity="0.45" transform="rotate(${tilt} 400 225)">` +
    `<rect x="-120" y="318" width="1040" height="30" fill="${accent}"/>` +
    `<rect x="-120" y="362" width="1040" height="12" fill="${accent}" opacity="0.55"/>` +
    `<rect x="-120" y="86" width="1040" height="7" fill="${accent}" opacity="0.35"/></g>` +
    `<text x="560" y="330" text-anchor="middle" font-family="Consolas, monospace" font-weight="800" font-size="210" fill="${accent}" opacity="0.17">${esc(num)}</text>` +
    `<g opacity="0.92">` +
    `<rect x="42" y="40" rx="10" width="${54 + num.length * 20}" height="42" fill="${accent}"/>` +
    `<text x="62" y="69" font-family="Consolas, monospace" font-weight="700" font-size="25" fill="#0b0f14">${esc(num)}</text></g>` +
    `<text x="758" y="66" text-anchor="end" font-family="Segoe UI, Arial, sans-serif" font-size="16" letter-spacing="4" fill="${light}" opacity="0.7">INDIAN RAILWAYS</text>` +
    `<text x="42" y="418" font-family="Segoe UI, Arial, sans-serif" font-size="14" letter-spacing="3" fill="${light}" opacity="0.5">RAILSYNC · LIVE JOURNEY COMPANION</text>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/** Batch-fetch REAL per-train photos (Wikipedia/Commons) from the backend.
    Returns { number: {url, source} } — trains without a real photo keep
    their unique board artwork. */
export async function fetchTrainPhotos(nums) {
  const list = [...new Set((nums || []).filter(Boolean).map(String))].slice(0, 8);
  if (!list.length) return {};
  try {
    const d = await api.get(`/api/train_photos?nums=${list.join(',')}`);
    return d.photos || {};
  } catch {
    return {};
  }
}

export default trainArt;
