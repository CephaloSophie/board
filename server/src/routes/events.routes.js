const { Router } = require('express');
const { Event } = require('../models/Event');
const { Task } = require('../models/Task');
const { requireAuth } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');

const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

const POPULATE = [
  { path: 'participants', select: 'username displayName color' },
  { path: 'createdBy', select: 'username displayName color' },
  { path: 'tasks.task', select: 'taskId title status priority complexity assignee' },
  { path: 'tasks.presenter', select: 'username displayName color' },
  { path: 'actionItems.assignee', select: 'username displayName color' },
];

router.get('/', async (req, res) => {
  const filter = { project: req.project._id };
  if (req.query.sprint) filter.sprint = req.query.sprint;
  if (req.query.type) filter.type = req.query.type;
  const events = await Event.find(filter).populate(POPULATE).sort({ scheduledAt: -1, createdAt: -1 });
  res.json({ events });
});

router.get('/:id', async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, project: req.project._id }).populate(POPULATE);
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  res.json({ event });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.type || !b.title) return res.status(400).json({ error: 'type et title sont requis.' });
  const event = await Event.create({
    project: req.project._id,
    type: b.type,
    title: b.title,
    status: b.status || 'draft',
    sprint: b.sprint || null,
    scheduledAt: b.scheduledAt || null,
    durationMin: b.durationMin || 60,
    participants: b.participants || [],
    tasks: b.tasks || [],
    agenda: b.agenda || '',
    notes: b.notes || '',
    decisions: b.decisions || [],
    actionItems: b.actionItems || [],
    adr: b.adr || {},
    createdBy: req.user._id,
  });
  const populated = await event.populate(POPULATE);
  res.status(201).json({ event: populated });
});

router.patch('/:id', async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, project: req.project._id });
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  const b = req.body || {};
  const fields = [
    'type',
    'title',
    'status',
    'sprint',
    'scheduledAt',
    'durationMin',
    'participants',
    'tasks',
    'agenda',
    'notes',
    'decisions',
    'actionItems',
    'adr',
  ];
  for (const f of fields) if (f in b) event[f] = b[f];
  await event.save();
  const populated = await event.populate(POPULATE);
  res.json({ event: populated });
});

router.delete('/:id', async (req, res) => {
  const result = await Event.deleteOne({ _id: req.params.id, project: req.project._id });
  if (!result.deletedCount) return res.status(404).json({ error: 'Événement introuvable.' });
  res.json({ ok: true });
});

// Link a task to an event (used by the "add to event" popup on task cards).
router.post('/:id/tasks', async (req, res) => {
  const { taskId, note } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId requis.' });
  const event = await Event.findOne({ _id: req.params.id, project: req.project._id });
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  const task = await Task.findOne({ project: req.project._id, taskId });
  if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
  if (event.tasks.some((t) => t.task.toString() === task._id.toString())) {
    return res.status(409).json({ error: 'Cette tâche est déjà rattachée à cet événement.' });
  }
  event.tasks.push({ task: task._id, taskId: task.taskId, note, order: event.tasks.length });
  await event.save();
  const populated = await event.populate(POPULATE);
  res.status(201).json({ event: populated });
});

router.delete('/:id/tasks/:linkId', async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, project: req.project._id });
  if (!event) return res.status(404).json({ error: 'Événement introuvable.' });
  const link = event.tasks.id(req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Lien introuvable.' });
  link.deleteOne();
  await event.save();
  const populated = await event.populate(POPULATE);
  res.json({ event: populated });
});

module.exports = router;
