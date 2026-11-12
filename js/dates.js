// Date helpers. All dates are stored as local-time ISO strings: "YYYY-MM-DD".
export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const todayISO = () => toISO(new Date());
export const addDays = (s, n) => {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
// Monday-based week start
export const weekStart = (s) => {
  const d = parseISO(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
};
export const fmtDate = (s, opts = {}) =>
  s ? parseISO(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...opts }) : '';
export const fmtShort = (s) => fmtDate(s, { year: undefined });
export const fmtMonth = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
};
export const isValidISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(parseISO(s));
