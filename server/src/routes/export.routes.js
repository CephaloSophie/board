const { Router } = require('express');
const { Task } = require('../models/Task');
const { Taxonomy } = require('../models/Taxonomy');
const { Event } = require('../models/Event');
const { User } = require('../models/User');
const { SavedFilter, sanitizeFilters } = require('../models/SavedFilter');
const { requireAuth } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');
const { compileTaskQuery, parseTaskQueryParams, overlayFilters } = require('../utils/taskQuery');
const { durationToSeconds } = require('../utils/duration');
const { toCsv } = require('../import/csv');

// GET /api/projects/:key/export?format=json            full project bundle (kydos-project/1)
// GET /api/projects/:key/export?format=csv[&filterId=…&status=…][&sep=semicolon]
//     tasks as a Jira-compatible CSV (re-importable in Jira or Kýdos)
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

const strip = ({ _id, __v, project, ...rest }) => rest;
const fmtDate = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '');

router.get('/', async (req, res) => {
  const p = req.project;
  const users = await User.find({}, { username: 1 }).lean();
  const usernames = new Map(users.map((u) => [String(u._id), u.username]));
  const uname = (id) => (id ? usernames.get(String(id._id ?? id)) || null : null);

  if (req.query.format === 'csv') {
    let filters = parseTaskQueryParams(req.query);
    if (req.query.filterId) {
      const saved = await SavedFilter.findOne({ _id: req.query.filterId, project: p._id });
      if (!saved || !(saved.visibility === 'shared' || String(saved.owner) === String(req.user._id))) {
        return res.status(404).json({ error: 'Filtre introuvable ou non partagé.' });
      }
      filters = overlayFilters(sanitizeFilters(saved.filters), filters);
    }
    const [{ match }, taxonomies] = await Promise.all([
      compileTaskQuery(filters, { project: p, user: req.user }),
      Taxonomy.find({ project: p._id }).lean(),
    ]);
    const tasks = await Task.find(match, { history: 0, comments: 0 }).sort({ taskId: 1 }).lean();
    const label = (kind, key) => (key ? taxonomies.find((t) => t.kind === kind && t.key === key)?.label || key : '');
    const width = (field) => Math.max(1, ...tasks.map((t) => (t[field] || []).length));
    const fixWidth = Math.max(1, ...tasks.map((t) => (t.fixVersions?.length ? t.fixVersions : t.version ? [t.version] : []).length));
    const labelWidth = width('labels');
    const componentWidth = width('components');
    const headers = [
      'Summary',
      'Issue key',
      'Issue Type',
      'Status',
      'Status Category',
      'Priority',
      'Assignee',
      'Reporter',
      'Created',
      'Updated',
      'Resolved',
      'Due date',
      'Sprint',
      ...Array(fixWidth).fill('Fix versions'),
      ...Array(labelWidth).fill('Labels'),
      ...Array(componentWidth).fill('Components'),
      'Description',
      'Custom field (Story Points)',
      'Parent',
      'Original estimate',
      'Time Spent',
      'Custom field (Kýdos category)',
      'Custom field (Kýdos techno)',
      'Custom field (Kýdos area)',
    ];
    const statusCategory = (key) => {
      const s = taxonomies.find((t) => t.kind === 'status' && t.key === key);
      const cat = s?.meta?.category || (s?.meta?.isDone ? 'done' : 'todo');
      return { todo: 'To Do', inprogress: 'In Progress', done: 'Done' }[cat] || 'To Do';
    };
    const pad = (list, n) => [...list, ...Array(Math.max(0, n - list.length)).fill('')].slice(0, n);
    const rows = tasks.map((t) => [
      t.title,
      t.taskId,
      label('type', t.type),
      label('status', t.status),
      statusCategory(t.status),
      label('priority', t.priority),
      uname(t.assignee) || t.external?.assigneeName || '',
      uname(t.reporter) || '',
      fmtDate(t.createdAt),
      fmtDate(t.updatedAt),
      fmtDate(t.resolvedAt),
      t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : '',
      label('sprint', t.sprint),
      ...pad(t.fixVersions?.length ? t.fixVersions : t.version ? [t.version] : [], fixWidth),
      ...pad(t.labels || [], labelWidth),
      ...pad(t.components || [], componentWidth),
      [t.description, ...(t.acceptance?.length ? ['', "Critères d'acceptation :", ...t.acceptance.map((a) => `- ${a}`)] : [])].filter((x) => x !== undefined).join('\n').trim(),
      t.complexity ?? '',
      t.parent || '',
      t.timeOriginalEstimateSec ?? durationToSeconds(t.estimate) ?? '',
      t.timeSpentSec ?? durationToSeconds(t.duration) ?? '',
      label('category', t.category),
      label('techno', t.techno),
      label('area', t.area),
    ]);
    const sep = req.query.sep === 'semicolon' ? ';' : ',';
    res.attachment(`${p.key}-taches.csv`);
    res.type('text/csv; charset=utf-8');
    return res.send(`﻿${toCsv(headers, rows, sep)}`);
  }

  const [taxonomies, tasks, events, filters] = await Promise.all([
    Taxonomy.find({ project: p._id }).lean(),
    Task.find({ project: p._id }).sort({ taskId: 1 }).lean(),
    Event.find({ project: p._id }).lean(),
    SavedFilter.find({ project: p._id, visibility: 'shared' }).lean(),
  ]);
  const bundle = {
    schema: 'kydos-project/1',
    exportedAt: new Date().toISOString(),
    exportedBy: req.user.username,
    project: {
      key: p.key,
      name: p.name,
      vendor: p.vendor,
      description: p.description,
      currentVersion: p.currentVersion,
      currentSprint: p.currentSprint,
      sprintDurationValue: p.sprintDurationValue,
      sprintDurationUnit: p.sprintDurationUnit,
      timezone: p.timezone,
      workingDays: p.workingDays,
      estimation: p.estimation,
      defaults: p.defaults,
      access: p.access,
      owner: uname(p.owner),
      members: (p.members || []).map((m) => ({ user: uname(m.user), role: m.role })),
    },
    taxonomies: taxonomies.map(strip),
    tasks: tasks.map((t) => ({
      ...strip(t),
      assignee: uname(t.assignee),
      reporter: uname(t.reporter),
      comments: (t.comments || []).map((c) => ({ ...strip(c), author: uname(c.author) })),
      history: (t.history || []).map((h) => ({ ...strip(h), by: uname(h.by) })),
    })),
    events: events.map((e) => ({
      ...strip(e),
      participants: (e.participants || []).map(uname),
      createdBy: uname(e.createdBy),
      tasks: (e.tasks || []).map((l) => ({ taskId: l.taskId, note: l.note, outcome: l.outcome, order: l.order, presenter: uname(l.presenter) })),
      actionItems: (e.actionItems || []).map((a) => ({ text: a.text, done: a.done, assignee: uname(a.assignee) })),
    })),
    savedFilters: filters.map((f) => ({ name: f.name, description: f.description, filters: f.filters, view: f.view, groupBy: f.groupBy, sort: f.sort, owner: uname(f.owner) })),
  };
  res.attachment(`${p.key}-export.json`);
  res.type('application/json');
  res.send(JSON.stringify(bundle, null, 2));
});

module.exports = router;
