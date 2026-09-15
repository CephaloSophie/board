const { Router } = require('express');
const { Task } = require('../models/Task');
const { Taxonomy } = require('../models/Taxonomy');
const { User } = require('../models/User');
const { Event } = require('../models/Event');
const { SavedFilter, sanitizeFilters } = require('../models/SavedFilter');
const { requireAuth } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');
const { compileTaskQuery, parseSort, SUMMARY_PROJECTION } = require('../utils/taskQuery');
const { statusCategoryOf } = require('../utils/taxonomyMeta');
const { hoursOf } = require('../utils/duration');
const { httpError } = require('../utils/httpError');
const { sprintTimeline } = require('../analytics/timeline');
const { METRICS, DIMENSIONS } = require('../dashboards/widgets');

// Computations behind dashboard widgets. Every task-based route accepts
// { globalFilters, filterId, filters } — each part is compiled on its own
// (dynamic tokens included) and combined with $and.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject, async (req, res, next) => {
  req.taxonomies = await Taxonomy.find({ project: req.project._id }).lean();
  next();
});

const CATEGORY_META = {
  todo: { label: 'À faire', color: '#9db4dd', order: 0 },
  inprogress: { label: 'En cours', color: '#e6c46a', order: 1 },
  done: { label: 'Terminé', color: '#2f8f57', order: 2 },
};
const TASK_FIELDS = { taskId: 1, title: 1, status: 1, priority: 1, type: 1, category: 1, techno: 1, area: 1, version: 1, sprint: 1, assignee: 1, reporter: 1, labels: 1, complexity: 1, duration: 1, durationHours: 1, updatedAt: 1, createdAt: 1, dueDate: 1 };

async function scopeMatch(req, body = {}) {
  const ctx = { project: req.project, user: req.user, taxonomies: req.taxonomies };
  const parts = [];
  const add = async (filters) => {
    if (filters && typeof filters === 'object' && Object.keys(filters).length) parts.push((await compileTaskQuery(sanitizeFilters(filters), ctx)).match);
  };
  await add(body.globalFilters);
  if (body.filterId) {
    const saved = await SavedFilter.findOne({ _id: body.filterId, project: req.project._id }).lean();
    if (!saved || !(saved.visibility === 'shared' || String(saved.owner) === String(req.user._id))) {
      throw httpError(404, 'FILTER_NOT_FOUND', 'Filtre indisponible (supprimé ou non partagé).');
    }
    await add(saved.filters);
  }
  await add(body.filters);
  if (!parts.length) return { project: req.project._id };
  return parts.length === 1 ? parts[0] : { $and: parts };
}

async function dimensions(req) {
  const users = await User.find({}, { displayName: 1, color: 1 }).lean();
  const tax = new Map(req.taxonomies.map((t) => [`${t.kind}:${t.key}`, t]));
  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const categoryOf = (key) => statusCategoryOf(tax.get(`status:${key}`) || { key });
  const valuesOf = (task, dim) => {
    if (dim === 'labels') return task.labels?.length ? task.labels : [null];
    if (dim === 'statusCategory') return [categoryOf(task.status)];
    if (dim === 'assignee' || dim === 'reporter') return [task[dim] ? String(task[dim]) : null];
    return [task[dim] ?? null];
  };
  const describe = (dim, key) => {
    if (key === null || key === undefined) {
      return { key: '__none__', label: dim === 'assignee' || dim === 'reporter' ? 'Non assigné' : dim === 'sprint' ? 'Backlog' : '— Non défini —', color: '#6b7280', order: 1e9 };
    }
    if (dim === 'statusCategory') return { key, ...(CATEGORY_META[key] || { label: key, color: '#6b7280', order: 9 }) };
    if (dim === 'assignee' || dim === 'reporter') {
      const u = userMap.get(key);
      return { key, label: u?.displayName || 'Utilisateur inconnu', color: u?.color || '#6b78ea', order: 0 };
    }
    if (dim === 'labels') return { key, label: key, color: '#b39ddb', order: 0 };
    const t = tax.get(`${dim}:${key}`);
    return { key, label: t?.label || key, color: t?.color || '#6b7280', order: t?.order ?? 1e6 };
  };
  return { categoryOf, valuesOf, describe, tax };
}

const metricOf = (task, metric) => (metric === 'points' ? Number(task.complexity) || 0 : metric === 'hours' ? task.durationHours || hoursOf(task.duration) : 1);
const round = (n) => Math.round(n * 100) / 100;
const strip = ({ order, ...rest }) => rest;
const byOrder = (a, b) => a.order - b.order || String(a.label).localeCompare(String(b.label));

function resolveSprintKey(req, value) {
  const key = !value || value === '@current' ? req.project.currentSprint : value;
  const sprint = req.taxonomies.find((t) => t.kind === 'sprint' && t.key === key);
  if (!sprint) throw httpError(404, 'SPRINT_NOT_FOUND', key ? `Sprint "${key}" introuvable.` : 'Aucun sprint courant.');
  return sprint;
}

router.post('/aggregate', async (req, res) => {
  const b = req.body || {};
  const groupBy = DIMENSIONS.includes(b.groupBy) ? b.groupBy : 'status';
  const splitBy = DIMENSIONS.includes(b.splitBy) && b.splitBy !== groupBy ? b.splitBy : null;
  const metric = METRICS.includes(b.metric) ? b.metric : 'count';
  const topN = Math.min(Math.max(Number(b.topN) || 12, 1), 50);
  const [tasks, dc] = await Promise.all([scopeMatch(req, b).then((m) => Task.find(m, TASK_FIELDS).lean()), dimensions(req)]);

  const map = new Map();
  let total = 0;
  for (const task of tasks) {
    const value = metricOf(task, metric);
    total += value;
    for (const key of dc.valuesOf(task, groupBy)) {
      const bucket = map.get(key) || { ...dc.describe(groupBy, key), value: 0, split: new Map() };
      bucket.value += value;
      if (splitBy) {
        for (const sk of dc.valuesOf(task, splitBy)) {
          const s = bucket.split.get(sk) || { ...dc.describe(splitBy, sk), value: 0 };
          s.value += value;
          bucket.split.set(sk, s);
        }
      }
      map.set(key, bucket);
    }
  }
  let buckets = [...map.values()].map((bk) => ({ ...bk, value: round(bk.value), split: splitBy ? [...bk.split.values()].sort(byOrder).map((s) => strip({ ...s, value: round(s.value) })) : undefined }));
  buckets.sort(b.sort === 'valueDesc' ? (x, y) => y.value - x.value : byOrder);
  if (buckets.length > topN) {
    const kept = buckets.slice(0, topN - 1);
    const rest = buckets.slice(topN - 1);
    kept.push({ key: '__other__', label: `Autres (${rest.length})`, color: '#4b5563', order: 1e10, value: round(rest.reduce((a, x) => a + x.value, 0)) });
    buckets = kept;
  }
  res.json({ total: round(total), count: tasks.length, buckets: buckets.map(strip) });
});

router.post('/matrix', async (req, res) => {
  const b = req.body || {};
  const rowsDim = DIMENSIONS.includes(b.rows) ? b.rows : 'assignee';
  const colsDim = DIMENSIONS.includes(b.cols) && b.cols !== rowsDim ? b.cols : 'statusCategory';
  const metric = METRICS.includes(b.metric) ? b.metric : 'count';
  const [tasks, dc] = await Promise.all([scopeMatch(req, b).then((m) => Task.find(m, TASK_FIELDS).lean()), dimensions(req)]);
  const rows = new Map();
  const cols = new Map();
  const cells = {};
  for (const task of tasks) {
    const value = metricOf(task, metric);
    for (const r of dc.valuesOf(task, rowsDim)) {
      const rd = dc.describe(rowsDim, r);
      rows.set(rd.key, rd);
      for (const c of dc.valuesOf(task, colsDim)) {
        const cd = dc.describe(colsDim, c);
        cols.set(cd.key, cd);
        cells[rd.key] = cells[rd.key] || {};
        cells[rd.key][cd.key] = round((cells[rd.key][cd.key] || 0) + value);
      }
    }
  }
  res.json({ rows: [...rows.values()].sort(byOrder).map(strip), cols: [...cols.values()].sort(byOrder).map(strip), cells });
});

router.post('/kpi', async (req, res) => {
  const b = req.body || {};
  const metric = [...METRICS, 'openBugs'].includes(b.metric) ? b.metric : 'count';
  const [tasks, dc] = await Promise.all([scopeMatch(req, b).then((m) => Task.find(m, TASK_FIELDS).lean()), dimensions(req)]);
  let value;
  if (metric === 'openBugs') {
    const flagged = req.taxonomies.filter((t) => t.kind === 'type' && t.meta?.isBug).map((t) => t.key);
    const bugTypes = new Set(flagged.length ? flagged : ['bug']);
    value = tasks.filter((t) => bugTypes.has(t.type) && dc.categoryOf(t.status) !== 'done').length;
  } else {
    value = round(tasks.reduce((a, t) => a + metricOf(t, metric), 0));
  }
  res.json({ value, count: tasks.length });
});

router.post('/workload', async (req, res) => {
  const b = req.body || {};
  const metric = METRICS.includes(b.metric) ? b.metric : 'points';
  const [tasks, dc] = await Promise.all([scopeMatch(req, b).then((m) => Task.find(m, TASK_FIELDS).lean()), dimensions(req)]);
  const people = new Map();
  for (const task of tasks) {
    const key = task.assignee ? String(task.assignee) : null;
    if (key === null && b.includeUnassigned === false) continue;
    const p = people.get(key) || { ...dc.describe('assignee', key), todo: 0, inprogress: 0, done: 0, total: 0 };
    const v = metricOf(task, metric);
    p[dc.categoryOf(task.status)] += v;
    p.total += v;
    people.set(key, p);
  }
  const rows = [...people.values()]
    .map((p) => strip({ ...p, todo: round(p.todo), inprogress: round(p.inprogress), done: round(p.done), total: round(p.total) }))
    .sort((a, b2) => (a.key === '__none__') - (b2.key === '__none__') || b2.total - a.total);
  res.json({ metric, rows });
});

router.post('/tasks', async (req, res) => {
  const b = req.body || {};
  const match = await scopeMatch(req, b);
  const limit = Math.min(Math.max(Number(b.limit) || 20, 1), 100);
  const [tasks, total] = await Promise.all([
    Task.find(match).select(SUMMARY_PROJECTION).populate('assignee', 'username displayName color').sort(parseSort(b.sort || 'updatedAt:desc')).limit(limit).lean(),
    Task.countDocuments(match),
  ]);
  res.json({ tasks, total });
});

router.post('/activity', async (req, res) => {
  const b = req.body || {};
  const limit = Math.min(Math.max(Number(b.limit) || 20, 1), 50);
  const tasks = await Task.find(await scopeMatch(req, b), { taskId: 1, title: 1, history: 1 })
    .sort({ updatedAt: -1 })
    .limit(500)
    .populate('history.by', 'username displayName color')
    .lean();
  const entries = tasks
    .flatMap((t) => (t.history || []).map((h) => ({ at: h.at, taskId: t.taskId, title: t.title, field: h.field, from: h.from, to: h.to, by: h.by || null, byLabel: h.byLabel, note: h.note })))
    .sort((x, y) => new Date(y.at) - new Date(x.at))
    .slice(0, limit);
  res.json({ entries });
});

router.post('/sprint-summary', async (req, res) => {
  const sprint = resolveSprintKey(req, req.body?.sprint);
  const dc = await dimensions(req);
  const [tasks, events] = await Promise.all([
    Task.find({ project: req.project._id, sprint: sprint.key }, TASK_FIELDS).lean(),
    Event.find({ project: req.project._id, sprint: sprint.key }, { type: 1, title: 1, status: 1, scheduledAt: 1 }).sort({ scheduledAt: 1 }).lean(),
  ]);
  const points = tasks.reduce((a, t) => a + (Number(t.complexity) || 0), 0);
  const donePoints = tasks.filter((t) => dc.categoryOf(t.status) === 'done').reduce((a, t) => a + (Number(t.complexity) || 0), 0);
  const committed = sprint.meta?.startSnapshot?.committedPoints ?? points;
  const end = sprint.meta?.endDate ? new Date(sprint.meta.endDate) : null;
  res.json({
    sprint: { key: sprint.key, label: sprint.label, status: sprint.meta?.status || 'draft', startDate: sprint.meta?.startDate, endDate: sprint.meta?.endDate, goal: sprint.meta?.goal || '' },
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => dc.categoryOf(t.status) === 'done').length,
    points: round(points),
    donePoints: round(donePoints),
    committed: round(committed),
    pctDone: points ? Math.round((donePoints / points) * 100) : 0,
    daysLeft: end ? Math.ceil((end - Date.now()) / 86400000) : null,
    events: events.map((e) => ({ ...e, typeLabel: dc.tax.get(`eventType:${e.type}`)?.label || e.type, icon: dc.tax.get(`eventType:${e.type}`)?.meta?.icon || '📌' })),
  });
});

async function sprintTasks(req, key) {
  return Task.find(
    { project: req.project._id, $or: [{ sprint: key }, { history: { $elemMatch: { field: 'sprint', $or: [{ from: key }, { to: key }] } } }] },
    { taskId: 1, status: 1, sprint: 1, complexity: 1, createdAt: 1, history: 1 }
  ).lean();
}

router.get('/sprints/:sprintKey/burndown', async (req, res) => {
  const sprint = resolveSprintKey(req, req.params.sprintKey);
  const dc = await dimensions(req);
  const { sample, ...timeline } = sprintTimeline({
    sprint,
    tasks: await sprintTasks(req, sprint.key),
    categoryOf: dc.categoryOf,
    unit: req.query.unit === 'count' ? 'count' : 'points',
    timezone: req.project.timezone,
  });
  res.json(timeline);
});

router.get('/velocity', async (req, res) => {
  const last = Math.min(Math.max(Number(req.query.last) || 6, 1), 20);
  const unit = req.query.unit === 'count' ? 'count' : 'points';
  const dc = await dimensions(req);
  const finished = req.taxonomies
    .filter((t) => t.kind === 'sprint' && !t.archived && t.meta?.status === 'finished')
    .sort((a, b) => new Date(b.meta?.closedAt || b.meta?.endDate || 0) - new Date(a.meta?.closedAt || a.meta?.endDate || 0))
    .slice(0, last)
    .reverse();
  const sprints = [];
  for (const s of finished) {
    const r = s.meta?.report;
    if (r) {
      sprints.push({
        key: s.key,
        label: s.label,
        endDate: s.meta?.closedAt || s.meta?.endDate || null,
        committed: unit === 'count' ? r.committedCount : r.committedPoints,
        completed: unit === 'count' ? r.completedCount : r.completedPoints,
        carriedOver: (r.carriedOverTaskIds || []).length,
        source: r.source || 'lifecycle',
      });
      continue;
    }
    try {
      const { sample } = sprintTimeline({ sprint: s, tasks: await sprintTasks(req, s.key), categoryOf: dc.categoryOf, unit, timezone: req.project.timezone });
      const start = new Date(s.meta.startedAt || s.meta.startDate);
      const end = new Date(s.meta.closedAt || s.meta.endDate);
      sprints.push({ key: s.key, label: s.label, endDate: end.toISOString(), committed: sample(start).scope, completed: sample(end).completed, carriedOver: null, source: 'computed' });
    } catch {
      sprints.push({ key: s.key, label: s.label, endDate: null, committed: null, completed: null, carriedOver: null, source: 'unavailable' });
    }
  }
  const values = sprints.map((s) => s.completed).filter((v) => typeof v === 'number');
  const average = values.length ? round(values.reduce((a, v) => a + v, 0) / values.length) : null;
  res.json({ unit, sprints, average });
});

module.exports = router;
