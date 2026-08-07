const { Router } = require('express');
const { Team } = require('../models/Team');
const { MANAGER_ROLES } = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

const POPULATE = { path: 'members.user', select: 'username displayName color role' };

router.get('/', async (req, res) => {
  const teams = await Team.find({ project: req.project._id }).populate(POPULATE).sort({ name: 1 });
  res.json({ teams });
});

router.post('/', requireRole(...MANAGER_ROLES), async (req, res) => {
  const { name, color, description, capacityPoints, members } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Le nom est requis.' });
  const team = await Team.create({
    project: req.project._id,
    name,
    color,
    description,
    capacityPoints: capacityPoints || 0,
    members: members || [],
  });
  const populated = await team.populate(POPULATE);
  res.status(201).json({ team: populated });
});

router.patch('/:id', requireRole(...MANAGER_ROLES), async (req, res) => {
  const team = await Team.findOne({ _id: req.params.id, project: req.project._id });
  if (!team) return res.status(404).json({ error: 'Équipe introuvable.' });
  const { name, color, description, capacityPoints, members } = req.body || {};
  if (name !== undefined) team.name = name;
  if (color !== undefined) team.color = color;
  if (description !== undefined) team.description = description;
  if (capacityPoints !== undefined) team.capacityPoints = Number(capacityPoints) || 0;
  if (members !== undefined) team.members = members;
  await team.save();
  const populated = await team.populate(POPULATE);
  res.json({ team: populated });
});

router.delete('/:id', requireRole(...MANAGER_ROLES), async (req, res) => {
  const result = await Team.deleteOne({ _id: req.params.id, project: req.project._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Équipe introuvable.' });
  res.json({ ok: true });
});

module.exports = router;
