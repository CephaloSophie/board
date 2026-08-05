const { Router } = require('express');
const { Taxonomy, KINDS } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');

// mergeParams so :projectKey from the parent mount is visible here.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

router.get('/', async (req, res) => {
  const filter = { project: req.project._id, archived: false };
  if (req.query.kind) filter.kind = req.query.kind;
  const items = await Taxonomy.find(filter).sort({ kind: 1, order: 1, label: 1 });
  res.json({ taxonomies: items });
});

router.post('/', requireRole('superadmin'), async (req, res) => {
  const { kind, key, label, color, description, order, meta } = req.body || {};
  if (!kind || !KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind invalide (attendu: ${KINDS.join(', ')}).` });
  }
  if (!key || !label) return res.status(400).json({ error: 'key et label sont requis.' });

  const exists = await Taxonomy.findOne({ project: req.project._id, kind, key });
  if (exists) return res.status(409).json({ error: `"${key}" existe déjà pour ${kind}.` });

  const item = await Taxonomy.create({
    project: req.project._id,
    kind,
    key,
    label,
    color,
    description,
    order: order ?? 0,
    meta: meta || {},
  });
  res.status(201).json({ taxonomy: item });
});

router.patch('/:id', requireRole('superadmin'), async (req, res) => {
  const item = await Taxonomy.findOne({ _id: req.params.id, project: req.project._id });
  if (!item) return res.status(404).json({ error: 'Élément introuvable.' });

  const { label, color, description, order, meta, archived } = req.body || {};
  if (label !== undefined) item.label = label;
  if (color !== undefined) item.color = color;
  if (description !== undefined) item.description = description;
  if (order !== undefined) item.order = order;
  if (meta !== undefined) item.meta = meta;
  if (archived !== undefined) item.archived = archived;
  await item.save();
  res.json({ taxonomy: item });
});

router.delete('/:id', requireRole('superadmin'), async (req, res) => {
  const item = await Taxonomy.findOne({ _id: req.params.id, project: req.project._id });
  if (!item) return res.status(404).json({ error: 'Élément introuvable.' });

  const inUse = await Task.countDocuments({ project: req.project._id, [item.kind]: item.key });
  if (inUse > 0) {
    return res.status(409).json({
      error: `Impossible de supprimer : ${inUse} tâche(s) utilisent encore "${item.label}". Archivez-la plutôt, ou réassignez ces tâches.`,
    });
  }
  await item.deleteOne();
  res.json({ ok: true });
});

module.exports = router;
