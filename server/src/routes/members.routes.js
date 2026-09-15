const { Router } = require('express');
const { PROJECT_ROLES } = require('../models/Project');
const { User } = require('../models/User');
const { Task } = require('../models/Task');
const { requireAuth } = require('../middleware/auth');
const { loadProject, projectRoleFor, requireProjectRole, blockWritesIfArchived } = require('../middleware/project');
const { statusContext } = require('../utils/taxonomyMeta');
const { applyPatchWithHistory } = require('../utils/taskHistory');

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);
const adminOnly = requireProjectRole('admin');

// Every active user with an effective role on the project, with how they got
// it (listed member, owner, superadmin, or open access) and their open load.
async function memberRows(project) {
  const [users, ctx] = await Promise.all([User.find({ active: true }).sort({ displayName: 1 }), statusContext(project._id)]);
  const openCounts = await Task.aggregate([
    { $match: { project: project._id, assignee: { $ne: null }, status: { $nin: [...ctx.doneKeys] } } },
    { $group: { _id: '$assignee', n: { $sum: 1 } } },
  ]);
  const counts = new Map(openCounts.map((c) => [String(c._id), c.n]));
  const listed = new Map((project.members || []).map((m) => [String(m.user), m]));
  return users
    .map((u) => {
      const role = projectRoleFor(project, u);
      if (!role) return null;
      const m = listed.get(String(u._id));
      return {
        user: u.toPublic(),
        role,
        listed: !!m,
        isOwner: String(project.owner) === String(u._id),
        isSuperadmin: u.role === 'superadmin',
        addedAt: m?.addedAt || null,
        openTaskCount: counts.get(String(u._id)) || 0,
      };
    })
    .filter(Boolean);
}

// The project must keep an administrator (owner/listed admin or any active superadmin).
async function keepsAnAdmin(project) {
  const ids = [...project.members.filter((m) => m.role === 'admin').map((m) => m.user), project.owner].filter(Boolean);
  if (ids.length && (await User.countDocuments({ _id: { $in: ids }, active: true }))) return true;
  return (await User.countDocuments({ role: 'superadmin', active: true })) > 0;
}

router.get('/', async (req, res) => {
  res.json({ access: req.project.access, members: await memberRows(req.project) });
});

router.post('/', adminOnly, blockWritesIfArchived, async (req, res) => {
  const { userIds, role = 'member' } = req.body || {};
  if (!PROJECT_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  const ids = (Array.isArray(userIds) ? userIds : []).map(String);
  const users = await User.find({ _id: { $in: ids.filter((id) => /^[a-f0-9]{24}$/i.test(id)) }, active: true });
  const p = req.project;
  for (const u of users) {
    if (p.members.some((m) => String(m.user) === String(u._id))) continue;
    p.members.push({ user: u._id, role, addedBy: req.user._id });
  }
  await p.save();
  res.status(201).json({ access: p.access, members: await memberRows(p) });
});

router.patch('/:userId', adminOnly, blockWritesIfArchived, async (req, res) => {
  const { role } = req.body || {};
  if (!PROJECT_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  const p = req.project;
  if (String(p.owner) === req.params.userId && role !== 'admin') {
    return res.status(400).json({ error: 'Le responsable du projet reste administrateur. Transférez d’abord la responsabilité.' });
  }
  const user = await User.findById(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  const member = p.members.find((m) => String(m.user) === String(user._id));
  if (member) member.role = role;
  else p.members.push({ user: user._id, role, addedBy: req.user._id });
  if (!(await keepsAnAdmin(p))) {
    return res.status(409).json({ error: 'Le projet doit conserver au moins un administrateur.', code: 'LAST_ADMIN' });
  }
  await p.save();
  res.json({ access: p.access, members: await memberRows(p) });
});

router.delete('/:userId', adminOnly, blockWritesIfArchived, async (req, res) => {
  const p = req.project;
  const index = p.members.findIndex((m) => String(m.user) === req.params.userId);
  if (index === -1) return res.status(404).json({ error: 'Ce membre n’est pas listé sur le projet.' });
  p.members.splice(index, 1);
  if (!(await keepsAnAdmin(p))) {
    return res.status(409).json({ error: 'Le projet doit conserver au moins un administrateur.', code: 'LAST_ADMIN' });
  }
  await p.save();

  let unassigned = 0;
  if (['1', 'true'].includes(String(req.query.unassignOpenTasks))) {
    const ctx = await statusContext(p._id);
    const tasks = await Task.find({ project: p._id, assignee: req.params.userId, status: { $nin: [...ctx.doneKeys] } });
    for (const t of tasks) {
      applyPatchWithHistory(t, { assignee: null }, req.user, 'Retrait du membre du projet.', { categoryOf: ctx.categoryOf });
      await t.save();
    }
    unassigned = tasks.length;
  }
  res.json({ access: p.access, members: await memberRows(p), unassigned });
});

module.exports = router;
