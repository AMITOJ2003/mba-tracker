// Build an iCalendar (.ics) file of all-day events with 7-day and 1-day alerts.
import { addDays } from './dates.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

// Fold lines to max 75 octets (RFC 5545), UTF-8 aware.
const enc = new TextEncoder();
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + b > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const compact = (iso) => iso.replace(/-/g, '');

export function buildICS(dates) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MBA Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:MBA Tracker',
  ];
  for (const d of dates) {
    const desc = [d.tag, d.optional ? 'optional' : '', d.status && d.status !== 'Upcoming' ? d.status : '']
      .filter(Boolean)
      .join(' · ') + (d.note ? `\n${d.note}` : '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${d.id}@mba-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(d.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(d.date, 1))}`,
      `SUMMARY:${esc(d.title)}`,
      `DESCRIPTION:${esc(desc)}`,
      'TRANSP:TRANSPARENT',
      // All-day event starts at 00:00; -P6DT15H = 7 days before at 09:00, -PT15H = 1 day before at 09:00
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`In 7 days: ${d.title}`)}`,
      'TRIGGER:-P6DT15H',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(`Tomorrow: ${d.title}`)}`,
      'TRIGGER:-PT15H',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
