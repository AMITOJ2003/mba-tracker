// Mock-exam analysis: trend, projection, section strengths, timing, error patterns.
import { daysBetween, fmtDate } from './dates.js';

export const SECTION_MINUTES = 45;
export const SECTIONS = [
  { key: 'quant', label: 'Quant', short: 'Q', q: 21 },
  { key: 'verbal', label: 'Verbal', short: 'V', q: 23 },
  { key: 'di', label: 'Data Insights', short: 'DI', q: 20 },
];
export const ERRORS = [
  { key: 'errConcept', label: 'Concept', tip: 'revisit those topics from your error log' },
  { key: 'errCareless', label: 'Careless', tip: 'build a 10-second re-check habit' },
  { key: 'errTiming', label: 'Timing', tip: 'practise with strictly timed sets' },
];

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const has = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(v);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function regress(pts) {
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  let sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, at: (x) => my + slope * (x - mx) };
}

export function analyze(scores, st, checkpoints, today) {
  const list = scores.slice().sort((a, b) => a.date.localeCompare(b.date));
  const n = list.length;
  const out = { n, list, insights: [] };
  if (!n) return out;

  const latest = list.at(-1), prev = list.at(-2), first = list[0];
  const recent = list.slice(-3);
  Object.assign(out, {
    latest,
    delta: prev ? latest.total - prev.total : null,
    best: list.reduce((m, s) => (s.total > m.total ? s : m)),
    avg3: Math.round(mean(recent.map((s) => s.total))),
    sinceFirst: n > 1 ? latest.total - first.total : null,
  });

  // Trend & projection (needs 3+ mocks over 2+ weeks)
  const span = daysBetween(first.date, latest.date);
  if (n >= 3 && span >= 14) {
    const window = list.slice(-8);
    const r = regress(window.map((s) => [daysBetween(first.date, s.date), s.total]));
    const target = st.firstAttempt > today ? st.firstAttempt : null;
    // Only give a point projection when the forecast horizon is short relative to the data;
    // score gains flatten, so a long straight-line extrapolation would be over-confident.
    const horizon = target ? daysBetween(latest.date, target) : 0;
    out.trend = {
      perWeek: r.slope * 7,
      projected: target && horizon <= span * 1.5 ? Math.max(205, Math.min(805, Math.round(r.at(daysBetween(first.date, target))))) : null,
      date: target,
    };
  }
  const weeksLeft = daysBetween(today, st.firstAttempt) / 7;
  out.needPerWeek = weeksLeft > 0.5 ? (st.gmatTarget - out.avg3) / weeksLeft : null;

  // Sections
  out.sections = SECTIONS.map((sec) => {
    const vals = list.filter((s) => has(s[sec.key]));
    const last3 = vals.slice(-3);
    const withAcc = last3.filter((s) => has(s[`${sec.key}Correct`]));
    const withTime = last3.filter((s) => has(s[`${sec.key}Time`]));
    return {
      ...sec,
      count: vals.length,
      latest: vals.at(-1)?.[sec.key] ?? null,
      avg3: last3.length ? Math.round(mean(last3.map((s) => s[sec.key])) * 10) / 10 : null,
      change: vals.length > 1 ? vals.at(-1)[sec.key] - vals[0][sec.key] : null,
      accuracy: withAcc.length ? mean(withAcc.map((s) => s[`${sec.key}Correct`] / sec.q)) : null,
      secPerQ: withTime.length ? mean(withTime.map((s) => (s[`${sec.key}Time`] * 60) / sec.q)) : null,
      tight: withTime.filter((s) => s[`${sec.key}Time`] >= SECTION_MINUTES - 1).length,
      spare: withTime.length ? mean(withTime.map((s) => SECTION_MINUTES - s[`${sec.key}Time`])) : null,
      timed: withTime.length,
    };
  });
  const scored = out.sections.filter((s) => s.avg3 != null);
  if (scored.length >= 2) {
    const sorted = scored.slice().sort((a, b) => a.avg3 - b.avg3);
    if (sorted.at(-1).avg3 - sorted[0].avg3 >= 2) out.weakest = sorted[0];
  }

  // Error patterns (last 5 mocks)
  const last5 = list.slice(-5);
  out.errors = ERRORS.map((e) => ({ ...e, n: last5.reduce((a, s) => a + (Number(s[e.key]) || 0), 0) }));
  out.errorTotal = out.errors.reduce((a, e) => a + e.n, 0);

  // ---------- Insights (most useful first, max 4) ----------
  const ins = [];
  if (out.trend?.projected != null) {
    const { projected, perWeek, date } = out.trend;
    const pace = `${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(1)} pts/week`;
    if (projected >= st.gmatTarget) ins.push(`On pace for about ${projected} by ${fmtDate(date)} (${pace}) — at or above your ${st.gmatTarget} target.`);
    else ins.push(`On pace for about ${projected} by ${fmtDate(date)} (${pace}). To reach ${st.gmatTarget} you need roughly +${Math.max(1, Math.ceil(out.needPerWeek))} pts/week.`);
  } else if (out.trend && out.needPerWeek != null) {
    const { perWeek } = out.trend;
    const need = Math.max(0, out.needPerWeek);
    const pace = `${perWeek >= 0 ? '+' : ''}${perWeek.toFixed(1)}`;
    ins.push(need === 0
      ? `Your recent average is already at ${st.gmatTarget}. Keep it steady.`
      : `You're improving ${pace} pts/week. Reaching ${st.gmatTarget} by ${fmtDate(st.firstAttempt)} needs about +${need.toFixed(1)}/week — ${perWeek >= need ? 'you’re ahead of that pace' : 'pick up the pace'}.`);
  } else if (n < 3) {
    ins.push(`Log ${plural(3 - n, 'more mock')} to unlock your score projection.`);
  }

  if (out.weakest) ins.push(`${out.weakest.label} is your weakest section (${out.weakest.avg3} avg, last 3). Put most of your hours there.`);

  const tight = out.sections.filter((s) => s.timed >= 2 && s.tight >= 2).sort((a, b) => b.tight - a.tight)[0];
  const lowAccSpare = out.sections.find((s) => s.spare != null && s.spare >= 6 && s.accuracy != null && s.accuracy < 0.7);
  if (tight) ins.push(`${tight.label}: you used the full 45 minutes in ${tight.tight} of your last ${tight.timed} mocks. Practise pacing so you're not guessing at the end.`);
  else if (lowAccSpare) ins.push(`${lowAccSpare.label}: you finish ~${Math.round(lowAccSpare.spare)} min early but get ${Math.round(lowAccSpare.accuracy * 100)}% right. Slow down and use that time.`);

  if (out.errorTotal >= 5) {
    const top = out.errors.slice().sort((a, b) => b.n - a.n)[0];
    const pct = Math.round((top.n / out.errorTotal) * 100);
    if (pct >= 40) ins.push(`${top.label} mistakes are ${pct}% of your errors in recent mocks — ${top.tip}.`);
  }

  const off = list.filter((s) => s.official), third = list.filter((s) => !s.official);
  if (off.length && third.length >= 2) {
    const diff = Math.round(mean(off.map((s) => s.total)) - mean(third.map((s) => s.total)));
    if (Math.abs(diff) >= 15) ins.push(`Your official exams average ${Math.abs(diff)} points ${diff < 0 ? 'below' : 'above'} your third-party mocks. Trust the official number.`);
  }

  if (last5.length >= 4) {
    const spread = Math.round(sd(last5.map((s) => s.total)));
    if (spread >= 25) ins.push(`Your last ${last5.length} scores swing by about ±${spread}. Aim for consistency before new highs.`);
  }

  const nextCp = checkpoints.filter((c) => c.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (nextCp) {
    const gap = nextCp.score - latest.total;
    ins.push(gap <= 0 ? `Next checkpoint (${nextCp.score} by ${fmtDate(nextCp.date)}) — you're already there.` : `Next checkpoint: ${nextCp.score} by ${fmtDate(nextCp.date)} — ${gap} points to go.`);
  }

  out.insights = ins.slice(0, 4);
  return out;
}

export const fmtPace = (sec) => (sec == null ? '—' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);
