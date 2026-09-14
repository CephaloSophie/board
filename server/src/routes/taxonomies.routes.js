const { Router } = require('express');
const { Taxonomy, KINDS } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { Event } = require('../models/Event');
const { SavedFilter } = require('../models/SavedFilter');
const { requireAuth } = require('../middleware/auth');
const { loadProject, requireProjectRole, blockWritesIfArchived } = require('../middleware/project');
const { mergeMeta, statusCategoryOf, statusContext } = require('../utils/taxonomyMeta');
const { applyPatchWithHistory } = require('../utils/taskHistory');

// mergeParams so :projectKey from the parent mount is visible here.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject, blockWritesIfArchived);
const adminOnly = requireProjectRole('admin');

// Kinds stored as a field of the same name on tasks.
const TASK_FIELD_KINDS = ['status', 'priority', 'area', 'type', 'techno', 'category', 'version', 'sprint'];
const CREATE_DEFAULT_META = { sprint: { status: 'draft' }, version: { status: 'unreleased' } };

// A workflow needs at least one "to do" and one "done" status. Only refuse a
// change that *breaks* this rule (legacy projects already violating it stay editable).
async function categoryGuard(projectId, item, next /* { archived, category } | null = removed */) {
  if (item.kind !== 'status') return null;
  const statuses = await Taxonomy.find({ project: projectId, kind: 'status', archived: false }).lean();
  const others = statuses.filter((s) => String(s._id) !== String(item._id)).map(statusCategoryOf);
  const before = item.archived ? others : [...others, statusCategoryOf(item)];
  const after = next && !next.archived ? [...others, next.category] : others;
  for (const cat of ['todo', 'done']) {
    if (before.includes(cat) && !after.includes(cat)) {
      return `Le workflow doit garder au moins un statut « ${cat === 'done' ? 'terminé' : 'à faire'} ».`;
    }
  }
  return null;
}

// Archived items are hidden unless ?includeArchived=1 (admin screens).
router.get('/', async (req, res) => {
  const filter = { project: req.project._id };
  if (!['1', 'true'].includes(String(req.query.includeArchived))) filter.archived = false;
  if (req.query.kind) filter.kind = req.query.kind;
  const items = await Taxonomy.find(filter).sort({ kind: 1, order: 1, label: 1 });
  res.json({ taxonomies: items });
});

router.post('/', adminOnly, async (req, res) => {
  const { kind, key, label, color, description, order, meta } = req.body || {};
  if (!kind || !KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind invalide (attendu: ${KINDS.join(', ')}).` });
  }
  const cleanKey = String(key || '').trim();
  if (!cleanKey || !label) return res.status(400).json({ error: 'key et label sont requis.' });

  const exists = await Taxonomy.findOne({ project: req.project._id, kind, key: cleanKey });
  if (exists) return res.status(409).json({ error: `"${cleanKey}" existe déjà pour ${kind}.` });

  const count = await Taxonomy.countDocuments({ project: req.project._id, kind });
  const item = await Taxonomy.create({
    project: req.project._id,
    kind,
    key: cleanKey,
    label,
    color,
    description,
    order: order ?? count,
    meta: mergeMeta(kind, cleanKey, CREATE_DEFAULT_META[kind] || {}, meta),
  });
  res.status(201).json({ taxonomy: item });
});

// Reorder a whole kind at once: { kind, keys: [...] } (position = order).
router.put('/order', adminOnly, async (req, res) => {
  const { kind, keys } = req.body || {};
  if (!KINDS.includes(kind) || !Array.isArray(keys)) {
    return res.status(400).json({ error: 'kind et keys (tableau) sont requis.' });
  }
  await Taxonomy.bulkWrite(
    keys.map((key, index) => ({
      updateOne: { filter: { project: req.project._id, kind, key: String(key) }, update: { $set: { order: index } } },
    }))
  );
  const items = await Taxonomy.find({ project: req.project._id, kind }).sort({ order: 1, label: 1 });
  res.json({ taxonomies: items });
});

router.patch('/:id', adminOnly, async (req, res) => {
  const item = await Taxonomy.findOne({ _id: req.params.id, project: req.project._id });
  if (!item) return res.status(404).json({ error: 'Élément introuvable.' });

  const { label, color, description, order, meta, archived } = req.body || {};
  const nextMeta = meta !== undefined ? mergeMeta(item.kind, item.key, item.meta, meta) : item.meta;
  const nextArchived = archived !== undefined ? !!archived : item.archived;
  const guard = await categoryGuard(req.project._id, item, {
    archived: nextArchived,
    category: statusCategoryOf({ key: item.key, meta: nextMeta }),
  });
  if (guard) return res.status(409).json({ error: guard, code: 'CATEGORY_REQUIRED' });

  if (label !== undefined) item.label = label;
  if (color !== undefined) item.color = color;
  if (description !== undefined) item.description = description;
  if (order !== undefined) item.order = order;
  if (meta !== undefined) {
    item.meta = nextMeta;
    item.markModified('meta');
  }
  item.archived = nextArchived;
  await item.save();
  res.json({ taxonomy: item });
});

router.delete('/:id', adminOnly, async (req, res) => {
  const item = await Taxonomy.findOne({ _id: req.params.id, project: req.project._id });
  if (!item) return res.status(404).json({ error: 'Élément introuvable.' });

  // Block deletion while the value is still referenced. Event types are
  // referenced by events; every other kind by tasks (sprint field included).
  let inUse = 0;
  let usageLabel = 'tâche(s)';
  if (item.kind === 'eventType') {
    inUse = await Event.countDocuments({ project: req.project._id, type: item.key });
    usageLabel = 'événement(s)';
  } else {
    inUse = await Task.countDocuments({ project: req.project._id, [item.kind]: item.key });
  }
  if (inUse > 0) {
    return res.status(409).json({
      error: `Impossible de supprimer : ${inUse} ${usageLabel} utilisent encore "${item.label}". Archivez-la plutôt, ou utilisez « Supprimer et réaffecter ».`,
      code: 'IN_USE',
      inUse,
    });
  }
  const guard = await categoryGuard(req.project._id, item, null);
  if (guard) return res.status(409).json({ error: guard, code: 'CATEGORY_REQUIRED' });
  await item.deleteOne();
  res.json({ ok: true });
});

// Delete a value and move everything that used it to `replacementKey`
// (tasks with history, saved filters, project defaults/current values).
router.post('/:id/replace', adminOnly, async (req, res) => {
  const item = await Taxonomy.findOne({ _id: req.params.id, project: req.project._id });
  if (!item) return res.status(404).json({ error: 'Élément introuvable.' });
  const replacementKey = String(req.body?.replacementKey || '');
  if (!replacementKey || replacementKey === item.key) {
    return res.status(400).json({ error: 'Choisissez une valeur de remplacement différente.' });
  }
  const replacement = await Taxonomy.findOne({ project: req.project._id, kind: item.kind, key: replacementKey });
  if (!replacement) return res.status(400).json({ error: 'Valeur de remplacement introuvable.' });

  if (item.kind === 'eventType') {
    const r = await Event.updateMany({ project: req.project._id, type: item.key }, { $set: { type: replacementKey } });
    await item.deleteOne();
    return res.json({ tasksUpdated: 0, eventsUpdated: r.modifiedCount, filtersUpdated: 0 });
  }
  if (!TASK_FIELD_KINDS.includes(item.kind)) return res.status(400).json({ error: 'Type de taxonomie non remplaçable.' });

  const guard = await categoryGuard(req.project._id, item, null);
  if (guard) return res.status(409).json({ error: guard, code: 'CATEGORY_REQUIRED' });

  const kind = item.kind;
  const { categoryOf } = await statusContext(req.project._id);
  const note = `Valeur « ${item.label} » supprimée, remplacée par « ${replacement.label} ».`;
  const tasks = await Task.find({ project: req.project._id, [kind]: item.key });
  for (const task of tasks) {
    applyPatchWithHistory(task, { [kind]: replacementKey }, req.user, note, { categoryOf });
    await task.save();
  }

  const filters = await SavedFilter.find({ project: req.project._id, [`filters.${kind}`]: item.key });
  for (const f of filters) {
    const values = (f.filters[kind] || []).map((v) => (v === item.key ? replacementKey : v));
    f.filters = { ...f.filters, [kind]: [...new Set(values)] };
    f.markModified('filters');
    await f.save();
  }

  const p = req.project;
  if (kind === 'sprint' && p.currentSprint === item.key) p.currentSprint = replacementKey;
  if (kind === 'version' && p.currentVersion === item.key) p.currentVersion = replacementKey;
  if (['status', 'type', 'priority'].includes(kind) && p.defaults?.[kind] === item.key) p.defaults[kind] = replacementKey;
  if (p.isModified()) await p.save();

  await item.deleteOne();
  res.json({ tasksUpdated: tasks.length, filtersUpdated: filters.length });
});

module.exports = router;
