const { Router } = require('express');
const { Task } = require('../models/Task');
const { nextTaskNumber } = require('../models/Counter');
const { requireAuth } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');
const { applyPatchWithHistory } = require('../utils/taskHistory');

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : String(v).split(',').filter(Boolean);
}

// GET /api/projects/:projectKey/tasks
// Supports repeatable multi-select filters (?status=a&status=b or ?status=a,b)
// on every taxonomy dimension, plus assignee, sprint and free-text search
// across id / title / description / instructions / acceptance.
router.get('/', async (req, res) => {
  const q = req.query;
  const filter = { project: req.project._id };

  const multiFields = ['status', 'priority', 'type', 'category', 'techno', 'version', 'sprint', 'area'];
  for (const field of multiFields) {
    const values = toArray(q[field]);
    if (values.length) filter[field] = { $in: values };
  }

  const assignees = toArray(q.assignee);
  if (assignees.length) {
    filter.assignee = { $in: assignees.map((a) => (a === 'unassigned' ? null : a)) };
  }

  let tasks = await Task.find(filter)
    .populate('assignee', 'username displayName color')
    .populate('reporter', 'username displayName color')
    .populate('team', 'name color')
    .sort({ taskId: 1 });

  if (q.search) {
    const needle = String(q.search).toLowerCase();
    tasks = tasks.filter((t) => {
      const hay = [
        t.taskId,
        t.title,
        t.module,
        t.description,
        ...(t.instructions || []),
        ...(t.acceptance || []),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  res.json({ tasks });
});

router.get('/:taskId', async (req, res) => {
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId })
    .populate('assignee', 'username displayName color')
    .populate('reporter', 'username displayName color')
    .populate('team', 'name color')
    .populate('comments.author', 'username displayName color')
    .populate('history.by', 'username displayName color');
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  res.json({ task });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  if (!body.title || !body.status) {
    return res.status(400).json({ error: 'title et status sont requis.' });
  }
  const seq = await nextTaskNumber(req.project.key);
  const taskId = `${req.project.key}-${String(seq).padStart(3, '0')}`;

  const task = await Task.create({
    project: req.project._id,
    taskId,
    title: body.title,
    description: body.description || '',
    area: body.area,
    module: body.module,
    type: body.type,
    status: body.status,
    priority: body.priority,
    version: body.version,
    sprint: body.sprint || null,
    techno: body.techno,
    category: body.category,
    estimate: body.estimate,
    duration: body.duration,
    complexity: body.complexity || 0,
    spec: body.spec,
    instructions: body.instructions || [],
    acceptance: body.acceptance || [],
    assignee: body.assignee || null,
    reporter: req.user._id,
    history: [
      {
        at: new Date(),
        by: req.user._id,
        byLabel: req.user.displayName,
        field: 'created',
        from: null,
        to: body.status,
        note: 'Tâche créée.',
      },
    ],
  });

  const populated = await task.populate([
    { path: 'assignee', select: 'username displayName color' },
    { path: 'reporter', select: 'username displayName color' },
    { path: 'team', select: 'name color' },
  ]);
  res.status(201).json({ task: populated });
});

router.patch('/:taskId', async (req, res) => {
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });

  const { note, ...patch } = req.body || {};
  applyPatchWithHistory(task, patch, req.user, note);
  await task.save();

  const populated = await task.populate([
    { path: 'assignee', select: 'username displayName color' },
    { path: 'reporter', select: 'username displayName color' },
    { path: 'team', select: 'name color' },
    { path: 'comments.author', select: 'username displayName color' },
    { path: 'history.by', select: 'username displayName color' },
  ]);
  res.json({ task: populated });
});

router.delete('/:taskId', async (req, res) => {
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
  const populated = await task.populate('comments.author', 'username displayName color');
  res.status(201).json({ comments: populated.comments });
});

router.patch('/:taskId/comments/:commentId', async (req, res) => {
  const { text } = req.body || {};
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  const comment = task.comments.id(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Commentaire introuvable.' });
  if (comment.author.toString() !== req.user._id.toString() && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: "Vous ne pouvez modifier que vos propres commentaires." });
  }
  comment.text = text.trim();
  comment.editedAt = new Date();
  await task.save();
  const populated = await task.populate('comments.author', 'username displayName color');
  res.json({ comments: populated.comments });
});

router.delete('/:taskId/comments/:commentId', async (req, res) => {
  const task = await Task.findOne({ project: req.project._id, taskId: req.params.taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  const comment = task.comments.id(req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Commentaire introuvable.' });
  if (comment.author.toString() !== req.user._id.toString() && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: "Vous ne pouvez supprimer que vos propres commentaires." });
  }
  comment.deleteOne();
  await task.save();
  res.json({ ok: true });
});

module.exports = router;
