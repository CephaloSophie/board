const mongoose = require('mongoose');
const { Router } = require('express');
const { Project, PROJECT_ACCESS } = require('../models/Project');
const { Taxonomy, KINDS } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { Event } = require('../models/Event');
const { User } = require('../models/User');
const { SavedFilter } = require('../models/SavedFilter');
const { Counter } = require('../models/Counter');
const { requireAuth, requireRole } = require('../middleware/auth');
const { loadProject, projectRoleFor, requireProjectRole } = require('../middleware/project');
const { statusContext } = require('../utils/taxonomyMeta');

const router = Router();
router.use(requireAuth);

const DEFAULT_TAXONOMIES = {
  status: [
    { key: 'draft', label: 'Brouillon', color: '#6b7280', order: 0, meta: { category: 'todo', isDone: false } },
    { key: 'pending', label: 'À faire', color: '#9db4dd', order: 1, meta: { category: 'todo', isDone: false } },
    { key: 'onprocess', label: 'En cours', color: '#e6c46a', order: 2, meta: { category: 'inprogress', isDone: false } },
    { key: 'tested', label: 'Testée', color: '#7ecb98', order: 3, meta: { category: 'inprogress', isDone: false } },
    { key: 'needconfirmation', label: 'À valider', color: '#e0a458', order: 4, meta: { category: 'inprogress', isDone: false } },
    { key: 'finished', label: 'Terminée', color: '#2f8f57', order: 5, meta: { category: 'done', isDone: true } },
    { key: 'confirmed', label: 'Validée', color: '#1c6a40', order: 6, meta: { category: 'done', isDone: true } },
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
    { key: 'bug', label: 'bug', color: '#e85d70', order: 1, meta: { isBug: true } },
    { key: 'chore', label: 'chore', order: 2 },
  ],
  techno: [],
  category: [],
  version: [],
  sprint: [],
  eventType: [
    { key: 'refinement', label: 'Refinement', color: '#6b78ea', order: 0, meta: { icon: '🔍', features: ['participants', 'backlog', 'estimation', 'agenda', 'actions', 'decisions'] } },
    { key: 'grooming', label: 'Grooming', color: '#7ecb98', order: 1, meta: { icon: '🌱', features: ['participants', 'backlog', 'estimation', 'agenda'] } },
    { key: 'technical', label: 'Point technique', color: '#e6c46a', order: 2, meta: { icon: '🛠️', features: ['participants', 'agenda', 'decisions', 'actions', 'backlog'] } },
    { key: 'architecture', label: 'Point architecture', color: '#b39ddb', order: 3, meta: { icon: '🏛️', features: ['participants', 'adr', 'decisions', 'actions'] } },
    { key: 'demo_prep', label: 'Préparation démo', color: '#e0a458', order: 4, meta: { icon: '🎬', features: ['participants', 'demo', 'backlog', 'agenda'] } },
    { key: 'retro', label: 'Rétrospective', color: '#e85d70', order: 5, meta: { icon: '🔄', features: ['participants', 'decisions', 'actions', 'notes'] } },
  ],
};

function withRole(project, user) {
  return { ...project.toObject(), myRole: projectRoleFor(project, user) };
}

function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ?archived=1 lists archived projects the caller administers.
router.get('/', async (req, res) => {
  const archived = ['1', 'true'].includes(String(req.query.archived));
  const projects = await Project.find({ archived }).sort({ name: 1 });
  const visible = projects.filter((p) => {
    const role = projectRoleFor(p, req.user);
    return role && (!archived || role === 'admin');
  });
  res.json({ projects: visible.map((p) => withRole(p, req.user)) });
});

router.post('/', requireRole('superadmin'), async (req, res) => {
  const { key, name, vendor, description, currentVersion } = req.body || {};
  if (!key || !name) return res.status(400).json({ error: 'key et name sont requis.' });
  const normalizedKey = String(key).toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(normalizedKey)) {
    return res.status(400).json({ error: 'La clé doit contenir 2 à 10 lettres/chiffres et commencer par une lettre.' });
  }
  const exists = await Project.findOne({ key: normalizedKey });
  if (exists) return res.status(409).json({ error: `Le projet "${normalizedKey}" existe déjà.` });

  const version = String(currentVersion || '0.1.0').trim();
  const project = await Project.create({
    key: normalizedKey,
    name,
    vendor,
    description,
    currentVersion: version,
    owner: req.user._id,
    members: [{ user: req.user._id, role: 'admin', addedBy: req.user._id }],
    defaults: { status: 'pending', type: 'feature', priority: 'P2' },
  });

  const seedDocs = [];
  for (const kind of KINDS) {
    for (const item of DEFAULT_TAXONOMIES[kind] || []) {
      seedDocs.push({ project: project._id, kind, ...item });
    }
  }
  seedDocs.push({ project: project._id, kind: 'version', key: version, label: version, order: 0, meta: { status: 'unreleased' } });
  await Taxonomy.insertMany(seedDocs);

  res.status(201).json({ project: withRole(project, req.user) });
});

router.get('/:projectKey', loadProject, async (req, res) => {
  res.json({ project: withRole(req.project, req.user) });
});

router.patch('/:projectKey', loadProject, requireProjectRole('admin'), async (req, res) => {
  const b = req.body || {};
  const p = req.project;

  if (b.name !== undefined) {
    if (!String(b.name).trim()) return res.status(400).json({ error: 'Le nom est requis.', field: 'name' });
    p.name = String(b.name).trim();
  }
  if (b.vendor !== undefined) p.vendor = b.vendor;
  if (b.description !== undefined) p.description = b.description;
  if (b.currentVersion !== undefined) p.currentVersion = b.currentVersion;
  if (b.sprintDurationValue !== undefined) p.sprintDurationValue = Math.min(Math.max(Number(b.sprintDurationValue) || 1, 1), 90);
  if (b.sprintDurationUnit !== undefined && ['days', 'weeks'].includes(b.sprintDurationUnit)) {
    p.sprintDurationUnit = b.sprintDurationUnit;
  }
  if (b.timezone !== undefined) {
    if (!isValidTimezone(b.timezone)) return res.status(400).json({ error: 'Fuseau horaire invalide.', field: 'timezone' });
    p.timezone = b.timezone;
  }
  if (b.workingDays !== undefined) {
    const days = [...new Set((Array.isArray(b.workingDays) ? b.workingDays : []).map(Number))].filter(
      (d) => Number.isInteger(d) && d >= 0 && d <= 6
    );
    if (!days.length) return res.status(400).json({ error: 'Au moins un jour ouvré est requis.', field: 'workingDays' });
    p.workingDays = days.sort();
  }
  if (b.estimation !== undefined) {
    const unit = ['points', 'hours'].includes(b.estimation?.unit) ? b.estimation.unit : p.estimation?.unit || 'points';
    const scale = (Array.isArray(b.estimation?.scale) ? b.estimation.scale : p.estimation?.scale || [])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0);
    p.estimation = { unit, scale: [...new Set(scale)].sort((x, y) => x - y) };
    p.complexityScale = `${unit === 'points' ? 'Points' : 'Heures'} : ${p.estimation.scale.join(', ')}`;
  }
  if (b.defaults !== undefined) {
    const taxonomies = await Taxonomy.find({ project: p._id, kind: { $in: ['status', 'type', 'priority'] } }).lean();
    const next = {};
    for (const field of ['status', 'type', 'priority']) {
      const v = b.defaults?.[field];
      if (!v) continue;
      if (!taxonomies.some((t) => t.kind === field && t.key === v)) {
        return res.status(400).json({ error: `Valeur par défaut inconnue pour ${field} : ${v}.`, field: `defaults.${field}` });
      }
      next[field] = v;
    }
    p.defaults = next;
  }
  if (b.access !== undefined) {
    if (!PROJECT_ACCESS.includes(b.access)) return res.status(400).json({ error: 'Mode d’accès invalide.', field: 'access' });
    const wouldBe = { owner: p.owner, members: p.members, access: b.access };
    if (!projectRoleFor(wouldBe, req.user)) {
      return res.status(409).json({ error: 'Vous perdriez l’accès à ce projet. Ajoutez-vous d’abord comme membre.', code: 'SELF_LOCKOUT' });
    }
    p.access = b.access;
  }
  // `currentSprint` and `archived` are driven by dedicated routes (sprint lifecycle, archive).

  await p.save();
  res.json({ project: withRole(p, req.user) });
});

router.get('/:projectKey/stats', loadProject, async (req, res) => {
  const pid = req.project._id;
  const [tasks, types, ctx] = await Promise.all([
    Task.find({ project: pid }, { status: 1, type: 1, complexity: 1 }).lean(),
    Taxonomy.find({ project: pid, kind: 'type' }).lean(),
    statusContext(pid),
  ]);
  const flagged = types.filter((t) => t.meta?.isBug).map((t) => t.key);
  const bugTypes = new Set(flagged.length ? flagged : ['bug']);
  let done = 0;
  let bugs = 0;
  let openBugs = 0;
  let inProgress = 0;
  let totalPoints = 0;
  let donePoints = 0;
  for (const t of tasks) {
    const category = ctx.categoryOf(t.status);
    const points = t.complexity || 0;
    totalPoints += points;
    if (category === 'done') {
      done += 1;
      donePoints += points;
    } else if (category === 'inprogress') inProgress += 1;
    if (bugTypes.has(t.type)) {
      bugs += 1;
      if (category !== 'done') openBugs += 1;
    }
  }
  res.json({ total: tasks.length, done, inProgress, bugs, openBugs, totalPoints, donePoints });
});

// Distinct labels used in the project, most used first (filter pickers).
router.get('/:projectKey/labels', loadProject, async (req, res) => {
  const rows = await Task.aggregate([
    { $match: { project: req.project._id } },
    { $unwind: '$labels' },
    { $group: { _id: '$labels', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  res.json({ labels: rows.map((r) => ({ value: r._id, count: r.count })) });
});

router.get('/:projectKey/overview', loadProject, async (req, res) => {
  const p = req.project;
  const [ctx, taskCount, sprints, last, users] = await Promise.all([
    statusContext(p._id),
    Task.countDocuments({ project: p._id }),
    Taxonomy.find({ project: p._id, kind: 'sprint', archived: false }).lean(),
    Task.findOne({ project: p._id }, { updatedAt: 1 }).sort({ updatedAt: -1 }).lean(),
    User.find({ active: true }, { role: 1 }).lean(),
  ]);
  const openCount = await Task.countDocuments({ project: p._id, status: { $nin: [...ctx.doneKeys] } });
  const active = sprints.find((s) => s.key === p.currentSprint) || sprints.find((s) => s.meta?.status === 'active');
  res.json({
    taskCount,
    openCount,
    memberCount: users.filter((u) => projectRoleFor(p, u)).length,
    sprintCount: sprints.length,
    activeSprint: active ? { key: active.key, label: active.label, meta: active.meta } : null,
    lastActivityAt: last?.updatedAt || null,
    createdAt: p.createdAt,
  });
});

router.post('/:projectKey/archive', loadProject, requireProjectRole('admin'), async (req, res) => {
  Object.assign(req.project, { archived: true, archivedAt: new Date(), archivedBy: req.user._id });
  await req.project.save();
  res.json({ project: withRole(req.project, req.user) });
});

router.post('/:projectKey/unarchive', loadProject, requireProjectRole('admin'), async (req, res) => {
  Object.assign(req.project, { archived: false, archivedAt: undefined, archivedBy: undefined });
  await req.project.save();
  res.json({ project: withRole(req.project, req.user) });
});

router.post('/:projectKey/transfer', loadProject, requireProjectRole('admin'), async (req, res) => {
  const user = await User.findById(req.body?.userId);
  if (!user || !user.active) return res.status(400).json({ error: 'Utilisateur introuvable ou inactif.' });
  const p = req.project;
  p.owner = user._id;
  const member = p.members.find((m) => String(m.user) === String(user._id));
  if (member) member.role = 'admin';
  else p.members.push({ user: user._id, role: 'admin', addedBy: req.user._id });
  await p.save();
  res.json({ project: withRole(p, req.user) });
});

// Permanent deletion: superadmin only, archived project, key typed as confirmation.
router.delete('/:projectKey', loadProject, requireRole('superadmin'), async (req, res) => {
  const p = req.project;
  if (!p.archived) {
    return res.status(409).json({ error: 'Archivez le projet avant de le supprimer.', code: 'NOT_ARCHIVED' });
  }
  const confirmKey = String(req.body?.confirmKey ?? req.query.confirmKey ?? '').toUpperCase();
  if (confirmKey !== p.key) {
    return res.status(400).json({ error: 'La clé de confirmation ne correspond pas.', code: 'CONFIRM_MISMATCH' });
  }
  const scope = { project: p._id };
  const optional = async (name) => (mongoose.models[name] ? (await mongoose.models[name].deleteMany(scope)).deletedCount : 0);
  const deleted = {
    tasks: (await Task.deleteMany(scope)).deletedCount,
    taxonomies: (await Taxonomy.deleteMany(scope)).deletedCount,
    events: (await Event.deleteMany(scope)).deletedCount,
    filters: (await SavedFilter.deleteMany(scope)).deletedCount,
    dashboards: await optional('Dashboard'),
    imports: await optional('ImportJob'),
  };
  await Counter.deleteOne({ _id: p.key });
  await p.deleteOne();
  res.json({ deleted });
});

module.exports = router;
