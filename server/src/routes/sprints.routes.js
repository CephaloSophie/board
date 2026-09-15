const { Router } = require('express');
const { Taxonomy } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { Event } = require('../models/Event');
const { requireAuth } = require('../middleware/auth');
const { loadProject, requireProjectRole, blockWritesIfArchived } = require('../middleware/project');
const { statusContext } = require('../utils/taxonomyMeta');
const { applyPatchWithHistory } = require('../utils/taskHistory');
const { logActivity, taskActivities, projectActivity } = require('../utils/activity');

// Sprint lifecycle: draft → ready → active → finished (→ reopen). Sprints are
// taxonomy rows (kind 'sprint'); lifecycle keys in `meta` are only written here.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);
const adminWrite = [requireProjectRole('admin'), blockWritesIfArchived];
const DAY = 86400000;

const conflict = (res, code, error, extra = {}) => res.status(409).json({ error, code, ...extra });

function dayStart(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function slug(label) {
  const s = String(label)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.startsWith('sprint') ? s : `sprint-${s || 'nouveau'}`;
}

async function findSprint(req, res, key = req.params.sprintKey) {
  const sprint = await Taxonomy.findOne({ project: req.project._id, kind: 'sprint', key });
  if (!sprint) res.status(404).json({ error: `Sprint "${key}" introuvable.` });
  return sprint;
}

async function setMeta(item, patch) {
  item.meta = { ...(item.meta || {}), ...patch };
  item.markModified('meta');
  await item.save();
  return item;
}

async function sprintStats(projectId, keys) {
  const ctx = await statusContext(projectId);
  const rows = await Task.aggregate([
    { $match: { project: projectId, sprint: { $in: keys } } },
    {
      $group: {
        _id: '$sprint',
        taskCount: { $sum: 1 },
        points: { $sum: '$complexity' },
        doneCount: { $sum: { $cond: [{ $in: ['$status', [...ctx.doneKeys]] }, 1, 0] } },
        donePoints: { $sum: { $cond: [{ $in: ['$status', [...ctx.doneKeys]] }, '$complexity', 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [r._id, { taskCount: r.taskCount, points: r.points, doneCount: r.doneCount, donePoints: r.donePoints }]));
}

function present(sprint, stats) {
  const o = sprint.toObject ? sprint.toObject() : sprint;
  return {
    ...o,
    meta: o.meta || {}, // empty meta objects are not persisted (Mongoose minimize)
    status: o.meta?.status || 'draft',
    stats: stats || { taskCount: 0, points: 0, doneCount: 0, donePoints: 0 },
  };
}

async function createSprint(project, body) {
  const label = String(body.label || '').trim();
  if (!label) {
    const err = new Error('Le nom du sprint est requis.');
    err.status = 400;
    throw err;
  }
  const existing = await Taxonomy.find({ project: project._id, kind: 'sprint' }).lean();
  let key = String(body.key || '').trim() || slug(label);
  const base = key;
  for (let i = 2; existing.some((s) => s.key === key); i++) key = `${base}-${i}`;

  const days = project.effectiveSprintDays();
  const last = existing
    .filter((s) => s.meta?.endDate)
    .sort((a, b) => new Date(b.meta.endDate) - new Date(a.meta.endDate))[0];
  const start =
    (body.startDate && dayStart(body.startDate)) || (last ? new Date(dayStart(last.meta.endDate).getTime() + DAY) : dayStart());
  const end = (body.endDate && dayStart(body.endDate)) || new Date(start.getTime() + (days - 1) * DAY);
  if (end < start) {
    const err = new Error('La date de fin précède la date de début.');
    err.status = 400;
    throw err;
  }
  return Taxonomy.create({
    project: project._id,
    kind: 'sprint',
    key,
    label,
    color: body.color,
    order: existing.reduce((m, s) => Math.max(m, s.order || 0), -1) + 1,
    meta: {
      status: 'draft',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      goal: body.goal || '',
      ...(body.linkedVersion ? { linkedVersion: body.linkedVersion } : {}),
    },
  });
}

async function activeSprintOtherThan(projectId, key) {
  return Taxonomy.findOne({ project: projectId, kind: 'sprint', archived: false, key: { $ne: key }, 'meta.status': 'active' });
}

async function startSprint(req, sprint, body = {}) {
  const tasks = await Task.find({ project: req.project._id, sprint: sprint.key }, { taskId: 1, complexity: 1 }).lean();
  const days = req.project.effectiveSprintDays();
  const startValue = body.startDate || sprint.meta?.startDate;
  const endValue = body.endDate || sprint.meta?.endDate;
  const start = (startValue && dayStart(startValue)) || dayStart();
  const end = (endValue && dayStart(endValue)) || new Date(start.getTime() + (days - 1) * DAY);
  await setMeta(sprint, {
    status: 'active',
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    ...(body.goal !== undefined ? { goal: body.goal } : {}),
    startedAt: new Date().toISOString(),
    startedBy: String(req.user._id),
    startSnapshot: {
      at: new Date().toISOString(),
      committedPoints: tasks.reduce((a, t) => a + (t.complexity || 0), 0),
      committedCount: tasks.length,
      taskIds: tasks.map((t) => t.taskId),
    },
  });
  req.project.currentSprint = sprint.key;
  await req.project.save();
  await sprintLog(req, sprint, 'sprint.started', `Sprint « ${sprint.label} » démarré.`, {
    committedPoints: sprint.meta.startSnapshot.committedPoints,
    committedCount: sprint.meta.startSnapshot.committedCount,
  });
  return sprint;
}

function sprintLog(req, sprint, action, note, data, extra = {}) {
  const { sprints = [], ...rest } = extra;
  return logActivity(
    projectActivity(req.project, req.user, { scope: 'sprint', action, note, sprints: [sprint.key, ...sprints], data: { label: sprint.label, ...data }, ...rest })
  );
}

router.get('/', async (req, res) => {
  const filter = { project: req.project._id, kind: 'sprint' };
  if (!['1', 'true'].includes(String(req.query.includeArchived))) filter.archived = false;
  if (req.query.status) filter['meta.status'] = req.query.status === 'draft' ? { $in: ['draft', null] } : req.query.status;
  const sprints = await Taxonomy.find(filter).sort({ order: 1, label: 1 });
  const stats = await sprintStats(req.project._id, sprints.map((s) => s.key));
  res.json({ sprints: sprints.map((s) => present(s, stats.get(s.key))), currentSprint: req.project.currentSprint });
});

// Choose the current sprint without starting it ({ key: null } clears it). An active sprint stays current.
router.put('/current', ...adminWrite, async (req, res) => {
  const key = req.body?.key || null;
  let sprint = null;
  if (key) {
    sprint = await Taxonomy.findOne({ project: req.project._id, kind: 'sprint', key, archived: false });
    if (!sprint) return res.status(404).json({ error: `Sprint "${key}" introuvable.` });
    if (sprint.meta?.status === 'finished') {
      return conflict(res, 'SPRINT_FINISHED', 'Un sprint terminé ne peut pas devenir le sprint courant : rouvrez-le.');
    }
  }
  const active = await activeSprintOtherThan(req.project._id, key);
  if (active) {
    return conflict(res, 'ACTIVE_SPRINT_EXISTS', `« ${active.label} » est actif : il reste le sprint courant jusqu'à sa clôture.`, {
      activeSprint: { key: active.key, label: active.label },
    });
  }
  const previous = req.project.currentSprint || null;
  if (previous !== key) {
    req.project.currentSprint = key;
    await req.project.save();
    await logActivity(
      projectActivity(req.project, req.user, {
        scope: 'sprint',
        action: 'sprint.current',
        field: 'currentSprint',
        from: previous,
        to: key,
        sprints: [previous, key],
        note: sprint ? `« ${sprint.label} » défini comme sprint courant.` : 'Plus de sprint courant.',
      })
    );
  }
  res.json({ currentSprint: req.project.currentSprint });
});

// Unfinished work of a sprint: tasks still in it, and tasks carried over at its closure (where they are now).
router.get('/:sprintKey/leftovers', async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  const ctx = await statusContext(req.project._id);
  const fields = { taskId: 1, title: 1, status: 1, complexity: 1, assignee: 1, sprint: 1, version: 1, priority: 1, type: 1 };
  const carriedIds = sprint.meta?.report?.carriedOverTaskIds || [];
  const find = (match) =>
    Task.find({ project: req.project._id, ...match }, fields).populate('assignee', 'username displayName color').sort({ taskId: 1 }).lean();
  const [still, carried] = await Promise.all([find({ sprint: sprint.key }), carriedIds.length ? find({ taskId: { $in: carriedIds } }) : []]);
  const withDone = (t) => ({ ...t, done: ctx.categoryOf(t.status) === 'done' });
  res.json({
    sprint: present(sprint),
    notDone: still.filter((t) => ctx.categoryOf(t.status) !== 'done').map(withDone),
    carriedOver: carried.map(withDone),
  });
});

router.post('/', ...adminWrite, async (req, res) => {
  const sprint = await createSprint(req.project, req.body || {});
  await sprintLog(req, sprint, 'sprint.created', `Sprint « ${sprint.label} » créé.`, { startDate: sprint.meta.startDate, endDate: sprint.meta.endDate });
  res.status(201).json({ sprint: present(sprint) });
});

router.patch('/:sprintKey', ...adminWrite, async (req, res) => {
  const b = req.body || {};
  if ('status' in b) {
    return res.status(400).json({ error: 'Utilisez les actions démarrer / clôturer pour changer le statut.', code: 'LIFECYCLE_FIELD' });
  }
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  if (b.label !== undefined) sprint.label = String(b.label).trim() || sprint.label;
  if (b.color !== undefined) sprint.color = b.color;
  if (b.order !== undefined) sprint.order = Number(b.order) || 0;
  const patch = {};
  if (b.startDate !== undefined) patch.startDate = b.startDate ? dayStart(b.startDate)?.toISOString() : undefined;
  if (b.endDate !== undefined) patch.endDate = b.endDate ? dayStart(b.endDate)?.toISOString() : undefined;
  if (b.goal !== undefined) patch.goal = String(b.goal || '');
  if (b.linkedVersion !== undefined) patch.linkedVersion = b.linkedVersion || undefined;
  const next = { ...(sprint.meta || {}), ...patch };
  if (next.startDate && next.endDate && new Date(next.endDate) < new Date(next.startDate)) {
    return res.status(400).json({ error: 'La date de fin précède la date de début.' });
  }
  await setMeta(sprint, patch);
  await sprintLog(req, sprint, 'sprint.updated', `Sprint « ${sprint.label} » modifié.`, { changes: Object.keys(b).filter((k) => k !== 'key') });
  res.json({ sprint: present(sprint) });
});

router.post('/:sprintKey/ready', ...adminWrite, async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  if ((sprint.meta?.status || 'draft') !== 'draft') return conflict(res, 'INVALID_TRANSITION', 'Seul un sprint brouillon peut passer « prêt ».');
  await setMeta(sprint, { status: 'ready' });
  await sprintLog(req, sprint, 'sprint.ready', `Sprint « ${sprint.label} » marqué prêt.`);
  res.json({ sprint: present(sprint) });
});

router.post('/:sprintKey/draft', ...adminWrite, async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  if (sprint.meta?.status !== 'ready') return conflict(res, 'INVALID_TRANSITION', 'Seul un sprint « prêt » peut repasser en brouillon.');
  await setMeta(sprint, { status: 'draft' });
  await sprintLog(req, sprint, 'sprint.draft', `Sprint « ${sprint.label} » repassé en brouillon.`);
  res.json({ sprint: present(sprint) });
});

router.post('/:sprintKey/start', ...adminWrite, async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  if (!['draft', 'ready', undefined].includes(sprint.meta?.status)) {
    return conflict(res, 'INVALID_TRANSITION', 'Ce sprint ne peut pas être démarré.');
  }
  const active = await activeSprintOtherThan(req.project._id, sprint.key);
  if (active) {
    return conflict(res, 'ACTIVE_SPRINT_EXISTS', `« ${active.label} » est déjà actif : clôturez-le d'abord.`, {
      activeSprint: { key: active.key, label: active.label },
    });
  }
  const b = req.body || {};
  if (b.startDate && b.endDate && new Date(b.endDate) < new Date(b.startDate)) {
    return res.status(400).json({ error: 'La date de fin précède la date de début.' });
  }
  await startSprint(req, sprint, b);
  const stats = await sprintStats(req.project._id, [sprint.key]);
  res.json({ sprint: present(sprint, stats.get(sprint.key)), currentSprint: req.project.currentSprint });
});

router.get('/:sprintKey/close-preview', async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  if (sprint.meta?.status !== 'active') return conflict(res, 'INVALID_TRANSITION', "Ce sprint n'est pas actif.");
  const ctx = await statusContext(req.project._id);
  const tasks = await Task.find({ project: req.project._id, sprint: sprint.key }, { taskId: 1, title: 1, status: 1, complexity: 1, assignee: 1 })
    .populate('assignee', 'username displayName color')
    .sort({ taskId: 1 })
    .lean();
  const done = tasks.filter((t) => ctx.categoryOf(t.status) === 'done');
  const targets = await Taxonomy.find({
    project: req.project._id,
    kind: 'sprint',
    archived: false,
    key: { $ne: sprint.key },
    'meta.status': { $in: ['draft', 'ready', null] },
  }).sort({ order: 1 });
  res.json({
    sprint: present(sprint),
    done: { count: done.length, points: done.reduce((a, t) => a + (t.complexity || 0), 0) },
    notDone: tasks.filter((t) => ctx.categoryOf(t.status) !== 'done'),
    targets: targets.map((t) => ({ key: t.key, label: t.label, status: t.meta?.status || 'draft', startDate: t.meta?.startDate, endDate: t.meta?.endDate })),
  });
});

router.post('/:sprintKey/close', ...adminWrite, async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  if (sprint.meta?.status !== 'active') return conflict(res, 'INVALID_TRANSITION', "Ce sprint n'est pas actif.");
  const b = req.body || {};
  const mode = b.carryOver?.mode || 'backlog';
  const keep = new Set((Array.isArray(b.keep) ? b.keep : []).map(String));

  // 1. Resolve where unfinished work goes.
  let target = null;
  if (mode === 'sprint') {
    target = await Taxonomy.findOne({ project: req.project._id, kind: 'sprint', key: b.carryOver?.targetKey, archived: false });
    if (!target || target.key === sprint.key || !['draft', 'ready', undefined].includes(target.meta?.status)) {
      return res.status(400).json({ error: 'Sprint cible invalide (brouillon ou prêt requis).', code: 'CARRY_TARGET_INVALID' });
    }
  } else if (mode === 'newSprint') {
    target = await createSprint(req.project, b.carryOver?.newSprint || {});
    await sprintLog(req, target, 'sprint.created', `Sprint « ${target.label} » créé pour le report.`);
  } else if (mode !== 'backlog') {
    return res.status(400).json({ error: 'Mode de report invalide.', code: 'CARRY_TARGET_INVALID' });
  }
  const targetKey = target ? target.key : null;

  // 2. Carry unfinished tasks over (before marking the sprint finished, so a retry resumes safely).
  const ctx = await statusContext(req.project._id);
  const inSprint = await Task.find({ project: req.project._id, sprint: sprint.key });
  const doneTasks = inSprint.filter((t) => ctx.categoryOf(t.status) === 'done');
  const notDone = inSprint.filter((t) => ctx.categoryOf(t.status) !== 'done');
  const carried = notDone.filter((t) => !keep.has(t.taskId));
  const note = `Report automatique à la clôture de « ${sprint.label} ».`;
  const carriedActivities = [];
  for (const task of carried) {
    const entries = applyPatchWithHistory(task, { sprint: targetKey }, req.user, note, { categoryOf: ctx.categoryOf });
    await task.save();
    carriedActivities.push(...taskActivities(req.project, task, entries, req.user, { data: { carryOver: sprint.key } }));
  }
  await logActivity(carriedActivities);

  // 3. Freeze the sprint report.
  const points = (list) => list.reduce((a, t) => a + (t.complexity || 0), 0);
  const snapshot = sprint.meta?.startSnapshot;
  const carriedIds = carried.map((t) => t.taskId);
  await setMeta(sprint, {
    status: 'finished',
    closedAt: new Date().toISOString(),
    closedBy: String(req.user._id),
    report: {
      committedPoints: snapshot?.committedPoints ?? points(inSprint),
      committedCount: snapshot?.committedCount ?? inSprint.length,
      completedPoints: points(doneTasks),
      completedCount: doneTasks.length,
      carriedOverTaskIds: carriedIds,
      carriedOverPoints: points(carried),
      carriedTo: targetKey,
      keptTaskIds: notDone.filter((t) => keep.has(t.taskId)).map((t) => t.taskId),
      source: 'lifecycle',
    },
  });
  req.project.currentSprint = null;
  await req.project.save();
  await sprintLog(
    req,
    sprint,
    'sprint.closed',
    `Sprint « ${sprint.label} » clôturé : ${doneTasks.length} tâche(s) livrée(s), ${carried.length} reportée(s)${target ? ` vers « ${target.label} »` : carried.length ? ' vers le backlog' : ''}.`,
    { report: sprint.meta.report },
    { sprints: [targetKey] }
  );

  // 4. Optionally start the target right away.
  if (b.startTarget && target) {
    const active = await activeSprintOtherThan(req.project._id, target.key);
    if (!active) await startSprint(req, target, {});
  }

  // 5. Optionally prepare the retrospective.
  let retroEventId = null;
  if (b.createRetro) {
    const retroType = await Taxonomy.findOne({ project: req.project._id, kind: 'eventType', key: 'retro', archived: false });
    if (retroType) {
      const participants = [...new Set(inSprint.map((t) => t.assignee && String(t.assignee)).filter(Boolean))];
      const event = await Event.create({
        project: req.project._id,
        type: 'retro',
        title: `Rétrospective — ${sprint.label}`,
        sprint: sprint.key,
        status: 'draft',
        participants,
        tasks: carried.map((t, i) => ({ task: t._id, taskId: t.taskId, note: 'Reportée', order: i })),
        notes:
          `Livré : ${doneTasks.length} tâche(s) · ${points(doneTasks)} pts` +
          ` / engagé : ${snapshot?.committedPoints ?? points(inSprint)} pts.\n` +
          `Reporté : ${carried.length} tâche(s) · ${points(carried)} pts${targetKey ? ` vers ${target.label}` : ' vers le backlog'}.`,
        createdBy: req.user._id,
      });
      retroEventId = event._id;
    }
  }

  res.json({
    sprint: present(sprint),
    target: target ? present(target) : null,
    carriedOver: carried.length,
    currentSprint: req.project.currentSprint,
    retroEventId,
  });
});

router.post('/:sprintKey/reopen', ...adminWrite, async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  if (sprint.meta?.status !== 'finished') return conflict(res, 'INVALID_TRANSITION', "Seul un sprint terminé peut être rouvert.");
  const active = await activeSprintOtherThan(req.project._id, sprint.key);
  if (active) {
    return conflict(res, 'ACTIVE_SPRINT_EXISTS', `« ${active.label} » est déjà actif.`, { activeSprint: { key: active.key, label: active.label } });
  }
  await setMeta(sprint, { status: 'active', reopenedAt: new Date().toISOString() });
  await sprintLog(req, sprint, 'sprint.reopened', `Sprint « ${sprint.label} » rouvert.`);
  req.project.currentSprint = sprint.key;
  await req.project.save();
  res.json({ sprint: present(sprint), currentSprint: req.project.currentSprint });
});

router.delete('/:sprintKey', ...adminWrite, async (req, res) => {
  const sprint = await findSprint(req, res);
  if (!sprint) return;
  const [tasks, historyRefs, events] = await Promise.all([
    Task.countDocuments({ project: req.project._id, sprint: sprint.key }),
    Task.countDocuments({ project: req.project._id, history: { $elemMatch: { field: 'sprint', $or: [{ from: sprint.key }, { to: sprint.key }] } } }),
    Event.countDocuments({ project: req.project._id, sprint: sprint.key }),
  ]);
  if (tasks || historyRefs || events) {
    return conflict(res, 'SPRINT_IN_USE', 'Ce sprint est référencé (tâches, historique ou rituels) : archivez-le plutôt.', {
      tasks,
      historyRefs,
      events,
    });
  }
  if (req.project.currentSprint === sprint.key) {
    req.project.currentSprint = null;
    await req.project.save();
  }
  await sprint.deleteOne();
  await sprintLog(req, sprint, 'sprint.deleted', `Sprint « ${sprint.label} » supprimé.`);
  res.json({ ok: true });
});

module.exports = router;
