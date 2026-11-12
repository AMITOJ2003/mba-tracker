// Dependency-free SVG line chart for mock scores. Two modes:
//   'total'    – total score (205–805) with target/minimum lines and checkpoints
//   'sections' – Quant / Verbal / DI (60–90), one line each, direct-labelled
import { parseISO, todayISO, fmtShort } from './dates.js';

const DAY = 864e5;
const W = 340, H = 210, L = 30, R = 30, T = 14, B = 24;
const f = (n) => n.toFixed(1);
const t = (s) => parseISO(s).getTime();
export const SERIES = [
  { key: 'quant', label: 'Q', cls: 's1' },
  { key: 'verbal', label: 'V', cls: 's2' },
  { key: 'di', label: 'DI', cls: 's3' },
];

export function scoreChart({ scores, target, min, checkpoints, start, mode = 'total' }) {
  const pts = scores.slice().sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO();
  const totalMode = mode === 'total';

  const xs = [start, today, ...pts.map((s) => s.date), ...(totalMode ? checkpoints.map((c) => c.date) : [])].filter(Boolean).map(t);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) + 10 * DAY;

  let y0, y1, step;
  if (totalMode) {
    const vals = [target, min, ...pts.map((s) => s.total), ...checkpoints.map((c) => c.score)];
    y0 = Math.max(205, Math.floor((Math.min(...vals) - 30) / 50) * 50);
    y1 = Math.min(805, Math.ceil((Math.max(...vals) + 15) / 50) * 50);
    step = 50;
  } else {
    const vals = pts.flatMap((s) => SERIES.map((k) => s[k.key])).filter((v) => v != null);
    y0 = Math.max(60, Math.floor((Math.min(90, ...vals) - 3) / 5) * 5);
    y1 = 90;
    step = y1 - y0 > 20 ? 10 : 5;
  }
  const X = (ms) => L + ((ms - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v) => T + ((y1 - v) / (y1 - y0)) * (H - T - B);
  let svg = '';

  for (let v = y0; v <= y1; v += step) {
    svg += `<line x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="c-grid"/>`;
    svg += `<text x="${L - 6}" y="${f(Y(v) + 3.5)}" class="c-axis" text-anchor="end">${v}</text>`;
  }
  const d = new Date(x0);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const every = (x1 - x0) / DAY > 180 ? 2 : 1;
  for (let i = 0; d.getTime() < x1; i++, d.setMonth(d.getMonth() + 1)) {
    if (i % every) continue;
    const lbl = d.toLocaleDateString('en-GB', { month: 'short' }) + (d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : '');
    svg += `<text x="${f(X(d.getTime()))}" y="${H - B + 15}" class="c-axis" text-anchor="middle">${lbl}</text>`;
  }

  if (totalMode) {
    const ref = (v, cls, label, dy) => {
      svg += `<line x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}" class="${cls}"/>`;
      svg += `<text x="${L + 4}" y="${f(Y(v) + dy)}" class="c-ref-t">${label}</text>`;
    };
    ref(target, 'c-target', `${target} target`, -4);
    ref(min, 'c-min', `${min} min`, 11);
    for (const c of checkpoints) {
      const x = X(t(c.date)), y = Y(c.score), r = 4.5;
      svg += `<path d="M${f(x)} ${f(y - r)}L${f(x + r)} ${f(y)}L${f(x)} ${f(y + r)}L${f(x - r)} ${f(y)}Z" class="c-cp"/>`;
    }
    if (pts.length) {
      svg += `<path d="${pts.map((s, k) => `${k ? 'L' : 'M'}${f(X(t(s.date)))} ${f(Y(s.total))}`).join('')}" class="c-line"/>`;
      pts.forEach((s) => {
        svg += `<circle cx="${f(X(t(s.date)))}" cy="${f(Y(s.total))}" r="4" class="c-dot ${s.official ? '' : 'hollow'}"/>`;
      });
    }
  } else {
    for (const sr of SERIES) {
      const sp = pts.filter((s) => s[sr.key] != null);
      if (!sp.length) continue;
      svg += `<path d="${sp.map((s, k) => `${k ? 'L' : 'M'}${f(X(t(s.date)))} ${f(Y(s[sr.key]))}`).join('')}" class="c-sline ${sr.cls}"/>`;
      sp.forEach((s) => { svg += `<circle cx="${f(X(t(s.date)))}" cy="${f(Y(s[sr.key]))}" r="4" class="c-sdot ${sr.cls}"/>`; });
    }
    // Direct labels at line ends, nudged apart so they never collide
    const ends = SERIES.map((sr) => {
      const last = pts.filter((s) => s[sr.key] != null).at(-1);
      return last && { ...sr, x: X(t(last.date)), y: Y(last[sr.key]), v: last[sr.key] };
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
    ends.forEach((e) => { svg += `<text x="${f(e.x + 8)}" y="${f(e.y + 3.5)}" class="c-end">${e.label} ${e.v}</text>`; });
  }

  if (!pts.length) {
    svg += `<text x="${(L + W - R) / 2}" y="${(T + H - B) / 2 + 4}" class="c-empty" text-anchor="middle">Log your first mock</text>`;
  } else {
    // Crosshair + invisible hit columns for tap/hover readout
    svg += `<line class="c-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
    const px = pts.map((s) => X(t(s.date)));
    pts.forEach((s, i) => {
      const a = i ? (px[i - 1] + px[i]) / 2 : L;
      const b = i < pts.length - 1 ? (px[i] + px[i + 1]) / 2 : W - R;
      svg += `<rect class="c-hit" data-i="${i}" data-x="${f(px[i])}" x="${f(a)}" y="${T}" width="${f(Math.max(1, b - a))}" height="${H - T - B}"/>`;
    });
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${totalMode ? 'Total' : 'Section'} scores over time">${svg}</svg>`;
}

// Wire up tap/hover: highlights the nearest mock and calls onPick(index | null).
export function bindChart(root, onPick) {
  const svg = root.querySelector('svg.chart');
  if (!svg) return;
  const cross = svg.querySelector('.c-cross');
  const pick = (e) => {
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.c-hit');
    if (!hit || !svg.contains(hit)) return;
    cross.setAttribute('x1', hit.dataset.x);
    cross.setAttribute('x2', hit.dataset.x);
    cross.setAttribute('visibility', 'visible');
    onPick(Number(hit.dataset.i));
  };
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointermove', pick);
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    cross.setAttribute('visibility', 'hidden');
    onPick(null);
  });
}

export { fmtShort };
