const { Task } = require('../models/Task');
const { httpError } = require('./httpError');

/*
 * Task hierarchy (module / package / epic → sous-tâches) through `Task.parent`
 * (the parent's taskId). The hierarchy is validated on every write coming from
 * the API: the parent must exist in the same project and no cycle may appear.
 * Imports keep their own, more lenient, rules (missing Jira parents are ignored).
 */
const MAX_DEPTH = 12;

const normalizeKey = (v) => (v === null || v === undefined || v === '' ? null : String(v).trim().toUpperCase());

/** Ancestors of `taskId`, nearest first (stops on missing parents and on corrupted loops). */
async function ancestorsOf(projectId, parentKey, { limit = MAX_DEPTH } = {}) {
  const chain = [];
  const seen = new Set();
  let key = normalizeKey(parentKey);
  while (key && chain.length < limit && !seen.has(key)) {
    seen.add(key);
    const row = await Task.findOne({ project: projectId, taskId: key }, { taskId: 1, title: 1, status: 1, parent: 1, type: 1 }).lean();
    if (!row) break;
    chain.push(row);
    key = normalizeKey(row.parent);
  }
  return chain;
}

/**
 * Throws when `parentKey` cannot become the parent of `taskKey` (null clears the link).
 * Returns the normalised parent key.
 */
async function assertValidParent(projectId, taskKey, parentKey) {
  const parent = normalizeKey(parentKey);
  if (!parent) return null;
  const self = normalizeKey(taskKey);
  if (self && parent === self) throw httpError(400, 'PARENT_SELF', 'Une tâche ne peut pas être sa propre tâche parente.');
  const exists = await Task.exists({ project: projectId, taskId: parent });
  if (!exists) throw httpError(400, 'PARENT_NOT_FOUND', `Tâche parente ${parent} introuvable dans ce projet.`);
  if (!self) return parent;
  const chain = await ancestorsOf(projectId, parent, { limit: MAX_DEPTH + 1 });
  if (chain.some((t) => t.taskId === self)) {
    throw httpError(409, 'PARENT_CYCLE', `${parent} est déjà une sous-tâche de ${self} : le lien créerait une boucle.`);
  }
  if (chain.length >= MAX_DEPTH) throw httpError(409, 'PARENT_TOO_DEEP', `Hiérarchie limitée à ${MAX_DEPTH} niveaux.`);
  return parent;
}

/**
 * Children counters per parent key: { 'KB-1': { total, done, points, donePoints } }.
 * `doneKeys` are the status keys whose category is "done".
 */
async function subtaskStats(projectId, parentKeys, doneKeys) {
  const keys = [...new Set(parentKeys.filter(Boolean))];
  if (!keys.length) return {};
  const rows = await Task.aggregate([
    { $match: { project: projectId, parent: { $in: keys } } },
    {
      $group: {
        _id: '$parent',
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $in: ['$status', doneKeys] }, 1, 0] } },
        points: { $sum: { $ifNull: ['$complexity', 0] } },
        donePoints: { $sum: { $cond: [{ $in: ['$status', doneKeys] }, { $ifNull: ['$complexity', 0] }, 0] } },
      },
    },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, { total: r.total, done: r.done, points: r.points, donePoints: r.donePoints }]));
}

module.exports = { MAX_DEPTH, normalizeKey, ancestorsOf, assertValidParent, subtaskStats };
