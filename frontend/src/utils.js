// absolute minutes-of-day -> "HH:MM" (with +1d / +2d for overnight legs)
export function fmtAbs(mins) {
  if (mins == null) return '—';
  const m = Math.round(mins);
  const day = Math.floor(m / 1440);
  const mm = ((m % 1440) + 1440) % 1440;
  const hh = String(Math.floor(mm / 60)).padStart(2, '0');
  const mi = String(mm % 60).padStart(2, '0');
  return day > 0 ? `+${day}d ${hh}:${mi}` : `${hh}:${mi}`;
}

export function severityClass(d, status) {
  if (status === 'arrived') return 'arrived';
  if (status === 'boarded') return 'boarded';
  if (d < 5) return 'ok';
  if (d < 15) return 'minor';
  if (d < 30) return 'major';
  return 'severe';
}
