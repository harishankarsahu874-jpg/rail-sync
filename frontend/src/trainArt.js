import { api } from './api.js';

/* Per-train-class artwork so every journey card, search row and station
   board row shows a real-looking train photo next to the name. */
const ART = {
  rajdhani: '/trains/rajdhani.jpg',
  vande: '/trains/vande.jpg',
  tejas: '/trains/tejas.jpg',
  express: '/trains/express.jpg',
};

export function trainArt(train) {
  const s = `${train?.name || ''} ${train?.type || ''}`.toUpperCase();
  if (/RAJDHANI/.test(s)) return ART.rajdhani;
  if (/VANDE\s?BHARAT|VANDE/.test(s)) return ART.vande;
  if (/TEJAS|SHATABDI/.test(s)) return ART.tejas;
  return ART.express;
}

export default trainArt;

/** Batch-fetch REAL per-train photos (Wikipedia/Commons) from the backend.
    Returns { number: {url, source} } — empty/failed lookups just keep art. */
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
