const { httpError } = require('./httpError');

/*
 * Acceptance criteria ("critères d'acceptation" / recette).
 *
 * `Task.criteria[]` is the source of truth: ordered sub-documents with a rich
 * text, a done flag (who / when) and their own comment thread. `Task.acceptance`
 * is kept as a plain mirror of the criteria texts so that search, CSV export,
 * Jira re-imports (hash / rollback) and @mention detection keep working on a
 * simple string list. The Task model synchronises both on save (see
 * `syncCriteriaOnSave`).
 */

const MAX_CRITERIA = 200;
const MAX_CRITERION_LENGTH = 5000;
const MAX_CRITERION_COMMENT_LENGTH = 20000;

const normalizeKey = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

function cleanText(value, max = MAX_CRITERION_LENGTH) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length > max) {
    throw httpError(400, 'CRITERION_TOO_LONG', `Un critère d'acceptation est limité à ${max} caractères.`);
  }
  return text;
}

/**
 * Normalises a loose list of criteria coming from the API (`["texte", { text, done }]`)
 * into sub-document payloads. Empty entries are dropped; the list is capped.
 */
function criteriaFromInput(input, user, { at = new Date() } = {}) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split('\n') : [];
  const out = [];
  for (const raw of list) {
    const item = raw && typeof raw === 'object' ? raw : { text: raw };
    const text = cleanText(item.text);
    if (!text) continue;
    const done = item.done === true;
    out.push({
      text,
      done,
      doneAt: done ? at : null,
      doneBy: done ? user?._id || null : null,
      createdBy: user?._id || null,
    });
  }
  if (out.length > MAX_CRITERIA) {
    throw httpError(400, 'TOO_MANY_CRITERIA', `${MAX_CRITERIA} critères d'acceptation maximum par tâche.`);
  }
  return out;
}

/**
 * Re-aligns `task.criteria` on a list of texts (legacy `acceptance` writes:
 * Jira re-import, rollback, old clients). Criteria whose text is unchanged keep
 * their identity, done flag and comments; others are created or removed.
 */
function syncCriteriaFromTexts(task, texts) {
  const pool = new Map();
  for (const c of task.criteria || []) {
    const key = normalizeKey(c.text);
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(c);
  }
  const next = [];
  for (const text of texts) {
    const clean = String(text || '').trim();
    if (!clean) continue;
    const reuse = pool.get(normalizeKey(clean))?.shift();
    next.push(reuse ? reuse.toObject?.() ?? reuse : { text: clean, done: false, comments: [] });
  }
  task.criteria = next;
}

/** Mongoose pre-save hook body: keeps `criteria` and the `acceptance` mirror consistent. */
function syncCriteriaOnSave(doc) {
  if (!doc.isSelected('criteria') || !doc.isSelected('acceptance')) return;
  const criteriaChanged = doc.isModified('criteria');
  const acceptanceChanged = doc.isModified('acceptance');
  if (acceptanceChanged && !criteriaChanged) {
    syncCriteriaFromTexts(doc, doc.acceptance || []);
  } else if (!criteriaChanged && !(doc.criteria || []).length && (doc.acceptance || []).length) {
    // Legacy task (string list only): convert once.
    syncCriteriaFromTexts(doc, doc.acceptance);
  }
  const texts = (doc.criteria || []).map((c) => c.text);
  if (JSON.stringify(texts) !== JSON.stringify([...(doc.acceptance || [])])) doc.acceptance = texts;
}

/** True when the task still only has the legacy string list (needs a one-off conversion). */
const needsCriteriaMigration = (task) => !(task.criteria || []).length && (task.acceptance || []).length > 0;

function criteriaProgress(task) {
  const list = task.criteria || [];
  return { total: list.length, done: list.filter((c) => c.done).length };
}

function findCriterion(task, id) {
  const criterion = task.criteria.id(id);
  if (!criterion) throw httpError(404, 'CRITERION_NOT_FOUND', "Critère d'acceptation introuvable.");
  return criterion;
}

/**
 * Applies a client ordering. Unknown ids are ignored and criteria missing from
 * the list keep their relative order at the end, so a stale client never loses data.
 */
function reorderCriteria(task, ids) {
  const byId = new Map(task.criteria.map((c) => [String(c._id), c]));
  const seen = new Set();
  const ordered = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const c = byId.get(String(id));
    if (c && !seen.has(String(id))) {
      ordered.push(c);
      seen.add(String(id));
    }
  }
  for (const c of task.criteria) if (!seen.has(String(c._id))) ordered.push(c);
  const changed = ordered.some((c, i) => String(c._id) !== String(task.criteria[i]._id));
  if (changed) task.criteria = ordered.map((c) => c.toObject());
  return changed;
}

module.exports = {
  MAX_CRITERIA,
  MAX_CRITERION_LENGTH,
  MAX_CRITERION_COMMENT_LENGTH,
  cleanText,
  criteriaFromInput,
  syncCriteriaFromTexts,
  syncCriteriaOnSave,
  needsCriteriaMigration,
  criteriaProgress,
  findCriterion,
  reorderCriteria,
};
