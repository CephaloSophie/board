const { hoursOf } = require('./duration');

// Fields that are tracked in a task's history timeline whenever they change.
const TRACKED_FIELDS = [
  'title',
  'status',
  'priority',
  'assignee',
  'sprint',
  'version',
  'type',
  'category',
  'techno',
  'area',
  'complexity',
  'labels',
  'parent',
  'dueDate',
];

// Editable fields that do not produce history entries.
const PASSTHROUGH_FIELDS = ['description', 'module', 'estimate', 'duration', 'spec', 'instructions', 'acceptance'];

const NULLABLE_FIELDS = new Set(['assignee', 'sprint', 'parent', 'dueDate', 'version']);

function normalizeValue(field, value) {
  if (field === 'labels') {
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
    return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
  }
  if (field === 'dueDate') {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (NULLABLE_FIELDS.has(field) && value === '') return null;
  return value;
}

// JSON-friendly snapshot stored in history (arrays copied, dates as ISO).
function plain(value) {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

function valuesEqual(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(plain(a || [])) === JSON.stringify(plain(b || []));
  if (a instanceof Date || b instanceof Date) {
    return (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
  }
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  // ObjectId vs string id, number vs numeric string…
  if (typeof a === 'object' || typeof b === 'object') return String(a) === String(b);
  return a === b;
}

/**
 * Applies `patch` onto `task`, pushing one history entry per changed tracked
 * field. Mutates `task` in place; caller is responsible for saving it.
 * ctx.categoryOf(statusKey) keeps `resolvedAt` in sync with the status
 * category; ctx.at backdates entries (imports).
 */
function applyPatchWithHistory(task, patch, actingUser, note, ctx = {}) {
  const entries = [];
  const now = ctx.at || new Date();
  for (const field of TRACKED_FIELDS) {
    if (!(field in patch)) continue;
    const before = task[field];
    const after = normalizeValue(field, patch[field]);
    if (valuesEqual(before, after)) continue;
    entries.push({
      at: now,
      by: actingUser?._id,
      byLabel: actingUser?.displayName || ctx.byLabel,
      field,
      from: plain(before),
      to: plain(after),
      note: note || undefined,
    });
    task[field] = after;
  }

  if (entries.some((e) => e.field === 'status')) {
    task.statusChangedAt = now;
    if (ctx.categoryOf) {
      const done = ctx.categoryOf(task.status) === 'done';
      if (done && !task.resolvedAt) task.resolvedAt = now;
      if (!done) task.resolvedAt = null;
    }
  }

  for (const field of PASSTHROUGH_FIELDS) {
    if (field in patch) task[field] = patch[field];
  }
  if ('duration' in patch) task.durationHours = hoursOf(patch.duration);

  if (entries.length) task.history.push(...entries);
  return entries;
}

module.exports = { applyPatchWithHistory, TRACKED_FIELDS, PASSTHROUGH_FIELDS, valuesEqual };
