const { Router } = require('express');
const { Retro } = require('../models/Retro');
const { Team } = require('../models/Team');
const { requireAuth } = require('../middleware/auth');
const { loadProject, isProjectManager } = require('../middleware/project');

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

const POPULATE = [
  { path: 'facilitator', select: 'username displayName color' },
  { path: 'team', select: 'name color members' },
  { path: 'invited', select: 'username displayName color role' },
];

router.get('/', async (req, res) => {
  const filter = { project: req.project._id };
  if (req.query.sprint) filter.sprint = req.query.sprint;
  if (req.query.team) filter.team = req.query.team;
  const retros = await Retro.find(filter).populate(POPULATE).sort({ createdAt: -1 });
  res.json({ retros });
});

router.get('/:id', async (req, res) => {
  const retro = await Retro.findOne({ _id: req.params.id, project: req.project._id }).populate(POPULATE);
  if (!retro) return res.status(404).json({ error: 'Rétrospective introuvable.' });
  res.json({ retro });
});

// Latest DONE retro of the same team (or project) — used to review whether
// previous action items were applied at the start of the next retro.
router.get('/previous/:sprint', async (req, res) => {
  const filter = { project: req.project._id, status: 'done' };
  if (req.query.team) filter.team = req.query.team;
  const prev = await Retro.findOne(filter).sort({ createdAt: -1 }).populate(POPULATE);
  res.json({ retro: prev });
});

router.post('/', async (req, res) => {
  if (!isProjectManager(req)) return res.status(403).json({ error: 'Seul un manager peut créer une rétrospective.' });
  const { sprint, team, title, facilitator, invited } = req.body || {};
  if (!sprint) return res.status(400).json({ error: 'Le sprint est requis.' });

  // Default invited = the team's members (if a team is given).
  let invitedIds = invited || [];
  if (team && !invited) {
    const t = await Team.findOne({ _id: team, project: req.project._id });
    if (t) invitedIds = t.members.map((m) => m.user);
  }

  const retro = await Retro.create({
    project: req.project._id,
    sprint,
    team: team || null,
    title: title || '',
    facilitator: facilitator || req.user._id,
    createdBy: req.user._id,
    invited: invitedIds,
  });
  const populated = await retro.populate(POPULATE);
  res.status(201).json({ retro: populated });
});

router.delete('/:id', async (req, res) => {
  if (!isProjectManager(req)) return res.status(403).json({ error: 'Droits insuffisants.' });
  const result = await Retro.deleteOne({ _id: req.params.id, project: req.project._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Introuvable.' });
  res.json({ ok: true });
});

module.exports = router;
