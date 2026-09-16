import { api } from './api.js';

/* RailSync Saathi — rule-based conversation brain.
   Every answer is grounded in the live backend feeds (journey snapshot,
   timetable, station index, weather). When a feed cannot answer honestly
   (PNR, platform numbers, seat availability) Saathi says so and offers
   what she *can* do. She never invents data. */

const fmtMin = (minutes) => {
  if (minutes == null || Number.isNaN(minutes)) return null;
  const day = Math.floor(minutes / 1440);
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return day > 0 ? `${hh}:${mm} +${day}d` : `${hh}:${mm}`;
};

const TRAIN_NO = /\b(\d{5})\b/;

async function journey(n) {
  const d = await api.get(`/api/journey/${n}`);
  return d && d.train ? d : null;
}

const upcomingOf = (d) => d.halts.filter((h) => !h.passed);
const nextHaltAction = (d, num, firstLabel) => {
  const nx = upcomingOf(d)[0];
  const acts = [{ label: firstLabel || 'Show full route', to: `/train/${num}`, scroll: 'map' }];
  if (nx && nx.code) acts.push({ label: `${nx.name} dossier`, to: `/train/${num}/station/${nx.code}` });
  return acts;
};
const passedOf = (d) => d.halts.filter((h) => h.passed);
const etaOf = (h) => fmtMin(h.eta_final_min ?? h.eta_min);

function statusLines(d, brief) {
  const tr = d.train;
  const L = [];
  const upcoming = upcomingOf(d);
  if (!tr.running) {
    const o = d.halts[0];
    L.push(`🕒 ${tr.number} ${tr.name} has not started yet — it departs ${o ? o.name : 'its origin'} at ${o && o.sched ? o.sched : 'its scheduled time'} (reference timetable).`);
    if (upcoming.length) L.push(`First stops: ${upcoming.slice(0, 4).map((s) => s.name).join(' → ')}.`);
    return L;
  }
  const passed = passedOf(d);
  const next = upcoming[0];
  const last = passed[passed.length - 1];
  const pct = tr.total_km ? Math.round((100 * (tr.pos_km || 0)) / tr.total_km) : null;
  L.push(`🚆 ${tr.number} ${tr.name} is RUNNING${tr.speed_kmh ? ` at ~${Math.round(tr.speed_kmh)} km/h` : ''}.`);
  if (last) L.push(`📍 Last passed ${last.name} (sched ${last.sched || '—'}${last.eta_min != null ? `, actual ~${fmtMin(last.eta_min)}` : ''}).`);
  if (next) L.push(`⏭ Next: ${next.name} — RF ETA ${etaOf(next) || '—'} vs sched ${next.sched || '—'}.`);
  if (!brief) {
    if (pct != null) L.push(`🛤 ${Math.round(tr.pos_km || 0)} of ${Math.round(tr.total_km || 0)} km done (${pct}%).`);
    if (tr.delay_min != null) L.push(tr.delay_min >= 2 ? `⏱ Running ~${Math.round(tr.delay_min)} min late right now.` : '⏱ Running close to schedule right now.');
    const wx = d.weather || (next && next.weather);
    if (wx && wx.temperature_c != null) L.push(`🌦 ${wx.temperature_c}°C, ${wx.condition} ${d.weather ? 'at the live position' : 'at the next stop'}.`);
  }
  return L;
}

function routeLine(d) {
  const names = d.halts.map((h) => h.name);
  if (names.length <= 8) return names.join(' → ');
  return `${names.slice(0, 4).join(' → ')} → …(${names.length - 8} more)… → ${names.slice(-4).join(' → ')}`;
}

export async function saathiReply(raw, ctx) {
  const text = (raw || '').trim();
  const t = text.toLowerCase();
  const explicitNum = (text.match(TRAIN_NO) || [])[1] || null;
  const num = explicitNum || ctx.train || null;
  const A = (label, to, scroll) => [{ label, to, scroll: scroll || null }];

  /* greetings & meta */
  if (/^(hi|hey|hello|namaste|namaskar|good (morning|evening|afternoon))\b/.test(t)) {
    return {
      text: `Namaste! 🙏 I'm RailSync Saathi, your journey companion.\nAsk me where any train is right now, its live ETA, next station, delay status, full route or weather en route — or search any of 5,139 services.`,
      actions: num ? A(`Show ${num} on map`, `/train/${num}`) : null,
    };
  }
  if (/(what can you do|help|capabilities|how do you work)/.test(t)) {
    return {
      text: 'I can help you with:\n• Live position — "where is 12841 now?"\n• ETA & delays — "is it late?", "when does it reach?"\n• Next station & full route\n• Weather en route\n• Train search — "find Coromandel"\n• Any station\'s board — "trains at Bhubaneswar"\nI\'m honest about limits: PNR, seat availability and platform numbers aren\'t in my live feeds.',
    };
  }
  if (/(thank|thanks|dhanyavad|shukriya)/.test(t)) {
    return { text: "Always happy to help! 🙏 Safe travels — I'm one tap away if you need anything else on the journey." };
  }

  /* honest limits */
  if (/(pnr|seat|berth|availability|booking|ticket|platform|coach position)/.test(t)) {
    return {
      text: `That one's outside my live feeds — PNR status, seat availability, platform numbers and ticketing live with IRCTC and station displays, and I won't guess them.\nWhat I *can* give you right now: live position, RF ETA, delay trend, next halt, full route and en-route weather for any of 5,139 trains. Want any of those?`,
      actions: num ? A(`Live status of ${num}`, `/train/${num}`) : null,
    };
  }

  /* station board: "trains at <name>" */
  const atMatch = t.match(/trains?\s+(?:at|from|through|calling|departing|arriving)\s+(?:station\s+)?([a-z][a-z\s]{2,30})/)
    || t.match(/^(?:which|list|show|tell me)?\s*(?:station\s+)?([a-z][a-z\s]{2,30})\s+(?:station\s+)?(?:board|trains|services)/);
  if (atMatch && !explicitNum) {
    const q = atMatch[1].trim();
    try {
      const found = await api.get(`/api/stations?q=${encodeURIComponent(q)}`);
      const hit = found.results && found.results[0];
      if (hit) {
        const sd = await api.get(`/api/station/${hit.code}?name=${encodeURIComponent(hit.name)}`);
        const list = (sd.services || []).slice(0, 5);
        return {
          text: `🚉 ${sd.name} (${sd.code}) — ${sd.services_count} catalogued services call here.\nA few of them:\n${list.map((s) => `• ${s.number} ${s.name} — halt ${s.sched} (${s.from}→${s.to})`).join('\n') || 'No services indexed yet.'}\nSay a number and I'll open its live journey.`,
          actions: [
            ...(list[0] ? [{ label: `Open ${list[0].number} live`, to: `/train/${list[0].number}` }] : []),
            { label: `Open ${sd.code} station board`, to: `/train/${(list[0] || { number: num || '18448' }).number}/station/${sd.code}?name=${encodeURIComponent(sd.name)}`, scroll: 'top' },
          ],
        };
      }
    } catch { /* fall through */ }
    return { text: `I couldn't match a station called "${q}" in the timetable index. Try the exact station name (e.g. "Bhubaneswar") or its code (e.g. BBS).` };
  }

  /* train search by name */
  if (!num && /(find|search|look ?up|which trains?|list)/.test(t)) {
    const q = text.replace(/^(find|search|look ?up|show)\s+/i, '').replace(/\?/g, '').trim();
    if (q) {
      const r = await api.get(`/api/trains?q=${encodeURIComponent(q)}`);
      const rows = (r.results || []).slice(0, 4);
      if (rows.length) {
        return {
          text: `Found ${r.count || rows.length} match${(r.count || rows.length) === 1 ? '' : 'es'}:\n${rows.map((x) => `• ${x.number} — ${x.name}`).join('\n')}\nSay the number (e.g. "${rows[0].number}") and I'll pull its live journey.`,
          actions: A(`Open ${rows[0].number} live`, `/train/${rows[0].number}`),
        };
      }
    }
  }

  /* journey-grounded intents */
  if (num) {
    const d = await journey(num);
    if (!d) return { text: `I couldn't find train ${num} in the 5,139-service catalogue. Double-check the number, or ask me to "find <name>".` };
    const tr = d.train;

    if (/(route|stops|stations|path|via|itinerary)/.test(t)) {
      return {
        text: `🗺 ${tr.number} ${tr.name} — ${d.halts.length} halts, ${Math.round(tr.total_km || 0)} km:\n${routeLine(d)}\n${tr.running ? 'The full route line with every halt is drawn on the live map.' : 'Route shown from the reference timetable until it starts running.'}`,
        actions: nextHaltAction(d, num),
      };
    }
    if (/(next|upcoming|approach)/.test(t) && /(station|stop|halt)/.test(t)) {
      const nx = upcomingOf(d)[0];
      if (!nx) return { text: `${tr.number} is near the end of its run — no further halts in the window.` };
      const after = upcomingOf(d)[1];
      return { text: `⏭ ${nx.name} (${nx.code}) is next — RF ETA ${etaOf(nx) || '—'} vs sched ${nx.sched || '—'}.${after ? ` After that: ${after.name}.` : ''}`, actions: A('Show on map', `/train/${num}`, 'map') };
    }
    if (/(late|delay|delayed|early|on time|why|slack)/.test(t)) {
      const lines = statusLines(d, true);
      const drift = tr.delay_min != null ? Math.round(tr.delay_min) : 0;
      let reason = 'Live feeds show no abnormal drift right now — the train is holding its schedule.';
      const wx = d.weather;
      if (drift >= 8 && wx && /rain|thunder|drizzle|snow/i.test(wx.condition || '')) reason = `Weather at the live position (${wx.condition}) is a likely contributor to the slip.`;
      else if (drift >= 8) reason = 'Likely operational slack recovery — section running time, crossings or traffic ahead; my feeds don\'t carry official delay remarks, so I won\'t invent one.';
      else if (drift >= 2) reason = 'A small slip of a few minutes — normal running recovery on Indian Railways sections.';
      return { text: [...lines, `🧾 ${reason}`].join('\n'), actions: A('Show on map', `/train/${num}`, 'map') };
    }
    if (/(eta|arrival|reach|when|time|schedule)/.test(t)) {
      const nx = upcomingOf(d)[0];
      const dest = d.halts[d.halts.length - 1];
      const lines = statusLines(d, true);
      const extra = [];
      if (nx) extra.push(`⏭ ${nx.name}: RF ${etaOf(nx) || '—'} (sched ${nx.sched || '—'}).`);
      if (dest && dest !== nx) extra.push(`🏁 Destination ${dest.name}: RF ${etaOf(dest) || dest.sched || '—'} (sched ${dest.sched || '—'}).`);
      return { text: [...lines, ...extra].join('\n'), actions: A('Show on map', `/train/${num}`, 'map') };
    }
    if (/(weather|rain|temperature|heat|cold|humid|cloud)/.test(t)) {
      const wx = d.weather || (upcomingOf(d)[0] && upcomingOf(d)[0].weather);
      if (wx && wx.temperature_c != null) {
        return { text: `🌦 ${wx.temperature_c}°C, ${wx.condition}, humidity ${wx.humidity_pct ?? '—'}%, wind ${wx.wind_kmh ?? '—'} km/h ${d.weather ? 'at the live position' : 'at the next stop'}.\nStop-level forecasts for the next halts appear on the live journey panel.`, actions: A('Show on map', `/train/${num}`, 'map') };
      }
      return { text: `Weather for ${num} hasn't loaded yet — it fills in a few seconds after the journey opens. Open the live view and ask me again.` };
    }
    /* default: full live status */
    return {
      text: statusLines(d, false).join('\n'),
      actions: nextHaltAction(d, num, 'Show on map'),
    };
  }

  /* no number, no match */
  const hint = ctx.train ? ` (I'll use your open train ${ctx.train}.)` : '';
  return {
    text: `I want to give you exact live data, not guesses.${hint}\nTell me a 5-digit train number — e.g. "where is 12841?" — or ask:\n• "find Coromandel"\n• "trains at Bhubaneswar"\n• "route of 12801"\n• "weather en route 12842"`,
  };
}
