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
