const { Router } = require('express');
const { Task } = require('../models/Task');
const { Taxonomy } = require('../models/Taxonomy');
const { SavedFilter, sanitizeFilters } = require('../models/SavedFilter');
const { nextTaskNumber } = require('../models/Counter');
const { requireAuth } = require('../middleware/auth');
const {
  loadProject,
  requireProjectRole,
  requireWriteAccess,
  blockWritesIfArchived,
} = require('../middleware/project');
const { applyPatchWithHistory } = require('../utils/taskHistory');
const { statusContext } = require('../utils/taxonomyMeta');
const {
  compileTaskQuery,
  parseTaskQueryParams,
  overlayFilters,
  parseSort,
  SUMMARY_PROJECTION,
} = require('../utils/taskQuery');
const { hoursOf } = require('../utils/duration');
const { httpError } = require('../utils/httpError');
const { logActivity, taskActivities, projectActivity } = require('../utils/activity');
const { resolveMentions, excerptOf, notify } = require('../utils/notify');
const { FULL_POPULATE, USER_FIELDS, findTask, ensureCriteria } = require('../utils/taskEvents');
const { criteriaFromInput } = require('../utils/criteria');
const { mergeRequestFromInput, MAX_MERGE_REQUESTS } = require('../utils/mergeRequests');
const { assertValidParent, ancestorsOf, subtaskStats, normalizeKey } = require('../utils/subtasks');

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject, blockWritesIfArchived, requireWriteAccess);

const REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '😕', '🚀', '👀', '✅', '🔥'];
// Fields a bulk action may set (planning: move to sprint / version, reassign, change status…).
const BULK_FIELDS = ['sprint', 'version', 'assignee', 'status', 'priority', 'type', 'category', 'techno', 'area', 'dueDate', 'parent'];
const BULK_LIMIT = 500;
// Text fields scanned for @mentions.
const MENTION_FIELDS = ['title', 'description', 'instructions', 'acceptance'];

const toDateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const toLabels = (v) =>
  [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => String(s).trim()).filter(Boolean))];
const textOf = (task, fields = MENTION_FIELDS) =>
  fields.map((f) => (Array.isArray(task[f]) ? task[f].join('\n') : task[f] || '')).join('\n');

function mergeRequestsFromInput(input, user) {
  const list = (Array.isArray(input) ? input : [])
    .filter((m) => (typeof m === 'string' ? m.trim() : m?.url))
    .map((m) => mergeRequestFromInput(m, user));
  const unique = list.filter((m, i) => list.findIndex((o) => o.url === m.url) === i);
  if (unique.length > MAX_MERGE_REQUESTS) throw httpError(400, 'TOO_MANY_MR', `${MAX_MERGE_REQUESTS} merge requests maximum par tâche.`);
  return unique;
}

/**
 * A task moved under / out of a parent: the parent's own history records the
 * sub-task link (with activity), and its people hear about new sub-tasks.
 */
async function recordParentLinks(req, child, fromKey, toKey) {
  const now = new Date();
  const links = [
    fromKey && { key: fromKey, row: { field: 'subtask', from: child.taskId, to: null, note: `Sous-tâche retirée : ${child.taskId} · ${excerptOf(child.title, 80)}` } },
    toKey && { key: toKey, row: { field: 'subtask', from: null, to: child.taskId, note: `Sous-tâche ajoutée : ${child.taskId} · ${excerptOf(child.title, 80)}` } },
  ].filter(Boolean);
  for (const { key, row } of links) {
    const entry = { at: now, by: req.user._id, byLabel: req.user.displayName, ...row };
    const parent = await Task.findOneAndUpdate(
      { project: req.project._id, taskId: key },
      { $push: { history: entry } },
      { projection: { taskId: 1, title: 1, sprint: 1, version: 1, assignee: 1, reporter: 1 }, timestamps: false }
    ).lean();
    if (!parent) continue;
    await logActivity(taskActivities(req.project, parent, [entry], req.user));
    if (row.to) {
      await notify(req.project, req.user, { taskId: parent.taskId, taskTitle: parent.title, excerpt: row.note }, [
        { user: parent.assignee, type: 'subtask' },
        { user: parent.reporter, type: 'subtask' },
      ]);
    }
  }
}

function findComment(task, id) {
  const comment = task.comments.id(id);
  if (!comment) throw httpError(404, 'COMMENT_NOT_FOUND', 'Commentaire introuvable.');
  return comment;
}

function assertCommentOwner(req, comment, verb) {
  if (String(comment.author) === String(req.user._id) || req.projectRole === 'admin') return;
  throw httpError(403, 'NOT_COMMENT_AUTHOR', `Vous ne pouvez ${verb} que vos propres commentaires.`);
}

async function statusLabels(projectId, keys) {
  const rows = await Taxonomy.find({ project: projectId, kind: 'status', key: { $in: keys.filter(Boolean) } }, { key: 1, label: 1 }).lean();
  const map = new Map(rows.map((r) => [r.key, r.label]));
  return (key) => (key ? map.get(key) || key : '—');
}

/**
 * Side effects of a task change: audit log + notifications (assignment,
 * status change for the assignee / reporter, new @mentions in the texts).
 */
async function afterTaskChange(req, task, entries, { previousText = '', extraActivity = {} } = {}) {
  if (!entries.length) return;
  await logActivity(taskActivities(req.project, task, entries, req.user, extraActivity));
  const parentMove = entries.find((e) => e.field === 'parent');
  if (parentMove) await recordParentLinks(req, task, parentMove.from, parentMove.to);
  else if (entries.some((e) => e.field === 'created') && task.parent) await recordParentLinks(req, task, null, task.parent);

  const recipients = [];
  const mentionEntry = entries.some((e) => MENTION_FIELDS.includes(e.field) || e.field === 'created');
  if (mentionEntry) {
    const before = new Set((await resolveMentions(req.project, previousText)).map((u) => String(u._id)));
    for (const u of await resolveMentions(req.project, textOf(task))) {
      if (!before.has(String(u._id))) recipients.push({ user: u._id, type: 'mention', data: { excerpt: excerptOf(task.description) || task.title } });
    }
  }
  const assigned = entries.find((e) => e.field === 'assignee' && e.to);
  if (assigned) recipients.push({ user: assigned.to, type: 'assigned', data: { excerpt: entries[0].note || 'Tâche assignée.' } });
  if (!assigned && entries.some((e) => e.field === 'created') && task.assignee) {
    recipients.push({ user: task.assignee, type: 'assigned', data: { excerpt: 'Nouvelle tâche assignée.' } });
  }
  const status = entries.find((e) => e.field === 'status');
  if (status) {
    const label = await statusLabels(req.project._id, [status.from, status.to]);
    const excerpt = `${label(status.from)} → ${label(status.to)}`;
    recipients.push({ user: task.assignee, type: 'status', data: { excerpt } }, { user: task.reporter, type: 'status', data: { excerpt } });
  }
  await notify(req.project, req.user, { taskId: task.taskId, taskTitle: task.title }, recipients);
}

// GET /api/projects/:projectKey/tasks
// Filters: repeatable ?status=a&status=b on every dimension, dynamic tokens
// (@me, @current, @open, @none…), statusCategory, labels, dates, search.
// Extras: filterId (saved filter, explicit params override it),
// fields=summary (no history/comments), sort=key:asc|desc, limit/skip
// (X-Total-Count header).
router.get('/', async (req, res) => {
  let filters = parseTaskQueryParams(req.query);
  if (req.query.filterId) {
    const saved = await SavedFilter.findOne({ _id: req.query.filterId, project: req.project._id });
    const visible = saved && (saved.visibility === 'shared' || String(saved.owner) === String(req.user._id));
    if (!visible) return res.status(404).json({ error: 'Filtre introuvable ou non partagé.', code: 'FILTER_NOT_FOUND' });
    filters = overlayFilters(sanitizeFilters(saved.filters), filters);
  }

  const { match, warnings } = await compileTaskQuery(filters, { project: req.project, user: req.user });
  if (req.query.taskIds) {
    const ids = String(req.query.taskIds).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    match.taskId = { $in: ids };
  }
  let query = Task.find(match)
    .populate('assignee', USER_FIELDS)
    .populate('reporter', USER_FIELDS)
    .sort(parseSort(req.query.sort));
  if (req.query.fields === 'summary') query = query.select(SUMMARY_PROJECTION);

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
  if (limit) {
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    query = query.skip(skip).limit(limit);
    res.set('X-Total-Count', String(await Task.countDocuments(match)));
  }

  const tasks = await query;
  // Card badges: number of (done) sub-tasks of each listed task.
  let stats;
  if (req.query.fields === 'summary' && tasks.length) {
    const { doneKeys } = await statusContext(req.project._id);
    stats = await subtaskStats(req.project._id, tasks.map((t) => t.taskId), [...doneKeys]);
  }
  res.json({ tasks, warnings, ...(stats ? { subtaskStats: stats } : {}) });
});

// Bulk change of planning fields: { taskIds: [], patch: { sprint?, version?, assignee?, status?… }, note? }.
router.post('/bulk', async (req, res) => {
  const b = req.body || {};
  const taskIds = [...new Set((Array.isArray(b.taskIds) ? b.taskIds : []).map((s) => String(s).toUpperCase()))];
  if (!taskIds.length) throw httpError(400, 'NO_TASKS', 'Aucune tâche sélectionnée.');
  if (taskIds.length > BULK_LIMIT) throw httpError(400, 'TOO_MANY_TASKS', `${BULK_LIMIT} tâches maximum par action groupée.`);
  const patch = {};
  for (const f of BULK_FIELDS) if (b.patch && f in b.patch) patch[f] = b.patch[f];
  if (!Object.keys(patch).length) throw httpError(400, 'EMPTY_PATCH', 'Aucune modification demandée.');

  const { categoryOf } = await statusContext(req.project._id);
  const tasks = await Task.find({ project: req.project._id, taskId: { $in: taskIds } });
  if ('parent' in patch) {
    // Validate the whole batch first: a bulk action is all-or-nothing on the hierarchy.
    for (const task of tasks) patch.parent = await assertValidParent(req.project._id, task.taskId, patch.parent);
    if (!tasks.length) patch.parent = await assertValidParent(req.project._id, null, patch.parent);
  }
  const note = String(b.note || '').trim() || 'Action groupée (planification).';
  let updated = 0;
  for (const task of tasks) {
    const entries = applyPatchWithHistory(task, patch, req.user, note, { categoryOf });
    if (!entries.length) continue;
    await task.save();
    updated += 1;
    await afterTaskChange(req, task, entries, { extraActivity: { data: { bulk: true } } });
  }
  const found = new Set(tasks.map((t) => t.taskId));
  res.json({ updated, unchanged: tasks.length - updated, notFound: taskIds.filter((id) => !found.has(id)) });
});

router.get('/:taskId', async (req, res) => {
  const task = await findTask(req);
  await ensureCriteria(task);
  res.json({ task: await task.populate(FULL_POPULATE) });
});

// Hierarchy around a task: direct sub-tasks (with their own counters), ancestors (breadcrumb) and roll-up.
router.get('/:taskId/subtasks', async (req, res) => {
  const task = await findTask(req);
  const { categoryOf, doneKeys } = await statusContext(req.project._id);
  const subtasks = await Task.find({ project: req.project._id, parent: task.taskId })
    .select(SUMMARY_PROJECTION)
    .populate('assignee', USER_FIELDS)
    .sort({ taskId: 1 });
  const ancestors = (await ancestorsOf(req.project._id, task.parent)).map(({ taskId, title, status, type }) => ({ taskId, title, status, type }));
  const rollup = { total: subtasks.length, done: 0, points: 0, donePoints: 0 };
  for (const t of subtasks) {
    const done = categoryOf(t.status) === 'done';
    rollup.points += t.complexity || 0;
    if (done) {
      rollup.done += 1;
      rollup.donePoints += t.complexity || 0;
    }
  }
  const stats = await subtaskStats(req.project._id, subtasks.map((t) => t.taskId), [...doneKeys]);
  res.json({ subtasks, ancestors, rollup, subtaskStats: stats });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const defaults = req.project.defaults || {};
  const status = body.status || defaults.status;
  if (!body.title || !status) {
    return res.status(400).json({ error: 'title et status sont requis.' });
  }
  const { categoryOf } = await statusContext(req.project._id);
  // Validate everything before consuming a task number.
  const parent = await assertValidParent(req.project._id, null, body.parent);
  const criteria = criteriaFromInput(Array.isArray(body.criteria) ? body.criteria : body.acceptance || [], req.user);
  const mergeRequests = mergeRequestsFromInput(body.mergeRequests, req.user);
  const seq = await nextTaskNumber(req.project.key);
  const taskId = `${req.project.key}-${String(seq).padStart(3, '0')}`;
  const now = new Date();

  const task = await Task.create({
    project: req.project._id,
    taskId,
    title: body.title,
    description: body.description || '',
    area: body.area,
    module: body.module,
    type: body.type || defaults.type,
    status,
    priority: body.priority || defaults.priority,
    version: body.version,
    sprint: body.sprint || null,
    techno: body.techno,
    category: body.category,
    labels: toLabels(body.labels),
    parent,
    estimate: body.estimate,
    duration: body.duration,
    durationHours: hoursOf(body.duration),
    complexity: body.complexity || 0,
    spec: body.spec,
    instructions: body.instructions || [],
    criteria,
    mergeRequests,
    assignee: body.assignee || null,
    reporter: req.user._id,
    dueDate: toDateOrNull(body.dueDate),
    statusChangedAt: now,
    resolvedAt: categoryOf(status) === 'done' ? now : null,
    history: [
      {
        at: now,
        by: req.user._id,
        byLabel: req.user.displayName,
        field: 'created',
        from: null,
        to: status,
        note: parent ? `Tâche créée (sous-tâche de ${parent}).` : 'Tâche créée.',
      },
    ],
  });
  await afterTaskChange(req, task, task.history.slice());

  const populated = await task.populate([
    { path: 'assignee', select: USER_FIELDS },
    { path: 'reporter', select: USER_FIELDS },
  ]);
  res.status(201).json({ task: populated });
});

router.patch('/:taskId', async (req, res) => {
  const task = await findTask(req);
  const { note, ...patch } = req.body || {};
  if ('parent' in patch) patch.parent = await assertValidParent(req.project._id, task.taskId, patch.parent);
  if (Array.isArray(patch.criteria) && !('acceptance' in patch)) {
    // Whole-list replacement from an editor: texts drive the sync (ids, done flags and comments kept on matches).
    patch.acceptance = criteriaFromInput(patch.criteria, req.user).map((c) => c.text);
  }
  delete patch.criteria;
  delete patch.mergeRequests;
  const previousText = textOf(task);
  const { categoryOf } = await statusContext(req.project._id);
  const entries = applyPatchWithHistory(task, patch, req.user, note, { categoryOf });
  await task.save();
  await afterTaskChange(req, task, entries, { previousText });

  res.json({ task: await task.populate(FULL_POPULATE) });
});

router.delete('/:taskId', requireProjectRole('admin'), async (req, res) => {
  const task = await Task.findOneAndDelete({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  // Sub-tasks survive their parent: they are detached (with history), never deleted in cascade.
  const children = await Task.find({ project: req.project._id, parent: task.taskId });
  const { categoryOf } = await statusContext(req.project._id);
  for (const child of children) {
    const entries = applyPatchWithHistory(child, { parent: null }, req.user, `Tâche parente ${task.taskId} supprimée.`, { categoryOf });
    await child.save();
    await logActivity(taskActivities(req.project, child, entries, req.user));
  }
  await logActivity(
    projectActivity(req.project, req.user, {
      scope: 'task',
      action: 'task.deleted',
      taskId: task.taskId,
      taskTitle: task.title,
      sprints: [task.sprint],
      versions: [task.version],
    })
  );
  res.json({ ok: true, detached: children.map((c) => c.taskId) });
});

// ---------- Comments: threads (one reply level), @mentions, reactions ----------

async function commentSideEffects(req, task, { action, note, from = null, to = null, comment, recipients = [] }) {
  task.history.push({ at: new Date(), by: req.user._id, byLabel: req.user.displayName, field: 'comment', from, to, note });
  await task.save();
  await logActivity(
    projectActivity(req.project, req.user, {
      scope: 'comment',
      action,
      taskId: task.taskId,
      taskTitle: task.title,
      field: 'comment',
      from,
      to,
      note,
      sprints: [task.sprint],
      versions: [task.version],
      data: comment ? { commentId: comment._id } : undefined,
    })
  );
  if (recipients.length) {
    await notify(req.project, req.user, { taskId: task.taskId, taskTitle: task.title, commentId: comment?._id, excerpt: to || from }, recipients);
  }
}

router.post('/:taskId/comments', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) throw httpError(400, 'COMMENT_EMPTY', 'Le commentaire est vide.');
  const task = await findTask(req);

  let parent = null;
  if (req.body?.parent) {
    parent = findComment(task, req.body.parent);
    if (parent.parent) parent = task.comments.id(parent.parent) || parent; // replies stay one level deep
  }
  const mentioned = await resolveMentions(req.project, text);
  const comment = task.comments.create({
    author: req.user._id,
    text,
    parent: parent?._id || null,
    mentions: mentioned.length ? mentioned.map((u) => u._id) : undefined,
  });
  task.comments.push(comment);
  await commentSideEffects(req, task, {
    action: parent ? 'comment.replied' : 'comment.added',
    note: parent ? 'Réponse à un commentaire.' : 'Commentaire ajouté.',
    to: excerptOf(text),
    comment,
    recipients: [
      ...mentioned.map((u) => ({ user: u._id, type: 'mention' })),
      ...(parent?.author ? [{ user: parent.author, type: 'reply' }] : []),
      // Everyone already in the thread hears about replies.
      ...(parent ? task.comments.filter((c) => String(c.parent) === String(parent._id) && c.author).map((c) => ({ user: c.author, type: 'reply' })) : []),
      { user: task.assignee, type: 'comment' },
      { user: task.reporter, type: 'comment' },
    ],
  });

  const populated = await task.populate(FULL_POPULATE);
  res.status(201).json({ comments: populated.comments, commentId: comment._id });
});

// { text? } edits (author or admin); { pinned? } / { resolved? } (root comments) are open to every writer.
router.patch('/:taskId/comments/:commentId', async (req, res) => {
  const b = req.body || {};
  const hasText = b.text !== undefined;
  if (!hasText && b.pinned === undefined && b.resolved === undefined) {
    throw httpError(400, 'EMPTY_PATCH', 'Aucune modification demandée.');
  }
  const text = hasText ? String(b.text || '').trim() : null;
  if (hasText && !text) throw httpError(400, 'COMMENT_EMPTY', 'Le commentaire est vide.');
  const task = await findTask(req);
  const comment = findComment(task, req.params.commentId);
  if (hasText) assertCommentOwner(req, comment, 'modifier');

  if (b.pinned !== undefined && Boolean(b.pinned) !== Boolean(comment.pinned)) {
    const pinned = Boolean(b.pinned);
    comment.pinned = pinned || undefined;
    comment.pinnedAt = pinned ? new Date() : undefined;
    comment.pinnedBy = pinned ? req.user._id : undefined;
    await commentSideEffects(req, task, {
      action: pinned ? 'comment.pinned' : 'comment.unpinned',
      note: pinned ? 'Commentaire épinglé.' : 'Commentaire désépinglé.',
      to: excerptOf(comment.text),
      comment,
    });
  }

  if (b.resolved !== undefined && Boolean(b.resolved) !== Boolean(comment.resolved)) {
    if (comment.parent) throw httpError(400, 'COMMENT_NOT_ROOT', 'Seul le commentaire qui ouvre la discussion peut être résolu.');
    const resolved = Boolean(b.resolved);
    comment.resolved = resolved || undefined;
    comment.resolvedAt = resolved ? new Date() : undefined;
    comment.resolvedBy = resolved ? req.user._id : undefined;
    await commentSideEffects(req, task, {
      action: resolved ? 'comment.resolved' : 'comment.reopened',
      note: resolved ? 'Discussion résolue.' : 'Discussion rouverte.',
      to: excerptOf(comment.text),
      comment,
      recipients: resolved && comment.author ? [{ user: comment.author, type: 'reply' }] : [],
    });
  }

  if (hasText && text !== comment.text) {
    const before = await resolveMentions(req.project, comment.text);
    const after = await resolveMentions(req.project, text);
    const previous = comment.text;
    comment.text = text;
    comment.editedAt = new Date();
    comment.mentions = after.length ? after.map((u) => u._id) : undefined;
    const known = new Set(before.map((u) => String(u._id)));
    await commentSideEffects(req, task, {
      action: 'comment.edited',
      note: 'Commentaire modifié.',
      from: excerptOf(previous),
      to: excerptOf(text),
      comment,
      recipients: after.filter((u) => !known.has(String(u._id))).map((u) => ({ user: u._id, type: 'mention' })),
    });
  }
  res.json({ comments: (await task.populate(FULL_POPULATE)).comments });
});

router.delete('/:taskId/comments/:commentId', async (req, res) => {
  const task = await findTask(req);
  const comment = findComment(task, req.params.commentId);
  assertCommentOwner(req, comment, 'supprimer');
  const replies = task.comments.filter((c) => String(c.parent) === String(comment._id));
  const excerpt = excerptOf(comment.text);
  for (const reply of replies) reply.deleteOne();
  comment.deleteOne();
  await commentSideEffects(req, task, {
    action: 'comment.deleted',
    note: replies.length ? `Commentaire supprimé (avec ${replies.length} réponse(s)).` : 'Commentaire supprimé.',
    from: excerpt,
  });
  res.json({ ok: true, removed: 1 + replies.length });
});

// Toggle the current user's reaction: { emoji }.
router.post('/:taskId/comments/:commentId/reactions', async (req, res) => {
  const emoji = String(req.body?.emoji || '');
  if (!REACTIONS.includes(emoji)) throw httpError(400, 'REACTION_INVALID', 'Réaction non prise en charge.', { allowed: REACTIONS });
  const task = await findTask(req);
  const comment = findComment(task, req.params.commentId);
  const uid = String(req.user._id);
  const reactions = comment.reactions ? [...comment.reactions] : [];
  let entry = reactions.find((r) => r.emoji === emoji);
  let added = false;
  if (!entry) {
    reactions.push({ emoji, users: [req.user._id] });
    added = true;
  } else if (entry.users.some((u) => String(u) === uid)) {
    entry.users = entry.users.filter((u) => String(u) !== uid);
  } else {
    entry.users.push(req.user._id);
    added = true;
  }
  comment.reactions = reactions.filter((r) => r.users.length);
  task.markModified('comments');
  await task.save({ timestamps: false });
  if (added) {
    await logActivity(
      projectActivity(req.project, req.user, {
        scope: 'comment',
        action: 'reaction.added',
        taskId: task.taskId,
        taskTitle: task.title,
        to: emoji,
        sprints: [task.sprint],
        versions: [task.version],
        data: { commentId: comment._id },
      })
    );
    await notify(
      req.project,
      req.user,
      { taskId: task.taskId, taskTitle: task.title, commentId: comment._id, excerpt: `${emoji} sur « ${excerptOf(comment.text, 80)} »` },
      [{ user: comment.author, type: 'reaction' }]
    );
  }
  res.json({ comments: (await task.populate(FULL_POPULATE)).comments, added });
});

module.exports = router;
module.exports.REACTIONS = REACTIONS;
