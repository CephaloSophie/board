const { Router } = require('express');
const { Task } = require('../models/Task');
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

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject, blockWritesIfArchived, requireWriteAccess);

const USER_FIELDS = 'username displayName color';

const toDateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const toLabels = (v) =>
  [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => String(s).trim()).filter(Boolean))];

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
  res.json({ tasks, warnings });
});

router.get('/:taskId', async (req, res) => {
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId })
    .populate('assignee', USER_FIELDS)
    .populate('reporter', USER_FIELDS)
    .populate('comments.author', USER_FIELDS)
    .populate('history.by', USER_FIELDS);
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  res.json({ task });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const defaults = req.project.defaults || {};
  const status = body.status || defaults.status;
  if (!body.title || !status) {
    return res.status(400).json({ error: 'title et status sont requis.' });
  }
  const { categoryOf } = await statusContext(req.project._id);
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
    parent: body.parent || null,
    estimate: body.estimate,
    duration: body.duration,
    durationHours: hoursOf(body.duration),
    complexity: body.complexity || 0,
    spec: body.spec,
    instructions: body.instructions || [],
    acceptance: body.acceptance || [],
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
        note: 'Tâche créée.',
      },
    ],
  });

  const populated = await task.populate([
    { path: 'assignee', select: USER_FIELDS },
    { path: 'reporter', select: USER_FIELDS },
  ]);
  res.status(201).json({ task: populated });
});

router.patch('/:taskId', async (req, res) => {
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });

  const { note, ...patch } = req.body || {};
  const { categoryOf } = await statusContext(req.project._id);
  applyPatchWithHistory(task, patch, req.user, note, { categoryOf });
  await task.save();

  const populated = await task.populate([
    { path: 'assignee', select: USER_FIELDS },
    { path: 'reporter', select: USER_FIELDS },
    { path: 'comments.author', select: USER_FIELDS },
    { path: 'history.by', select: USER_FIELDS },
  ]);
  res.json({ task: populated });
});

router.delete('/:taskId', requireProjectRole('admin'), async (req, res) => {
  const result = await Task.deleteOne({ project: req.project._id, taskId: req.params.taskId });
  if (!result.deletedCount) return res.status(404).json({ error: 'Tâche introuvable.' });
  res.json({ ok: true });
});

router.post('/:taskId/comments', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Le commentaire est vide.' });
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });

  task.comments.push({ author: req.user._id, text: text.trim() });
  await task.save();
  const populated = await task.populate('comments.author', USER_FIELDS);
  res.status(201).json({ comments: populated.comments });
});

router.patch('/:taskId/comments/:commentId', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Le commentaire est vide.' });
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  const comment = task.comments.id(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Commentaire introuvable.' });
  if (comment.author.toString() !== req.user._id.toString() && req.projectRole !== 'admin') {
    return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres commentaires.' });
  }
  comment.text = String(text).trim();
  comment.editedAt = new Date();
  await task.save();
  const populated = await task.populate('comments.author', USER_FIELDS);
  res.json({ comments: populated.comments });
});

router.delete('/:taskId/comments/:commentId', async (req, res) => {
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  const comment = task.comments.id(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Commentaire introuvable.' });
  if (comment.author.toString() !== req.user._id.toString() && req.projectRole !== 'admin') {
    return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres commentaires.' });
  }
  comment.deleteOne();
  await task.save();
  res.json({ ok: true });
});

module.exports = router;
