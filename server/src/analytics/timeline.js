const { zonedToUtc } = require('../import/jira/dates');
const { httpError } = require('../utils/httpError');

// Metrics rebuilt from Task.history: the value of a field at instant `t` is
// the current value, walked back through every later change of that field.
function valueAt(task, field, t) {
  let value = task[field];
  const later = (task.history || [])
    .filter((h) => h.field === field && new Date(h.at) > t)
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  for (const entry of later) value = entry.from;
  return value ?? null;
}

// Calendar day boundaries in the project timezone.
function dayKey(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function endOfDay(key, timeZone) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToUtc(y, m - 1, d, 23, 59, 59, timeZone);
}

function nextDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function safeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Burndown / burnup of one sprint.
 * tasks: every task currently in the sprint or whose history mentions it (with history, complexity, status, createdAt).
 */
function sprintTimeline({ sprint, tasks, categoryOf, unit = 'points', timezone = 'Europe/Paris', now = new Date() }) {
  const startIso = sprint.meta?.startedAt || sprint.meta?.startDate;
  const endIso = sprint.meta?.closedAt || sprint.meta?.endDate;
  if (!startIso || !endIso) throw httpError(422, 'SPRINT_WITHOUT_DATES', 'Ce sprint n’a pas de dates : impossible de tracer son burndown.');
  const tz = safeZone(timezone);
  const key = sprint.key;
  const start = new Date(startIso);
  const end = new Date(endIso);
  const warnings = new Set();

  const sample = (t) => {
    let scope = 0;
    let completed = 0;
    for (const task of tasks) {
      if (task.createdAt && new Date(task.createdAt) > t) continue;
      if (valueAt(task, 'sprint', t) !== key) continue;
      const pts = unit === 'count' ? 1 : Number(valueAt(task, 'complexity', t)) || 0;
      const status = valueAt(task, 'status', t);
      if (status === null) warnings.add('HISTORY_INCOMPLETE');
      scope += pts;
      if (status && categoryOf(status) === 'done') completed += pts;
    }
    return { scope, completed, remaining: scope - completed };
  };

  const days = [];
  const lastKey = dayKey(end, tz);
  for (let k = dayKey(start, tz); k <= lastKey; k = nextDayKey(k)) {
    const boundary = endOfDay(k, tz);
    if (boundary > now) {
      if (days.length === 0 || new Date(days[days.length - 1].at) < now) days.push({ date: k, at: now.toISOString(), ...sample(now), partial: true });
      break;
    }
    days.push({ date: k, at: boundary.toISOString(), ...sample(boundary > end ? end : boundary) });
  }

  const snapshot = sprint.meta?.startSnapshot;
  const committed = snapshot ? (unit === 'count' ? snapshot.committedCount : snapshot.committedPoints) : sample(start).scope;
  const totalDays = (() => {
    let n = 0;
    for (let k = dayKey(start, tz); k <= lastKey; k = nextDayKey(k)) n += 1;
    return n;
  })();
  const ideal = [];
  let i = 0;
  for (let k = dayKey(start, tz); k <= lastKey; k = nextDayKey(k), i += 1) {
    ideal.push({ date: k, value: totalDays > 1 ? Math.round((committed * (1 - i / (totalDays - 1))) * 100) / 100 : 0 });
  }

  const scopeChanges = [];
  for (const task of tasks) {
    for (const h of task.history || []) {
      const at = new Date(h.at);
      if (at <= start || at > end) continue;
      if (h.field === 'sprint' && (h.to === key || h.from === key)) {
        scopeChanges.push({ at: at.toISOString(), taskId: task.taskId, kind: h.to === key ? 'added' : 'removed' });
      } else if (h.field === 'complexity' && valueAt(task, 'sprint', at) === key) {
        scopeChanges.push({ at: at.toISOString(), taskId: task.taskId, kind: 'resized', delta: (Number(h.to) || 0) - (Number(h.from) || 0) });
      }
    }
  }
  scopeChanges.sort((a, b) => a.at.localeCompare(b.at));

  return {
    sprint: { key, label: sprint.label, status: sprint.meta?.status || 'draft', startDate: startIso, endDate: endIso, goal: sprint.meta?.goal || '' },
    unit,
    committed,
    days,
    ideal,
    scopeChanges,
    warnings: [...warnings],
    sample,
  };
}

module.exports = { valueAt, sprintTimeline, dayKey };
