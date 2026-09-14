const { Taxonomy } = require('../models/Taxonomy');

// Workflow buckets every status belongs to (Jira's To Do / In Progress / Done).
const STATUS_CATEGORIES = ['todo', 'inprogress', 'done'];

// Keys historically treated as "in progress" before categories existed; only
// used as a fallback for data that has not been migrated yet.
const LEGACY_IN_PROGRESS = new Set(['onprocess', 'needreview', 'needconfirmation', 'tested']);

function statusCategoryOf(item) {
  const meta = (item && item.meta) || {};
  if (STATUS_CATEGORIES.includes(meta.category)) return meta.category;
  if (meta.isDone) return 'done';
  if (LEGACY_IN_PROGRESS.has(item?.key)) return 'inprogress';
  return 'todo';
}

// Meta keys owned by dedicated lifecycle routes (sprints/versions) or derived
// server-side: generic taxonomy writes silently ignore them.
const RESERVED_META = {
  status: ['isDone'],
  sprint: ['status', 'startedAt', 'startedBy', 'startSnapshot', 'closedAt', 'closedBy', 'report', 'reopenedAt'],
  version: ['status', 'releasedAt'],
};

/**
 * Shallow-merges `incoming` into `current` (a key sent as null is removed),
 * skipping reserved keys unless `allowReserved`. Status meta always ends with a
 * valid `category` and a derived `isDone`.
 */
function mergeMeta(kind, key, current, incoming, { allowReserved = false } = {}) {
  const reserved = allowReserved ? [] : RESERVED_META[kind] || [];
  const out = { ...(current && typeof current === 'object' ? current : {}) };
  if (incoming && typeof incoming === 'object') {
    for (const [k, v] of Object.entries(incoming)) {
      if (reserved.includes(k)) continue;
      if (v === null) delete out[k];
      else out[k] = v;
    }
  }
  if (kind === 'status') {
    out.category = statusCategoryOf({ key, meta: { ...out, isDone: current?.isDone } });
    out.isDone = out.category === 'done';
  }
  return out;
}

// Loads a project's statuses once and exposes category helpers.
async function statusContext(projectId) {
  const statuses = await Taxonomy.find({ project: projectId, kind: 'status' }).lean();
  const categories = new Map(statuses.map((s) => [s.key, statusCategoryOf(s)]));
  const categoryOf = (key) => categories.get(key) || statusCategoryOf({ key });
  const keysIn = (...cats) => statuses.filter((s) => cats.includes(categories.get(s.key))).map((s) => s.key);
  return { statuses, categories, categoryOf, keysIn, doneKeys: new Set(keysIn('done')) };
}

module.exports = { STATUS_CATEGORIES, RESERVED_META, statusCategoryOf, mergeMeta, statusContext };
