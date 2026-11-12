import { loadState, saveState, requestPersist } from './db.js';
import { defaultState, normalizeState, SECTIONS as STUDY_SECTIONS, TAGS, DATE_STATUSES, CP_STATUSES, MOCK_SOURCES, uid } from './seed.js';
import { buildICS } from './ics.js';
import { scoreChart, bindChart } from './chart.js';
import { analyze, SECTIONS, ERRORS, SECTION_MINUTES, fmtPace } from './analyze.js';
import { snapshot, stamp, syncOnce, checkRepo, pull, sameData } from './sync.js';
import { todayISO, addDays, daysBetween, weekStart, fmtDate, fmtShort, fmtMonth, isValidISO } from './dates.js';

const APP_VERSION = '2.0.0';
let S;              // app state
let snap;           // last snapshot, for change tracking (sync)
let tab = 'today';
let planView = 'phases';
let chartMode = 'total';
const editingPhases = new Set();

/* ---------------- Utilities ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const byDate = (a, b) => a.date.localeCompare(b.date);
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const hrs = (m) => { const h = m / 60; return Number.isInteger(h) ? String(h) : h.toFixed(1); };
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const I = {
  chev: '<svg class="chev" viewBox="0 0 8 13"><path d="M1.5 1.5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

let saveTimer;
function commit() {
  if (stamp(snap, S)) scheduleSync();
  snap = snapshot(S);
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState(S), 120);
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}
function downloadText(filename, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------------- Derived data ---------------- */
const sortedScores = () => S.scores.slice().sort(byDate);
const upcomingDates = () => {
  const t = todayISO();
  return S.dates.filter((d) => d.date >= t && !['Done', 'Skipped'].includes(d.status)).sort(byDate);
};
function streak() {
  const days = new Set(S.sessions.filter((s) => s.minutes > 0).map((s) => s.date));
  let d = todayISO();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
const progress = (p) => { const total = p.tasks.length, done = p.tasks.filter((t) => t.done).length; return { total, done, pct: total ? done / total : 0 }; };
function currentPhases() {
  const t = todayISO();
  const active = S.phases.filter((p) => p.start <= t && t <= p.end);
  if (active.length) return active;
  const next = S.phases.filter((p) => p.start > t).sort((a, b) => a.start.localeCompare(b.start))[0];
  return next ? [next] : S.phases.slice(-1);
}
const daysLabel = (iso) => {
  const n = daysBetween(todayISO(), iso);
  return n === 0 ? 'Today' : n > 0 ? `${n}` : `${-n}d ago`;
};

/* ---------------- Render helpers ---------------- */
const top = (h, right = '') => `<header class="top"><h1>${h}</h1>${right}</header>`;
const addBtn = (act, label) => `<button class="add" data-act="${act}" aria-label="${label}">${I.plus}</button>`;
const bar = (p, done) => `<div class="bar ${done ? 'done' : ''}"><i style="width:${(clamp01(p) * 100).toFixed(1)}%"></i></div>`;
const statusCls = (s) => String(s).replace(/\s+/g, '-');
function ring(p) {
  const r = 26, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 64 64" class="ring" aria-hidden="true"><circle cx="32" cy="32" r="${r}" class="ring-track"/>
    <circle cx="32" cy="32" r="${r}" class="ring-fill ${p >= 1 ? 'done' : ''}" transform="rotate(-90 32 32)" style="stroke-dasharray:${c.toFixed(2)};stroke-dashoffset:${(c * (1 - clamp01(p))).toFixed(2)}"/></svg>`;
}

/* ================= TODAY ================= */
function viewToday() {
  const t = todayISO(), st = S.settings;
  const next = upcomingDates()[0];
  const ws = weekStart(t), we = addDays(ws, 6);
  const mins = S.sessions.filter((s) => s.date >= ws && s.date <= we).reduce((a, s) => a + s.minutes, 0);
  const goal = st.weeklyHoursGoal * 60;
  const left = daysBetween(t, we) + 1;
  const last = sortedScores().at(-1);
  const str = streak();

  let h = `<div class="label date-line">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>`;
  if (isIOS && !isStandalone && ls.get('hideInstallTip') !== '1') {
    h += `<div class="install-tip"><p>Install: Share → <b>Add to Home Screen</b></p><button class="link" data-act="hide-tip" aria-label="Dismiss">✕</button></div>`;
  }
  if (next) {
    const n = daysBetween(t, next.date);
    h += `<button class="hero" data-act="goto" data-tab="plan" data-sub="dates">
      <div class="hero-num">${n === 0 ? 'Today' : `${n}<small>day${n === 1 ? '' : 's'}</small>`}</div>
      <div class="hero-title">${esc(next.title)}</div>
      <div class="label">${fmtDate(next.date, { weekday: 'short' })}</div>
    </button>`;
  } else h += `<div class="hero"><div class="hero-title muted">No upcoming deadlines</div></div>`;

  h += `<div class="week">${ring(mins / goal)}
    <div style="flex:1"><div class="week-big">${hrs(mins)} <span>of ${st.weeklyHoursGoal} h this week</span></div>
    <div class="label">${mins >= goal ? '<span class="good">Goal reached</span>' : `${hrs(goal - mins)} h to go · ${left} day${left === 1 ? '' : 's'} left`}</div></div>
  </div>`;

  const gap = last ? last.total - st.gmatTarget : null;
  h += `<div class="stats">
    <button class="stat" data-act="goto" data-tab="mocks"><b>${last ? last.total : '—'}</b><span>Latest mock</span></button>
    <button class="stat" data-act="goto" data-tab="mocks"><b class="${gap == null ? '' : gap >= 0 ? 'good' : ''}">${gap == null ? st.gmatTarget : gap >= 0 ? '✓' : signed(gap)}</b><span>${gap == null ? 'Target' : `To ${st.gmatTarget}`}</span></button>
    <div class="stat"><b>${str}</b><span>Day streak</span></div>
  </div>`;

  for (const p of currentPhases()) {
    const pr = progress(p);
    h += `<button class="phase-line" data-act="goto" data-tab="plan" data-sub="phases" data-open="${p.id}">
      <div class="row-top"><span>${esc(p.name)}</span><span class="label num">${pr.done}/${pr.total} tasks</span></div>
      ${bar(pr.pct, pr.pct === 1)}
      <div class="label" style="margin-top:8px">${esc(p.exit)}</div>
    </button>`;
  }

  h += `<div class="gap"></div><button class="btn" data-act="log-session">Log study</button>`;

  const recent = S.sessions.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)).slice(0, 3);
  if (recent.length) {
    h += `<div class="h2">Recent</div><div class="list">${recent.map((s) => `<button class="row" data-act="edit-session" data-id="${s.id}">
      <div class="row-main"><div class="row-title">${esc(s.section)}</div><div class="row-sub">${fmtShort(s.date)}${s.note ? ` · ${esc(s.note)}` : ''}</div></div>
      <div class="row-right muted">${s.minutes} min</div></button>`).join('')}</div>`;
  }
  return h;
}

/* ================= PLAN ================= */
function viewPlan() {
  const addAct = { phases: ['add-phase', 'Add phase'], dates: ['add-date', 'Add date'], months: ['add-month', 'Add monthly checkpoint'] }[planView];
  let h = top('Plan', addBtn(...addAct));
  h += `<div class="seg" role="group" aria-label="Plan view">${[['phases', 'Phases'], ['dates', 'Dates'], ['months', 'Months']]
    .map(([k, l]) => `<button data-act="plan-view" data-v="${k}" aria-pressed="${planView === k}">${l}</button>`).join('')}</div>`;
  return h + (planView === 'phases' ? planPhases() : planView === 'dates' ? planDates() : planMonths());
}

function planPhases() {
  const t = todayISO();
  let h = '<div class="list">';
  for (const p of S.phases) {
    const pr = progress(p);
    const active = p.start <= t && t <= p.end;
    const editing = editingPhases.has(p.id);
    h += `<section class="phase ${p.open ? 'open' : ''}">
      <button class="phase-head" data-act="toggle-phase" data-id="${p.id}" aria-expanded="${!!p.open}">
        <div class="row-main"><div class="row-title">${esc(p.name)}${active ? ' <span class="now xs">· Now</span>' : ''}</div>
        <div class="row-sub">${fmtShort(p.start)} – ${fmtDate(p.end)}</div></div>
        <span class="label num">${pr.done}/${pr.total}</span>${I.chev}
      </button>`;
    if (p.open) {
      h += `<div class="phase-body"><p class="exit">Exit: ${esc(p.exit)}</p>`;
      p.tasks.forEach((tk, k) => {
        h += `<div class="task ${tk.done ? 'done' : ''}">`;
        if (editing) {
          h += `<button class="task-text" data-act="task-edit" data-pid="${p.id}" data-tid="${tk.id}">${esc(tk.text)}</button>
            <button class="icon-btn" data-act="task-move" data-dir="-1" data-pid="${p.id}" data-tid="${tk.id}" aria-label="Move up" ${k === 0 ? 'disabled' : ''}>${I.up}</button>
            <button class="icon-btn" data-act="task-move" data-dir="1" data-pid="${p.id}" data-tid="${tk.id}" aria-label="Move down" ${k === p.tasks.length - 1 ? 'disabled' : ''}>${I.down}</button>
            <button class="icon-btn danger" data-act="task-del" data-pid="${p.id}" data-tid="${tk.id}" aria-label="Delete task">${I.trash}</button>`;
        } else {
          h += `<label class="check"><input type="checkbox" data-change="task-toggle" data-pid="${p.id}" data-tid="${tk.id}" ${tk.done ? 'checked' : ''} aria-label="${esc(tk.text)}"><i></i></label>
            <button class="task-text" data-act="task-edit" data-pid="${p.id}" data-tid="${tk.id}">${esc(tk.text)}</button>`;
        }
        h += `</div>`;
      });
      h += `<form class="add-task" data-form="add-task" data-pid="${p.id}">
          <input name="text" placeholder="Add a task" enterkeyhint="done" autocomplete="off" aria-label="New task">
          <button class="btn" type="submit">Add</button></form>
        <div class="phase-links"><button class="link" data-act="phase-edit-mode" data-id="${p.id}">${editing ? 'Done' : 'Reorder'}</button>
        <button class="link" data-act="edit-phase" data-id="${p.id}">Edit phase</button></div></div>`;
    }
    h += `</section>`;
  }
  return h + '</div>';
}

function planDates() {
  const t = todayISO();
  const all = S.dates.slice().sort(byDate);
  const row = (d) => {
    const finished = ['Done', 'Skipped'].includes(d.status);
    const n = daysBetween(t, d.date);
    return `<button class="row ${finished ? 'dim' : ''}" data-act="edit-date" data-id="${d.id}">
      <div class="row-main"><div class="row-title">${esc(d.title)}</div>
      <div class="row-sub">${fmtDate(d.date)} · ${esc(d.tag)}${d.optional ? ' · optional' : ''}${d.status !== 'Upcoming' ? ` · ${esc(d.status)}` : ''}</div></div>
      <div class="row-right">${n >= 0 ? `<b class="${n <= 7 && !finished ? 'warn' : ''}">${n === 0 ? 'Today' : n}</b><span class="xs faint">${n === 0 ? '' : 'days'}</span>` : `<span class="xs faint">${daysLabel(d.date)}</span>`}</div>
    </button>`;
  };
  const upcoming = all.filter((d) => d.date >= t), past = all.filter((d) => d.date < t).reverse();
  let h = `<div class="list">${upcoming.map(row).join('') || '<div class="empty">Nothing upcoming.</div>'}</div>`;
  h += `<div style="margin-top:12px"><button class="link" data-act="ics-all">${'Add all to Calendar'}</button></div>`;
  if (past.length) h += `<div class="h2">Past</div><div class="list">${past.map(row).join('')}</div>`;
  return h;
}

function planMonths() {
  const ym = todayISO().slice(0, 7);
  return `<div class="list">${S.checkpoints.slice().sort((a, b) => a.month.localeCompare(b.month)).map((c) => `
    <div class="row">
      <button class="row-main row-btn" data-act="edit-month" data-id="${c.id}" style="min-height:44px">
        <div class="row-title">${fmtMonth(c.month)}${c.month === ym ? ' <span class="now xs">· This month</span>' : ''}</div>
        <div class="row-sub">${esc(c.text)}</div>
        ${c.month < ym && !['Done', 'Missed'].includes(c.status) ? '<div class="xs warn" style="margin-top:4px">Month ended — update status</div>' : ''}
      </button>
      <button class="status-btn" data-act="cycle-month" data-id="${c.id}" aria-label="Status ${c.status}, tap to change"><span class="dot ${statusCls(c.status)}"></span>${c.status}</button>
    </div>`).join('')}</div>`;
}

/* ================= MOCKS ================= */
function viewMocks() {
  const st = S.settings;
  const A = analyze(S.scores, st, S.scoreCheckpoints, todayISO());
  let h = top('Mocks', addBtn('add-score', 'Log mock'));

  if (A.n) {
    h += `<div class="mock-hero"><div class="hero-num num">${A.latest.total}</div>
      ${A.delta != null ? `<div class="delta ${A.delta >= 0 ? 'good' : 'bad'}">${signed(A.delta)}</div>` : ''}
      <div class="label">Latest · avg of last ${Math.min(3, A.n)}: ${A.avg3} · best ${A.best.total} · target ${st.gmatTarget}</div></div>`;
  } else {
    h += `<p class="muted" style="margin:0">Log each practice test here. After a few, you'll get a projection and section-by-section analysis.</p>
      <div class="gap"></div><button class="btn" data-act="add-score">Log your first mock</button>`;
  }

  h += `<div class="chart-wrap" id="chart"><div class="chart-head"><span class="label">${chartMode === 'total' ? 'Total score' : 'Section scores'}</span>
    <div class="seg small" role="group" aria-label="Chart">${[['total', 'Total'], ['sections', 'Sections']].map(([k, l]) => `<button data-act="chart-mode" data-v="${k}" aria-pressed="${chartMode === k}">${l}</button>`).join('')}</div></div>
    ${scoreChart({ scores: A.list || [], target: st.gmatTarget, min: st.gmatMin, checkpoints: S.scoreCheckpoints, start: S.phases[0]?.start, mode: chartMode })}
    <div class="readout" id="readout">${A.n ? 'Tap the chart to see a mock' : ''}</div>
    <div class="legend">${chartMode === 'total'
      ? `<span><i class="dash" style="color:var(--target)"></i>Target</span><span><i class="dash" style="color:var(--min)"></i>Minimum</span><span><i class="hollow"></i>Unofficial mock</span><span>◇ Checkpoint</span>`
      : SECTIONS.map((s, i) => `<span><i style="color:var(--s${i + 1})"></i>${s.label}</span>`).join('')}</div>
  </div>`;

  if (!A.n) return h;

  h += `<div class="h2">Insights</div><ul class="insights">${A.insights.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;

  const anyAcc = A.sections.some((s) => s.accuracy != null), anyPace = A.sections.some((s) => s.secPerQ != null);
  h += `<div class="h2">Sections <span class="faint xs" style="font-weight:400">last 3 mocks</span></div>
    <div class="card" style="margin-top:0"><table class="sec-table"><thead><tr><th></th><th>Latest</th><th>Avg</th><th>Change</th>${anyAcc ? '<th>Right</th>' : ''}${anyPace ? '<th>Per Q</th>' : ''}</tr></thead><tbody>
    ${A.sections.map((s, i) => `<tr><td><span class="key" style="background:var(--s${i + 1})"></span>${s.label}</td>
      <td>${s.latest ?? '—'}</td><td>${s.avg3 == null ? '—' : Math.round(s.avg3)}</td>
      <td class="${s.change > 0 ? 'good' : s.change < 0 ? 'bad' : ''}">${s.change == null ? '—' : signed(s.change)}</td>
      ${anyAcc ? `<td>${s.accuracy == null ? '—' : `${Math.round(s.accuracy * 100)}%`}</td>` : ''}
      ${anyPace ? `<td>${fmtPace(s.secPerQ)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>
    ${anyPace ? `<div class="hint">Time budget per question: Q ${fmtPace((SECTION_MINUTES * 60) / 21)} · V ${fmtPace((SECTION_MINUTES * 60) / 23)} · DI ${fmtPace((SECTION_MINUTES * 60) / 20)}</div>` : ''}`;

  if (A.errorTotal) {
    const max = Math.max(...A.errors.map((e) => e.n));
    h += `<div class="h2">Mistakes <span class="faint xs" style="font-weight:400">last 5 mocks</span></div>
      <div class="card" style="margin-top:0">${A.errors.map((e) => `<div class="err-row"><span>${e.label}</span>${bar(e.n / max)}<span>${e.n}</span></div>`).join('')}</div>`;
  }

  h += `<div class="h2">History</div><div class="list">`;
  const desc = A.list.slice().reverse();
  h += desc.map((s, i) => {
    const prev = desc[i + 1];
    const d = prev ? s.total - prev.total : null;
    const secs = SECTIONS.filter((k) => s[k.key] != null).map((k) => `${k.short} ${s[k.key]}`).join(' · ');
    return `<button class="row" data-act="edit-score" data-id="${s.id}">
      <div class="row-main"><div class="row-title">${esc(s.source || 'Mock')}${s.official ? '' : ' <span class="faint xs">· unofficial</span>'}</div>
      <div class="row-sub">${fmtDate(s.date)}${secs ? ` · ${secs}` : ''}</div></div>
      <div class="row-right"><b>${s.total}</b>${d != null ? `<span class="xs ${d >= 0 ? 'good' : 'bad'}">${signed(d)}</span>` : ''}</div></button>`;
  }).join('');
  return h + '</div>';
}

function wireMocks() {
  const el = $('#chart');
  if (!el) return;
  const list = sortedScores();
  bindChart(el, (i) => {
    const r = $('#readout');
    if (i == null) { r.textContent = 'Tap the chart to see a mock'; return; }
    const s = list[i];
    const secs = SECTIONS.filter((k) => s[k.key] != null).map((k) => `${k.short} ${s[k.key]}`).join(' · ');
    r.textContent = `${fmtShort(s.date)} · ${s.source || 'Mock'} · ${s.total}${secs ? ` (${secs})` : ''}`;
  });
}

/* ================= SETTINGS ================= */
function viewSettings() {
  const st = S.settings, t = todayISO();
  let h = top('Settings');

  const theme = ls.get('theme') || 'auto';
  h += `<div class="h2" style="margin-top:0">Appearance</div>
    <div class="seg theme-seg" role="group" aria-label="Appearance">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]
      .map(([k, l]) => `<button data-act="theme" data-v="${k}" aria-pressed="${theme === k}">${l}</button>`).join('')}</div>`;

  h += `<div class="h2">Targets</div><div class="list">`;
  h += [
    ['GMAT target', st.gmatTarget], ['GMAT minimum', st.gmatMin],
    ['Weekly study', `${st.weeklyHoursMin}–${st.weeklyHoursGoal} h`],
    ['First attempt by', fmtDate(st.firstAttempt)], ['Final score by', fmtDate(st.finalScoreBy)], ['Programme', esc(st.program)],
  ].map(([k, v]) => `<button class="row" data-act="edit-targets"><div class="row-main row-title">${k}</div><div class="row-right muted" style="max-width:55%">${v}</div></button>`).join('');
  h += `</div>`;

  h += `<div class="h2">Score checkpoints <button class="link" data-act="add-cp">Add</button></div><div class="list">`;
  h += S.scoreCheckpoints.slice().sort(byDate).map((c) => {
    const met = S.scores.some((s) => s.date <= c.date && s.total >= c.score);
    return `<button class="row" data-act="edit-cp" data-id="${c.id}"><div class="row-main row-title">${c.score} by ${fmtDate(c.date)}</div>
      <div class="row-right xs ${met ? 'good' : t > c.date ? 'bad' : 'faint'}">${met ? 'Met' : t > c.date ? 'Missed' : `${daysBetween(t, c.date)} days`}</div></button>`;
  }).join('') || '<div class="empty">None</div>';
  h += `</div>`;

  h += `<div class="h2">My goals <button class="link" data-act="add-goal">Add</button></div>`;
  h += S.goals.length
    ? `<div class="list">${S.goals.map((g) => {
        const p = Number(g.target) ? Number(g.current || 0) / Number(g.target) : 0;
        return `<button class="row" style="display:block" data-act="edit-goal" data-id="${g.id}">
          <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px"><span class="row-title">${esc(g.name)}</span><span class="muted num small">${esc(g.current ?? 0)}/${esc(g.target)} ${esc(g.unit || '')}</span></div>
          ${bar(p, p >= 1)}${g.deadline ? `<div class="xs faint" style="margin-top:6px">Due ${fmtDate(g.deadline)}</div>` : ''}</button>`;
      }).join('')}</div>`
    : `<p class="label" style="margin:0">e.g. “Official practice exams taken: 0 / 6”.</p>`;

  // Sync
  const cfg = syncCfg();
  h += `<div class="h2">Sync between devices</div>`;
  if (cfg?.token) {
    h += `<div class="list"><div class="row"><div class="row-main"><div class="row-title">${syncing ? 'Syncing…' : cfg.error ? '<span class="bad">Not synced</span>' : 'Synced'}</div>
      <div class="row-sub">${cfg.error ? esc(cfg.error) : cfg.lastSync ? `Last synced ${ago(cfg.lastSync)} · ${esc(cfg.repo)}` : esc(cfg.repo)}</div></div></div></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn ghost" data-act="sync-now">Sync now</button><button class="btn ghost" data-act="sync-setup">Change</button></div>
      <button class="link" data-act="sync-off" style="margin-top:4px">Turn off sync on this device</button>`;
  } else {
    h += `<p class="label" style="margin:0 0 12px">Edit on your laptop and phone, with changes synced through a private GitHub repository you own. Optional.</p>
      <button class="btn ghost" data-act="sync-setup">Set up sync</button>`;
  }

  h += `<div class="h2">Backup</div>
    <p class="label" style="margin:0 0 12px">Last export: ${S.lastBackup ? fmtDate(S.lastBackup.slice(0, 10)) : 'never'}${S.lastBackup && daysBetween(S.lastBackup.slice(0, 10), t) > 14 ? ' — <span class="warn">due for a new one</span>' : ''}.
    ${cfg?.token ? '' : 'iOS can clear website data, so export now and then.'}</p>
    <div class="btn-row"><button class="btn ghost" data-act="export">Export</button><button class="btn ghost" data-act="import">Import</button></div>
    <div class="gap"></div><button class="btn danger" data-act="reset">Reset to default plan</button>
    <p class="xs faint" style="text-align:center;margin-top:16px">MBA Tracker ${APP_VERSION}</p>`;
  return h;
}

const ago = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(new Date(ms).toISOString().slice(0, 10));
};

const VIEWS = { today: viewToday, plan: viewPlan, mocks: viewMocks, settings: viewSettings };
function render() {
  $('#view').innerHTML = VIEWS[tab]();
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  if (tab === 'mocks') wireMocks();
}
function setTab(next) {
  if (!VIEWS[next]) return;
  tab = next;
  ls.set('tab', tab);
  render();
  window.scrollTo(0, 0);
}

/* ================= Sheets ================= */
function fieldHTML(f, v) {
  if (f.type === 'heading') return `<div class="form-head ${f.adv ? 'field adv' : ''}" ${f.adv ? 'hidden' : ''}>${esc(f.label)}</div>`;
  const val = v ?? '';
  const id = `f-${f.name}`;
  const cls = `field${f.span ? ` ${f.span}` : ''}${f.adv ? ' adv' : ''}`;
  const hid = f.adv ? ' hidden' : '';
  const common = `id="${id}" name="${f.name}" class="input"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}`;
  let control;
  switch (f.type) {
    case 'select': control = `<select ${common}>${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
    case 'textarea': control = `<textarea ${common} rows="3">${esc(val)}</textarea>`; break;
    case 'date': control = `<input type="date" ${common} value="${esc(val)}">`; break;
    case 'month': control = `<input type="month" ${common} value="${esc(val)}">`; break;
    case 'int': control = `<input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ${common} value="${esc(val)}">`; break;
    case 'num': control = `<input type="text" inputmode="decimal" autocomplete="off" ${common} value="${esc(val)}">`; break;
    case 'password': control = `<input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" ${common} value="${esc(val)}">`; break;
    case 'switch':
      return `<div class="${cls}"${hid}><div class="toggle"><label for="${id}">${esc(f.label)}</label><span class="switch"><input type="checkbox" id="${id}" name="${f.name}" ${val ? 'checked' : ''}><i></i></span></div></div>`;
    default:
      control = `<input type="text" autocomplete="off" autocapitalize="${f.noCaps ? 'off' : 'sentences'}" ${f.list ? `list="${id}-list"` : ''} ${common} value="${esc(val)}">${f.list ? `<datalist id="${id}-list">${f.list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>` : ''}`;
  }
  const quick = f.quick ? `<div class="quick">${f.quick.map((q) => `<button type="button" data-quick="${f.name}" data-v="${q}">${q}</button>`).join('')}</div>` : '';
  return `<div class="${cls}"${hid}><label class="lbl" for="${id}">${esc(f.label)}</label>${control}${quick}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}
function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el || f.type === 'heading') continue;
    if (f.type === 'switch') out[f.name] = el.checked;
    else if (f.type === 'int' || f.type === 'num') { const raw = el.value.trim().replace(',', '.'); out[f.name] = raw === '' ? null : Number(raw); }
    else out[f.name] = el.value.trim();
  }
  return out;
}

let sheetOpen = false;
function openSheet({ heading, intro = '', fields, values = {}, validate, onSave, onDelete, deleteLabel = 'Delete', extra = [], moreLabel, saveLabel = 'Save' }) {
  const root = $('#sheet');
  const hasAdv = fields.some((f) => f.adv);
  const advFilled = fields.some((f) => f.adv && values[f.name] != null && values[f.name] !== '');
  root.innerHTML = `<div class="backdrop" data-close></div>
    <form class="sheet" novalidate role="dialog" aria-modal="true" aria-label="${esc(heading)}">
      <div class="sheet-head"><button type="button" class="link" data-close>Cancel</button><h2>${esc(heading)}</h2><button type="submit" class="link save">${saveLabel}</button></div>
      <div class="sheet-body">${intro}
        <div class="form-grid">${fields.map((f) => fieldHTML(f, values[f.name])).join('')}
          ${hasAdv ? `<button type="button" class="link more-btn" data-more>${moreLabel || 'More details'}</button>` : ''}</div>
        <p class="form-error" hidden></p>
        <div class="sheet-actions">
          ${extra.map((x, i) => `<button type="button" class="btn ghost" data-extra="${i}">${x.label}</button>`).join('')}
          ${onDelete ? `<button type="button" class="btn danger" data-delete>${esc(deleteLabel)}</button>` : ''}
        </div>
      </div>
    </form>`;
  const form = $('form', root), err = $('.form-error', root), save = $('.save', root);
  const showAdv = () => { form.querySelectorAll('.adv').forEach((e) => (e.hidden = false)); $('[data-more]', root)?.remove(); };
  if (advFilled) showAdv();
  root.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => root.classList.add('open'));
  sheetOpen = true;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = readForm(form, fields);
    form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    save.disabled = true;
    let problem;
    try { problem = await validate?.(v); } finally { save.disabled = false; }
    if (problem) {
      const [name, msg] = Array.isArray(problem) ? problem : [null, problem];
      err.textContent = msg;
      err.hidden = false;
      const el = name && form.elements[name];
      if (el) { if (el.closest('.adv')) showAdv(); el.classList.add('invalid'); el.focus(); }
      return;
    }
    closeSheet();
    await onSave(v);
    commit();
  });
  root.onclick = (e) => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-more]')) return showAdv();
    const q = e.target.closest('[data-quick]');
    if (q) form.elements[q.dataset.quick].value = q.dataset.v;
    if (e.target.closest('[data-delete]') && confirm(`${deleteLabel}? This cannot be undone.`)) { onDelete(); closeSheet(); commit(); }
    const x = e.target.closest('[data-extra]');
    if (x) extra[+x.dataset.extra].run(readForm(form, fields));
  };
}
function closeSheet() {
  const root = $('#sheet');
  root.classList.remove('open');
  root.setAttribute('aria-hidden', 'true');
  sheetOpen = false;
  setTimeout(() => { if (!sheetOpen) root.innerHTML = ''; }, 350);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetOpen) closeSheet(); });

/* ---------------- Validation ---------------- */
const needDate = (v, name = 'date') => (!isValidISO(v[name]) ? [name, 'Please choose a date.'] : null);
const isInt = Number.isInteger;
const intIn = (v, k, lo, hi, msg) => (v[k] != null && (!isInt(v[k]) || v[k] < lo || v[k] > hi) ? [k, msg] : null);

function validateMock(v) {
  if (needDate(v)) return needDate(v);
  if (v.total == null || !isInt(v.total) || v.total < 205 || v.total > 805 || (v.total - 205) % 10 !== 0)
    return ['total', 'Total must be 205–805 in 10-point steps (it always ends in 5, e.g. 655, 715).'];
  for (const s of SECTIONS) {
    const p = intIn(v, s.key, 60, 90, `${s.label} must be a whole number from 60 to 90.`)
      || intIn(v, `${s.key}Correct`, 0, s.q, `${s.label} correct must be 0–${s.q}.`)
      || intIn(v, `${s.key}Time`, 0, SECTION_MINUTES, `${s.label} time must be 0–${SECTION_MINUTES} minutes.`);
    if (p) return p;
  }
  for (const e of ERRORS) { const p = intIn(v, e.key, 0, 99, `${e.label} mistakes must be a whole number.`); if (p) return p; }
  return null;
}

/* ---------------- Forms ---------------- */
function sessionSheet(s) {
  openSheet({
    heading: s ? 'Edit session' : 'Log study',
    fields: [
      { name: 'minutes', label: 'Minutes', type: 'int', placeholder: 'e.g. 90', quick: [30, 45, 60, 90, 120] },
      { name: 'section', label: 'Section', type: 'select', options: STUDY_SECTIONS, span: 'half' },
      { name: 'date', label: 'Date', type: 'date', span: 'half' },
      { name: 'note', label: 'Note', type: 'textarea', placeholder: 'Optional' },
    ],
    values: s || { date: todayISO(), section: ls.get('lastSection') || 'Quant' },
    validate: (v) => needDate(v) || (!isInt(v.minutes) || v.minutes < 1 || v.minutes > 960 ? ['minutes', 'Minutes must be a whole number from 1 to 960.'] : null),
    onSave: (v) => {
      ls.set('lastSection', v.section);
      if (s) Object.assign(s, v); else S.sessions.push({ id: uid(), created: Date.now(), ...v });
      toast(s ? 'Session updated' : `Logged ${v.minutes} min`);
    },
    onDelete: s ? () => { S.sessions = S.sessions.filter((x) => x !== s); } : null,
  });
}

function mockSheet(s) {
  const detail = SECTIONS.flatMap((sec) => [
    { type: 'heading', label: sec.label, adv: true },
    { name: `${sec.key}Correct`, label: `Correct (of ${sec.q})`, type: 'int', span: 'half', adv: true },
    { name: `${sec.key}Time`, label: 'Time used (min)', type: 'int', span: 'half', adv: true, placeholder: `≤ ${SECTION_MINUTES}` },
  ]);
  openSheet({
    heading: s ? 'Edit mock' : 'Log mock',
    fields: [
      { name: 'total', label: 'Total score', type: 'int', placeholder: 'e.g. 655', hint: '205–805, always ends in 5' },
      { name: 'quant', label: 'Quant', type: 'int', span: 'third', placeholder: '60–90' },
      { name: 'verbal', label: 'Verbal', type: 'int', span: 'third', placeholder: '60–90' },
      { name: 'di', label: 'Data Ins.', type: 'int', span: 'third', placeholder: '60–90' },
      { name: 'source', label: 'Test', list: MOCK_SOURCES, placeholder: 'Official Practice Exam 1' },
      { name: 'date', label: 'Date', type: 'date', span: 'half' },
      { name: 'official', label: 'Official exam', type: 'switch', span: 'half' },
      ...detail,
      { type: 'heading', label: 'Mistakes by type', adv: true },
      { name: 'errConcept', label: 'Concept', type: 'int', span: 'third', adv: true },
      { name: 'errCareless', label: 'Careless', type: 'int', span: 'third', adv: true },
      { name: 'errTiming', label: 'Timing', type: 'int', span: 'third', adv: true },
      { name: 'note', label: 'Notes', type: 'textarea', adv: true, placeholder: 'What went wrong, what to fix' },
    ],
    moreLabel: 'Add accuracy, timing & mistakes',
    values: s || { date: todayISO(), official: true },
    validate: validateMock,
    onSave: (v) => {
      if (v.source && !s && /^official/i.test(v.source)) v.official = true;
      if (s) Object.assign(s, v); else S.scores.push({ id: uid(), ...v });
      toast(s ? 'Mock updated' : `Mock ${v.total} saved`);
    },
    onDelete: s ? () => { S.scores = S.scores.filter((x) => x !== s); } : null,
  });
}

function scoreCpSheet(c) {
  openSheet({
    heading: c ? 'Edit checkpoint' : 'Add checkpoint',
    fields: [{ name: 'score', label: 'Score', type: 'int', span: 'half' }, { name: 'date', label: 'By date', type: 'date', span: 'half' }],
    values: c || {},
    validate: (v) => (!isInt(v.score) || v.score < 205 || v.score > 805 ? ['score', 'Score must be 205–805.'] : null) || needDate(v),
    onSave: (v) => { if (c) Object.assign(c, v); else S.scoreCheckpoints.push({ id: uid(), ...v }); },
    onDelete: c ? () => { S.scoreCheckpoints = S.scoreCheckpoints.filter((x) => x !== c); } : null,
  });
}

function phaseSheet(p) {
  openSheet({
    heading: p ? 'Edit phase' : 'Add phase',
    fields: [
      { name: 'name', label: 'Name' },
      { name: 'start', label: 'Start', type: 'date', span: 'half' },
      { name: 'end', label: 'End', type: 'date', span: 'half' },
      { name: 'exit', label: 'Exit target', type: 'textarea' },
    ],
    values: p || { start: todayISO(), end: addDays(todayISO(), 30) },
    validate: (v) => (!v.name ? ['name', 'Please enter a name.'] : null) || needDate(v, 'start') || needDate(v, 'end') || (v.end < v.start ? ['end', 'End must be after start.'] : null),
    onSave: (v) => { if (p) Object.assign(p, v); else S.phases.push({ id: uid(), open: true, tasks: [], ...v }); },
    onDelete: p ? () => { S.phases = S.phases.filter((x) => x !== p); } : null,
    deleteLabel: 'Delete phase',
  });
}

function taskSheet(p, tk) {
  openSheet({
    heading: 'Edit task',
    fields: [{ name: 'text', label: 'Task', type: 'textarea' }, { name: 'done', label: 'Done', type: 'switch' }],
    values: tk,
    validate: (v) => (!v.text ? ['text', 'Task cannot be empty.'] : null),
    onSave: (v) => Object.assign(tk, v),
    onDelete: () => { p.tasks = p.tasks.filter((x) => x !== tk); },
    deleteLabel: 'Delete task',
  });
}

function dateSheet(d) {
  openSheet({
    heading: d ? 'Edit date' : 'Add date',
    fields: [
      { name: 'title', label: 'Title' },
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'tag', label: 'Tag', type: 'select', options: TAGS, span: 'half' },
      { name: 'status', label: 'Status', type: 'select', options: DATE_STATUSES, span: 'half' },
      { name: 'optional', label: 'Optional', type: 'switch' },
      { name: 'note', label: 'Note', type: 'textarea' },
    ],
    values: d || { date: todayISO(), tag: 'Personal', status: 'Upcoming' },
    validate: (v) => (!v.title ? ['title', 'Please enter a title.'] : null) || needDate(v),
    onSave: (v) => { if (d) Object.assign(d, v); else S.dates.push({ id: uid(), ...v }); },
    onDelete: d ? () => { S.dates = S.dates.filter((x) => x !== d); } : null,
    extra: d ? [{ label: `${I.cal}Add to Calendar`, run: (v) => exportICS([{ ...d, ...v }]) }] : [],
  });
}

function targetsSheet() {
  openSheet({
    heading: 'Targets',
    fields: [
      { name: 'gmatTarget', label: 'GMAT target', type: 'int', span: 'half' },
      { name: 'gmatMin', label: 'GMAT minimum', type: 'int', span: 'half' },
      { name: 'weeklyHoursGoal', label: 'Weekly goal (h)', type: 'num', span: 'half' },
      { name: 'weeklyHoursMin', label: 'Weekly min (h)', type: 'num', span: 'half' },
      { name: 'firstAttempt', label: 'First attempt by', type: 'date', span: 'half' },
      { name: 'finalScoreBy', label: 'Final score by', type: 'date', span: 'half' },
      { name: 'program', label: 'Programme / round' },
    ],
    values: S.settings,
    validate: (v) =>
      intIn(v, 'gmatTarget', 205, 805, 'Target must be 205–805.') || (v.gmatTarget == null ? ['gmatTarget', 'Target is required.'] : null) ||
      intIn(v, 'gmatMin', 205, 805, 'Minimum must be 205–805.') || (v.gmatMin == null ? ['gmatMin', 'Minimum is required.'] : null) ||
      (!(v.weeklyHoursGoal > 0) || v.weeklyHoursGoal > 100 ? ['weeklyHoursGoal', 'Weekly goal must be 0–100 hours.'] : null) ||
      (v.weeklyHoursMin == null || v.weeklyHoursMin < 0 || v.weeklyHoursMin > 100 ? ['weeklyHoursMin', 'Weekly minimum must be 0–100 hours.'] : null) ||
      needDate(v, 'firstAttempt') || needDate(v, 'finalScoreBy'),
    onSave: (v) => Object.assign(S.settings, v),
  });
}

function goalSheet(g) {
  openSheet({
    heading: g ? 'Edit goal' : 'New goal',
    fields: [
      { name: 'name', label: 'Goal', placeholder: 'e.g. Official practice exams taken' },
      { name: 'current', label: 'Current', type: 'num', span: 'third' },
      { name: 'target', label: 'Target', type: 'num', span: 'third' },
      { name: 'unit', label: 'Unit', span: 'third', placeholder: 'exams' },
      { name: 'deadline', label: 'Deadline (optional)', type: 'date' },
    ],
    values: g || { current: 0 },
    validate: (v) =>
      (!v.name ? ['name', 'Please name your goal.'] : null) ||
      (v.target == null || isNaN(v.target) || v.target <= 0 ? ['target', 'Target must be a number above 0.'] : null) ||
      (v.current != null && isNaN(v.current) ? ['current', 'Current must be a number.'] : null) ||
      (v.deadline && !isValidISO(v.deadline) ? ['deadline', 'Invalid date.'] : null),
    onSave: (v) => { if (g) Object.assign(g, v); else S.goals.push({ id: uid(), ...v }); },
    onDelete: g ? () => { S.goals = S.goals.filter((x) => x !== g); } : null,
  });
}

function monthSheet(c) {
  openSheet({
    heading: c ? fmtMonth(c.month) : 'Add checkpoint',
    fields: [
      { name: 'month', label: 'Month', type: 'month', placeholder: 'YYYY-MM' },
      { name: 'text', label: 'Must be true by month end', type: 'textarea' },
      { name: 'status', label: 'Status', type: 'select', options: CP_STATUSES },
    ],
    values: c || { month: todayISO().slice(0, 7), status: 'Not started' },
    validate: (v) => (!/^\d{4}-\d{2}$/.test(v.month) ? ['month', 'Month must look like 2027-03.'] : null) || (!v.text ? ['text', 'Please describe the checkpoint.'] : null),
    onSave: (v) => { if (c) Object.assign(c, v); else S.checkpoints.push({ id: uid(), ...v }); },
    onDelete: c ? () => { S.checkpoints = S.checkpoints.filter((x) => x !== c); } : null,
  });
}

/* ================= Sync ================= */
const SYNC_KEY = 'mba-sync';
const syncCfg = () => { try { return JSON.parse(ls.get(SYNC_KEY) || 'null'); } catch { return null; } };
const setSyncCfg = (c) => (c ? ls.set(SYNC_KEY, JSON.stringify(c)) : ls.del(SYNC_KEY));
let syncing = false, syncAgain = false, syncTimer;

function scheduleSync(delay = 4000) {
  if (!syncCfg()?.token) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

async function runSync({ manual = false } = {}) {
  const cfg = syncCfg();
  if (!cfg?.token) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  if (tab === 'settings') render();
  try {
    const before = S;
    const { state } = await syncOnce(cfg, S);
    if (S !== before) { syncAgain = true; return; } // edited mid-sync; go again
    const changed = !sameData(state, S);
    S = normalizeState(state);
    snap = snapshot(S);
    await saveState(S);
    Object.assign(cfg, { lastSync: Date.now(), error: null });
    if (manual) toast(changed ? 'Synced — updated from your other device' : 'Up to date');
    if (changed && !sheetOpen) { setSyncCfg(cfg); syncing = false; render(); return; }
  } catch (e) {
    cfg.error = e.message;
    if (manual) toast(e.message);
  } finally {
    setSyncCfg(cfg);
    syncing = false;
    if (tab === 'settings' && !sheetOpen) render();
    if (syncAgain) { syncAgain = false; scheduleSync(500); }
  }
}

function syncSetupSheet() {
  const cfg = syncCfg() || {};
  openSheet({
    heading: 'Sync',
    saveLabel: 'Connect',
    intro: `<div class="note">One-time setup on GitHub (free):
      <ol><li>Create a <b>private</b> repository, e.g. <b>mba-tracker-data</b>.</li>
      <li>Settings → Developer settings → <b>Fine-grained tokens</b> → Generate. Repository access: only that repo. Permissions: <b>Contents → Read and write</b>.</li>
      <li>Paste the repo and token below. Do the same on your other device.</li></ol></div>`,
    fields: [
      { name: 'repo', label: 'Repository', placeholder: 'username/mba-tracker-data', noCaps: true },
      { name: 'token', label: 'Access token', type: 'password', placeholder: 'github_pat_…', hint: 'Stored only on this device. Never included in exports.' },
    ],
    values: { repo: cfg.repo || '', token: cfg.token || '' },
    validate: async (v) => {
      if (!v.repo) return ['repo', 'Enter the repository, e.g. username/mba-tracker-data.'];
      if (!v.token) return ['token', 'Paste your access token.'];
      try { v.repo = await checkRepo(v); } catch (e) { return [e.status === 401 || e.status === 403 ? 'token' : 'repo', e.message]; }
      return null;
    },
    onSave: async (v) => {
      const fresh = !cfg.lastSync || cfg.repo !== v.repo;
      const next = { repo: v.repo, token: v.token, lastSync: null, error: null };
      setSyncCfg(next);
      if (fresh) {
        try {
          const remote = await pull(next);
          if (remote?.data && confirm('Found data synced from another device.\n\nOK = use that data on this device (recommended for a new device).\nCancel = merge it with what is on this device.')) {
            S = normalizeState(remote.data);
            snap = snapshot(S);
            await saveState(S);
          }
        } catch (e) { toast(e.message); }
      }
      await runSync({ manual: true });
    },
  });
}

/* ================= Export / import ================= */
function exportICS(dates) {
  const name = dates.length === 1 ? `${dates[0].title.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 40)}.ics` : 'mba-tracker-dates.ics';
  downloadText(name, 'text/calendar;charset=utf-8', buildICS(dates));
  toast(dates.length === 1 ? 'Calendar file ready — open it to add' : `${dates.length} dates exported`);
}
async function exportJSON() {
  S.lastBackup = new Date().toISOString();
  const text = JSON.stringify({ app: 'mba-tracker', exportedAt: S.lastBackup, ...S }, null, 2);
  const name = `mba-tracker-backup-${todayISO()}.json`;
  try {
    const file = new File([text], name, { type: 'application/json' });
    if (isIOS && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'MBA Tracker backup' });
    else downloadText(name, 'application/json', text);
    commit();
    toast('Backup exported');
  } catch (e) {
    if (e?.name !== 'AbortError') { downloadText(name, 'application/json', text); commit(); }
  }
}
function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !Array.isArray(data.phases) || !Array.isArray(data.dates)) throw new Error('shape');
      if (!confirm(`Replace all current data with this backup?\n\n${(data.sessions || []).length} sessions, ${(data.scores || []).length} mocks, ${data.phases.length} phases`)) return;
      delete data.app;
      delete data.exportedAt;
      const keepDeleted = S.deleted;
      S = normalizeState(data);
      S.deleted = { ...keepDeleted, ...S.deleted };
      commit();
      toast('Backup imported');
    } catch {
      alert('That file is not a valid MBA Tracker backup.');
    }
  };
  reader.readAsText(file);
}

/* ================= Events ================= */
const find = (arr, id) => arr.find((x) => x.id === id);
const ACTIONS = {
  goto: (d) => {
    if (d.sub) planView = d.sub;
    if (d.open) { const p = find(S.phases, d.open); if (p) p.open = true; saveState(S); }
    setTab(d.tab);
  },
  'hide-tip': () => { ls.set('hideInstallTip', '1'); render(); },
  'plan-view': (d) => { planView = d.v; ls.set('planView', d.v); render(); },
  'chart-mode': (d) => { chartMode = d.v; render(); },
  'log-session': () => sessionSheet(),
  'edit-session': (d) => sessionSheet(find(S.sessions, d.id)),
  'toggle-phase': (d) => { const p = find(S.phases, d.id); p.open = !p.open; commit(); },
  'phase-edit-mode': (d) => { editingPhases.has(d.id) ? editingPhases.delete(d.id) : editingPhases.add(d.id); render(); },
  'edit-phase': (d) => phaseSheet(find(S.phases, d.id)),
  'add-phase': () => phaseSheet(),
  'task-edit': (d) => { const p = find(S.phases, d.pid); taskSheet(p, find(p.tasks, d.tid)); },
  'task-move': (d) => {
    const p = find(S.phases, d.pid);
    const i = p.tasks.findIndex((t) => t.id === d.tid), j = i + Number(d.dir);
    if (j < 0 || j >= p.tasks.length) return;
    [p.tasks[i], p.tasks[j]] = [p.tasks[j], p.tasks[i]];
    commit();
  },
  'task-del': (d) => {
    const p = find(S.phases, d.pid), tk = find(p.tasks, d.tid);
    if (confirm(`Delete “${tk.text}”?`)) { p.tasks = p.tasks.filter((t) => t !== tk); commit(); }
  },
  'add-score': () => mockSheet(),
  'edit-score': (d) => mockSheet(find(S.scores, d.id)),
  'add-cp': () => scoreCpSheet(),
  'edit-cp': (d) => scoreCpSheet(find(S.scoreCheckpoints, d.id)),
  'add-date': () => dateSheet(),
  'edit-date': (d) => dateSheet(find(S.dates, d.id)),
  'ics-all': () => {
    const list = upcomingDates();
    if (!list.length) return toast('No upcoming dates to export');
    exportICS(list);
  },
  'edit-targets': () => targetsSheet(),
  'add-goal': () => goalSheet(),
  'edit-goal': (d) => goalSheet(find(S.goals, d.id)),
  'add-month': () => monthSheet(),
  'edit-month': (d) => monthSheet(find(S.checkpoints, d.id)),
  'cycle-month': (d) => { const c = find(S.checkpoints, d.id); c.status = CP_STATUSES[(CP_STATUSES.indexOf(c.status) + 1) % CP_STATUSES.length]; commit(); },
  theme: (d) => {
    if (d.v === 'auto') { ls.del('theme'); delete document.documentElement.dataset.theme; }
    else { ls.set('theme', d.v); document.documentElement.dataset.theme = d.v; }
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    metas[0].content = d.v === 'dark' ? '#141922' : '#f5f4f0';
    metas[1].content = d.v === 'light' ? '#f5f4f0' : '#141922';
    render();
  },
  'sync-setup': () => syncSetupSheet(),
  'sync-now': () => runSync({ manual: true }),
  'sync-off': () => {
    if (!confirm('Turn off sync on this device? Your data stays here and in the repository.')) return;
    setSyncCfg(null);
    render();
  },
  export: () => exportJSON(),
  import: () => $('#import-file').click(),
  reset: () => {
    if (!confirm('Reset to the default plan? This deletes your sessions, mocks, goals and edits (on synced devices too). Export a backup first if unsure.')) return;
    if (!confirm('Are you sure? This cannot be undone.')) return;
    const keepDeleted = S.deleted;
    S = defaultState();
    S.deleted = keepDeleted;
    commit();
    toast('Plan reset');
  },
};

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tab');
  if (tabBtn) return setTab(tabBtn.dataset.tab);
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('#sheet')) return;
  ACTIONS[el.dataset.act]?.(el.dataset, el, e);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset?.change === 'task-toggle') {
    find(find(S.phases, el.dataset.pid).tasks, el.dataset.tid).done = el.checked;
    commit();
  }
  if (el.id === 'import-file' && el.files[0]) { importJSON(el.files[0]); el.value = ''; }
});
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.form !== 'add-task') return;
  e.preventDefault();
  const text = form.elements.text.value.trim();
  if (!text) return;
  find(S.phases, form.dataset.pid).tasks.push({ id: uid(), text, done: false });
  commit();
  $(`form[data-pid="${form.dataset.pid}"] input`)?.focus();
});
let lastDay = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (todayISO() !== lastDay) { lastDay = todayISO(); render(); }
  scheduleSync(300);
});
addEventListener('online', () => scheduleSync(300));
addEventListener('pagehide', () => { clearTimeout(saveTimer); if (S) saveState(S); });

/* ================= Boot ================= */
async function boot() {
  const saved = await loadState();
  S = saved ? normalizeState(saved) : defaultState();
  if (!saved) await saveState(S);
  snap = snapshot(S);
  const t = ls.get('tab');
  if (VIEWS[t]) tab = t;
  const pv = ls.get('planView');
  if (['phases', 'dates', 'months'].includes(pv)) planView = pv;
  render();
  requestPersist();
  scheduleSync(500);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
}
boot();
