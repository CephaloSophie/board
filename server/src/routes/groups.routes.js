const { Router } = require('express');
const { Group, GROUP_KINDS } = require('../models/Group');
const { MANAGER_ROLES } = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadProject, requireProjectManager } = require('../middleware/project');

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

const POPULATE = { path: 'members', select: 'username displayName color role' };

router.get('/', async (req, res) => {
  const filter = { project: req.project._id };
  if (req.query.kind) filter.kind = req.query.kind;
  const groups = await Group.find(filter).populate(POPULATE).sort({ kind: 1, name: 1 });
  res.json({ groups });
});

router.post('/', requireProjectManager, async (req, res) => {
  const { name, kind, color, members } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Le nom est requis.' });
  if (kind && !GROUP_KINDS.includes(kind)) return res.status(400).json({ error: 'kind invalide.' });
  const exists = await Group.findOne({ project: req.project._id, kind: kind || 'group', name });
  if (exists) return res.status(409).json({ error: 'Un élément avec ce nom existe déjà.' });
  const group = await Group.create({
    project: req.project._id,
    name,
    kind: kind || 'group',
    color,
    members: members || [],
  });
  const populated = await group.populate(POPULATE);
  res.status(201).json({ group: populated });
});

router.patch('/:id', requireProjectManager, async (req, res) => {
  const group = await Group.findOne({ _id: req.params.id, project: req.project._id });
  if (!group) return res.status(404).json({ error: 'Introuvable.' });
  const { name, color, members } = req.body || {};
  if (name !== undefined) group.name = name;
  if (color !== undefined) group.color = color;
  if (members !== undefined) group.members = members;
  await group.save();
  const populated = await group.populate(POPULATE);
  res.json({ group: populated });
});

router.delete('/:id', requireProjectManager, async (req, res) => {
  const result = await Group.deleteOne({ _id: req.params.id, project: req.project._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Introuvable.' });
  res.json({ ok: true });
});

module.exports = router;
