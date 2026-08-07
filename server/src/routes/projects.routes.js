const { Router } = require('express');
const { Project } = require('../models/Project');
const { Taxonomy, KINDS } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { MANAGER_ROLES } = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');

const router = Router();
router.use(requireAuth);

const DEFAULT_TAXONOMIES = {
  status: [
    { key: 'draft', label: 'Brouillon', color: '#6b7280', order: 0 },
    { key: 'pending', label: 'À faire', color: '#9db4dd', order: 1 },
    { key: 'onprocess', label: 'En cours', color: '#e6c46a', order: 2 },
    { key: 'tested', label: 'Testée', color: '#7ecb98', order: 3 },
    { key: 'needconfirmation', label: 'À valider', color: '#e0a458', order: 4 },
    { key: 'finished', label: 'Terminée', color: '#2f8f57', order: 5, meta: { isDone: true } },
    { key: 'confirmed', label: 'Validée', color: '#1c6a40', order: 6, meta: { isDone: true } },
  ],
  priority: [
    { key: 'P0', label: 'Bloquant', color: '#e85d70', order: 0 },
    { key: 'P1', label: 'Haute', color: '#e6c46a', order: 1 },
    { key: 'P2', label: 'Moyenne', color: '#9db4dd', order: 2 },
    { key: 'P3', label: 'Basse', color: '#6b7280', order: 3 },
  ],
  area: [{ key: 'general', label: 'Général', order: 0 }],
  type: [
    { key: 'feature', label: 'feature', order: 0 },
    { key: 'bug', label: 'bug', order: 1 },
    { key: 'chore', label: 'chore', order: 2 },
  ],
  techno: [],
  category: [],
  version: [{ key: '0.1.0', label: '0.1.0', order: 0 }],
  sprint: [{ key: 'backlog', label: 'Backlog', order: 0 }],
  eventType: [
    { key: 'refinement', label: 'Refinement', color: '#6b78ea', order: 0, meta: { icon: '🔍', features: ['participants', 'backlog', 'estimation', 'agenda', 'actions', 'decisions'] } },
    { key: 'grooming', label: 'Grooming', color: '#7ecb98', order: 1, meta: { icon: '🌱', features: ['participants', 'backlog', 'estimation', 'agenda'] } },
    { key: 'technical', label: 'Point technique', color: '#e6c46a', order: 2, meta: { icon: '🛠️', features: ['participants', 'agenda', 'decisions', 'actions', 'backlog'] } },
    { key: 'architecture', label: 'Point architecture', color: '#b39ddb', order: 3, meta: { icon: '🏛️', features: ['participants', 'adr', 'decisions', 'actions'] } },
    { key: 'demo_prep', label: 'Préparation démo', color: '#e0a458', order: 4, meta: { icon: '🎬', features: ['participants', 'demo', 'backlog', 'agenda'] } },
    { key: 'retro', label: 'Rétrospective', color: '#e85d70', order: 5, meta: { icon: '🔄', features: ['participants', 'decisions', 'actions', 'notes'] } },
  ],
};

router.get('/', async (req, res) => {
  const projects = await Project.find({ archived: false }).sort({ name: 1 });
  res.json({ projects });
});

router.post('/', requireRole(...MANAGER_ROLES), async (req, res) => {
  const { key, name, vendor, description, currentVersion } = req.body || {};
  if (!key || !name) return res.status(400).json({ error: 'key et name sont requis.' });
  const normalizedKey = String(key).toUpperCase().trim();
  const exists = await Project.findOne({ key: normalizedKey });
  if (exists) return res.status(409).json({ error: `Le projet "${normalizedKey}" existe déjà.` });

  const project = await Project.create({
    key: normalizedKey,
    name,
    vendor,
    description,
    currentVersion: currentVersion || '0.1.0',
    owner: req.user._id,
  });

  const seedDocs = [];
  for (const kind of KINDS) {
    for (const item of DEFAULT_TAXONOMIES[kind] || []) {
      seedDocs.push({ project: project._id, kind, ...item });
    }
  }
  if (seedDocs.length) await Taxonomy.insertMany(seedDocs);

  res.status(201).json({ project });
});

router.get('/:projectKey', loadProject, async (req, res) => {
  res.json({ project: req.project });
});

router.patch('/:projectKey', loadProject, requireRole(...MANAGER_ROLES), async (req, res) => {
  const {
    name,
    vendor,
    description,
    currentVersion,
    sprintDurationValue,
    sprintDurationUnit,
    currentSprint,
    archived,
  } = req.body || {};
  if (name !== undefined) req.project.name = name;
  if (vendor !== undefined) req.project.vendor = vendor;
  if (description !== undefined) req.project.description = description;
  if (currentVersion !== undefined) req.project.currentVersion = currentVersion;
  if (sprintDurationValue !== undefined) req.project.sprintDurationValue = Number(sprintDurationValue) || 1;
  if (sprintDurationUnit !== undefined && ['days', 'weeks'].includes(sprintDurationUnit)) {
    req.project.sprintDurationUnit = sprintDurationUnit;
  }
  if (currentSprint !== undefined) req.project.currentSprint = currentSprint;
  if (archived !== undefined) req.project.archived = archived;
  await req.project.save();
  res.json({ project: req.project });
});

router.get('/:projectKey/stats', loadProject, async (req, res) => {
  const tasks = await Task.find({ project: req.project._id });
  const statuses = await Taxonomy.find({ project: req.project._id, kind: 'status' });
  const doneIds = new Set(statuses.filter((s) => s.meta?.isDone).map((s) => s.key));
  const doneCount = tasks.filter((t) => doneIds.has(t.status)).length;
  const bugCount = tasks.filter((t) => t.type === 'bug').length;
  const totalPoints = tasks.reduce((a, t) => a + (t.complexity || 0), 0);
  res.json({
    total: tasks.length,
    done: doneCount,
    bugs: bugCount,
    totalPoints,
  });
});

module.exports = router;
