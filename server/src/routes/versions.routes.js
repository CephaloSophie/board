const { Router } = require('express');
const { Taxonomy } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { requireAuth } = require('../middleware/auth');
const { loadProject, requireProjectRole, blockWritesIfArchived } = require('../middleware/project');
const { statusContext } = require('../utils/taxonomyMeta');
const { applyPatchWithHistory } = require('../utils/taskHistory');
const { compareVersions } = require('../utils/versions');
const { logActivity, taskActivities, projectActivity } = require('../utils/activity');

const versionLog = (req, version, action, note, { versions = [], ...extra } = {}) =>
  logActivity(projectActivity(req.project, req.user, { scope: 'version', action, note, versions: [version.key, ...versions], ...extra }));

// Versions / releases: taxonomy rows (kind 'version') with a release lifecycle.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);
const adminWrite = [requireProjectRole('admin'), blockWritesIfArchived];

const toIsoDate = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

async function findVersion(req, res, key = req.params.versionKey) {
  const version = await Taxonomy.findOne({ project: req.project._id, kind: 'version', key });
  if (!version) res.status(404).json({ error: `Version "${key}" introuvable.` });
  return version;
}

async function setMeta(item, patch) {
  item.meta = { ...(item.meta || {}), ...patch };
  for (const [k, v] of Object.entries(item.meta)) if (v === undefined) delete item.meta[k];
  item.markModified('meta');
  await item.save();
}

router.get('/', async (req, res) => {
  const filter = { project: req.project._id, kind: 'version' };
  if (!['1', 'true'].includes(String(req.query.includeArchived))) filter.archived = false;
  const versions = await Taxonomy.find(filter).lean();
  const ctx = await statusContext(req.project._id);
  const rows = await Task.aggregate([
    { $match: { project: req.project._id, version: { $in: versions.map((v) => v.key) } } },
    {
      $group: {
        _id: '$version',
        taskCount: { $sum: 1 },
        points: { $sum: '$complexity' },
        doneCount: { $sum: { $cond: [{ $in: ['$status', [...ctx.doneKeys]] }, 1, 0] } },
      },
    },
  ]);
  const stats = new Map(rows.map((r) => [r._id, { taskCount: r.taskCount, points: r.points, doneCount: r.doneCount }]));
  versions.sort((a, b) => compareVersions(b.key, a.key));
  res.json({
    currentVersion: req.project.currentVersion,
    versions: versions.map((v) => ({
      ...v,
      meta: v.meta || {},
      status: v.meta?.status || 'unreleased',
      stats: stats.get(v.key) || { taskCount: 0, points: 0, doneCount: 0 },
    })),
  });
});

router.post('/', ...adminWrite, async (req, res) => {
  const b = req.body || {};
  const key = String(b.key || '').trim();
  if (!key) return res.status(400).json({ error: 'Le numéro de version est requis.' });
  if (await Taxonomy.exists({ project: req.project._id, kind: 'version', key })) {
    return res.status(409).json({ error: `La version "${key}" existe déjà.` });
  }
  const count = await Taxonomy.countDocuments({ project: req.project._id, kind: 'version' });
  const version = await Taxonomy.create({
    project: req.project._id,
    kind: 'version',
    key,
    label: String(b.label || key).trim(),
    order: count,
    meta: {
      status: 'unreleased',
      ...(toIsoDate(b.startDate) ? { startDate: toIsoDate(b.startDate) } : {}),
      ...(toIsoDate(b.releaseDate) ? { releaseDate: toIsoDate(b.releaseDate) } : {}),
      ...(b.description ? { description: String(b.description) } : {}),
    },
  });
  await versionLog(req, version, 'version.created', `Version ${version.label} créée.`);
  res.status(201).json({ version });
});

router.patch('/:versionKey', ...adminWrite, async (req, res) => {
  const b = req.body || {};
  if ('status' in b || 'releasedAt' in b) {
    return res.status(400).json({ error: 'Utilisez les actions publier / dépublier.', code: 'LIFECYCLE_FIELD' });
  }
  const version = await findVersion(req, res);
  if (!version) return;
  if (b.label !== undefined) version.label = String(b.label).trim() || version.label;
  if (b.order !== undefined) version.order = Number(b.order) || 0;
  if (b.archived !== undefined) version.archived = !!b.archived;
  const patch = {};
  if (b.startDate !== undefined) patch.startDate = toIsoDate(b.startDate);
  if (b.releaseDate !== undefined) patch.releaseDate = toIsoDate(b.releaseDate);
  if (b.description !== undefined) patch.description = b.description ? String(b.description) : undefined;
  await setMeta(version, patch);
  await versionLog(req, version, 'version.updated', `Version ${version.label} modifiée.`, { data: { changes: Object.keys(b) } });
  res.json({ version });
});

router.post('/:versionKey/release', ...adminWrite, async (req, res) => {
  const version = await findVersion(req, res);
  if (!version) return;
  const b = req.body || {};
  let moved = 0;
  if (b.moveOpenTo) {
    const target = await Taxonomy.findOne({ project: req.project._id, kind: 'version', key: b.moveOpenTo });
    if (!target || target.key === version.key || target.meta?.status === 'released') {
      return res.status(400).json({ error: 'Version cible invalide (non publiée requise).' });
    }
    const ctx = await statusContext(req.project._id);
    const open = await Task.find({ project: req.project._id, version: version.key, status: { $nin: [...ctx.doneKeys] } });
    const movedActivities = [];
    for (const task of open) {
      const entries = applyPatchWithHistory(task, { version: target.key }, req.user, `Report à la publication de la version ${version.key}.`, {
        categoryOf: ctx.categoryOf,
      });
      await task.save();
      movedActivities.push(...taskActivities(req.project, task, entries, req.user));
    }
    await logActivity(movedActivities);
    moved = open.length;
  }
  await setMeta(version, { status: 'released', releasedAt: toIsoDate(b.releasedAt) || new Date().toISOString() });
  await versionLog(req, version, 'version.released', `Version ${version.label} publiée${moved ? `, ${moved} tâche(s) reportée(s) vers ${b.moveOpenTo}` : ''}.`, {
    versions: [b.moveOpenTo],
    data: { moved },
  });
  if (b.setCurrent) {
    if (!(await Taxonomy.exists({ project: req.project._id, kind: 'version', key: b.setCurrent }))) {
      return res.status(400).json({ error: 'Version courante inconnue.' });
    }
    const previous = req.project.currentVersion;
    req.project.currentVersion = b.setCurrent;
    await req.project.save();
    if (previous !== b.setCurrent) {
      await versionLog(req, { key: b.setCurrent }, 'version.current', `Version courante : ${b.setCurrent}.`, {
        field: 'currentVersion',
        from: previous,
        to: b.setCurrent,
        versions: [previous],
      });
    }
  }
  res.json({ version, moved, currentVersion: req.project.currentVersion });
});

router.post('/:versionKey/unrelease', ...adminWrite, async (req, res) => {
  const version = await findVersion(req, res);
  if (!version) return;
  await setMeta(version, { status: 'unreleased', releasedAt: undefined });
  await versionLog(req, version, 'version.unreleased', `Version ${version.label} dépubliée.`);
  res.json({ version });
});

module.exports = router;
