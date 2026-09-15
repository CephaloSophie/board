const { stripAccents } = require('./text');

// Jira CSV dates follow the instance format and carry no timezone:
//   14/Sep/26 9:05 AM · 30/Sep/26 · 2026-09-14 09:05 · 14/09/2026 09:05 · 14/sept./26 09:05
// JSON dates are ISO 8601 with offsets (+0200). Local values are read in `timezone`.

const MONTHS = { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, avr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, aou: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function monthIndex(token) {
  const t = stripAccents(token).toLowerCase().replace(/\./g, '');
  if (t.startsWith('juin')) return 5;
  if (t.startsWith('juil')) return 6;
  const v = MONTHS[t.slice(0, 3)];
  return v === undefined ? null : v;
}

function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000;
}

// Wall-clock time in `timeZone` → UTC instant (DST-aware).
function zonedToUtc(y, mo, d, H, M, S, timeZone) {
  const guess = Date.UTC(y, mo, d, H, M, S);
  return new Date(guess - tzOffsetMs(guess - tzOffsetMs(guess, timeZone), timeZone));
}

const to24 = (h, ampm) => (ampm ? (h % 12) + (/p/i.test(ampm) ? 12 : 0) : h);
const year = (y) => (y < 100 ? y + 2000 : y);

function parseParts(raw, { dayFirst }) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const d = new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(d.getTime()) ? null : { instant: d };
  }
  let m = /^(\d{1,2})[/\-. ]([A-Za-zÀ-ÿ.]{3,6})[/\-. ](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (m) {
    const mo = monthIndex(m[2]);
    if (mo === null) return null;
    return { y: year(+m[3]), mo, d: +m[1], H: m[4] ? to24(+m[4], m[7]) : 0, M: m[5] ? +m[5] : 0, S: m[6] ? +m[6] : 0, dateOnly: !m[4] };
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return { y: +m[1], mo: +m[2] - 1, d: +m[3], H: m[4] ? +m[4] : 0, M: m[5] ? +m[5] : 0, S: m[6] ? +m[6] : 0, dateOnly: !m[4] };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/.exec(s);
  if (m) {
    const [d, mo] = dayFirst ? [+m[1], +m[2]] : [+m[2], +m[1]];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: year(+m[3]), mo: mo - 1, d, H: m[4] ? to24(+m[4], m[7]) : 0, M: m[5] ? +m[5] : 0, S: m[6] ? +m[6] : 0, dateOnly: !m[4] };
  }
  if (/^[A-Za-z]{3},?\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(s)) {
    const t = Date.parse(s); // RFC 822 (XML exports)
    return Number.isNaN(t) ? null : { instant: new Date(t) };
  }
  return null;
}

function detectDayFirst(samples) {
  for (const s of samples) {
    const m = /^(\d{1,2})\/(\d{1,2})\//.exec(String(s).trim());
    if (!m) continue;
    if (+m[1] > 12) return true;
    if (+m[2] > 12) return false;
  }
  return true;
}

function safeTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Builds a parser whose day/month order is detected once on the file's samples. */
function createDateParser(samples = [], { timezone = 'Europe/Paris' } = {}) {
  const tz = safeTimezone(timezone);
  const dayFirst = detectDayFirst(samples.filter(Boolean).slice(0, 50));
  const parse = (value) => {
    const p = parseParts(value, { dayFirst });
    if (!p) return null;
    if (p.instant) return p.instant;
    if (p.dateOnly) return new Date(Date.UTC(p.y, p.mo, p.d));
    return zonedToUtc(p.y, p.mo, p.d, p.H, p.M, p.S, tz);
  };
  parse.dayFirst = dayFirst;
  return parse;
}

// "Date only" fields (due date, release date) → "YYYY-MM-DD".
function toDateOnly(value, parse) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())) return String(value).trim();
  const d = parse(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

module.exports = { createDateParser, zonedToUtc, toDateOnly, parseParts, monthIndex };
