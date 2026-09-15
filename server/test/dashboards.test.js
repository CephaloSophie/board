const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { Task } = require('../src/models/Task');
const { Taxonomy } = require('../src/models/Taxonomy');
const { Project } = require('../src/models/Project');

let ctx;
let admin;
let dev;
let project;

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  dev = ctx.client(await ctx.login('dev'));
  assert.equal((await admin.post('/projects', { key: 'DB', name: 'Dashboards' })).status, 201);
  await admin.patch('/projects/DB', { timezone: 'UTC' });
  project = await Project.findOne({ key: 'DB' });
});

after(async () => {
  await ctx.stop();
});

test('dashboards: templates, validation, optimistic concurrency, sharing', async () => {
  const created = await dev.post('/projects/DB/dashboards', { name: 'Sprint', template: 'sprint' });
  assert.equal(created.status, 201);
  const d = created.body.dashboard;
  assert.equal(d.widgets.length, 5);
  assert.deepEqual(d.globalFilters.sprint, ['@current']);

  const bad = await dev.patch(`/projects/DB/dashboards/${d._id}`, { revision: d.revision, widgets: [{ type: 'nope' }] });
  assert.equal(bad.body.code, 'WIDGET_TYPE_UNKNOWN');

  const moved = d.widgets.map((w, i) => (i === 0 ? { ...w, layout: { ...w.layout, x: 20, w: 99 } } : w));
  const ok = await dev.patch(`/projects/DB/dashboards/${d._id}`, { revision: d.revision, widgets: moved, name: 'Sprint courant' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.dashboard.revision, d.revision + 1);
  assert.deepEqual(ok.body.dashboard.widgets[0].layout, { x: 0, y: 0, w: 12, h: 4 });

  const stale = await dev.patch(`/projects/DB/dashboards/${d._id}`, { revision: d.revision, name: 'Conflit' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'REVISION_CONFLICT');

  assert.equal((await admin.get(`/projects/DB/dashboards/${d._id}`)).status, 404, 'private dashboards are hidden');
  await dev.patch(`/projects/DB/dashboards/${d._id}`, { revision: ok.body.dashboard.revision, visibility: 'shared' });
  const seen = await admin.get(`/projects/DB/dashboards/${d._id}`);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.dashboard.isOwner, false);
  const copy = await admin.post(`/projects/DB/dashboards/${d._id}/duplicate`, {});
  assert.equal(copy.status, 201);
  assert.equal(copy.body.dashboard.visibility, 'private');
  await admin.put(`/projects/DB/dashboards/${copy.body.dashboard._id}/default`, { isDefault: true });
  const list = await admin.get('/projects/DB/dashboards');
  assert.equal(list.body.dashboards.filter((x) => x.isDefault).length, 1);
});

test('analytics: aggregate, matrix, kpi, workload, tasks and activity follow filters', async () => {
  const devId = ctx.users.dev._id.toString();
  await admin.post('/projects/DB/tasks', { title: 'A', status: 'pending', priority: 'P0', complexity: 3, assignee: devId, labels: ['x'] });
  await admin.post('/projects/DB/tasks', { title: 'B', status: 'onprocess', priority: 'P1', complexity: 5, assignee: devId, type: 'bug' });
  await admin.post('/projects/DB/tasks', { title: 'C', status: 'finished', priority: 'P1', complexity: 8, type: 'bug' });

  const agg = await dev.post('/projects/DB/analytics/aggregate', { groupBy: 'statusCategory', metric: 'points' });
  assert.equal(agg.status, 200);
  assert.deepEqual(agg.body.buckets.map((b) => [b.key, b.value]), [['todo', 3], ['inprogress', 5], ['done', 8]]);
  assert.equal(agg.body.total, 16);

  const split = await dev.post('/projects/DB/analytics/aggregate', { groupBy: 'priority', splitBy: 'statusCategory', filters: { statusCategory: ['todo', 'inprogress'] } });
  assert.deepEqual(split.body.buckets.map((b) => b.key), ['P0', 'P1']);
  assert.equal(split.body.buckets[1].split[0].key, 'inprogress');

  const matrix = await dev.post('/projects/DB/analytics/matrix', { rows: 'assignee', cols: 'statusCategory' });
  assert.equal(matrix.body.cells[devId].todo, 1);
  assert.equal(matrix.body.cells.__none__.done, 1);

  const kpi = await dev.post('/projects/DB/analytics/kpi', { metric: 'points', filters: { assignee: ['@me'], statusCategory: ['todo', 'inprogress'] } });
  assert.equal(kpi.body.value, 8);
  assert.equal((await dev.post('/projects/DB/analytics/kpi', { metric: 'openBugs' })).body.value, 1);

  const workload = await dev.post('/projects/DB/analytics/workload', { metric: 'points' });
  const mine = workload.body.rows.find((r) => r.key === devId);
  assert.deepEqual([mine.todo, mine.inprogress, mine.done], [3, 5, 0]);

  const list = await dev.post('/projects/DB/analytics/tasks', { filters: { labels: ['x'] }, limit: 5 });
  assert.deepEqual(list.body.tasks.map((t) => t.title), ['A']);
  assert.equal('history' in list.body.tasks[0], false);

  const activity = await dev.post('/projects/DB/analytics/activity', { limit: 2 });
  assert.equal(activity.body.entries.length, 2);

  const privateFilter = await admin.post('/projects/DB/filters', { name: 'Privé', filters: { priority: ['P0'] } });
  const unavailable = await dev.post('/projects/DB/analytics/kpi', { filterId: privateFilter.body.filter._id });
  assert.equal(unavailable.body.code, 'FILTER_NOT_FOUND');
});

test('burndown is rebuilt from history (scope added mid-sprint), velocity uses sprint reports', async () => {
  await Taxonomy.create({
    project: project._id,
    kind: 'sprint',
    key: 'bd-1',
    label: 'Burndown 1',
    meta: { status: 'finished', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-07T23:59:59.000Z' },
  });
  const created = new Date('2026-08-30T10:00:00Z');
  const base = { project: project._id, priority: 'P2', createdAt: created, updatedAt: created };
  await Task.insertMany(
    [
      { ...base, taskId: 'DB-101', title: 'T1', status: 'finished', sprint: 'bd-1', complexity: 5, history: [{ at: new Date('2026-09-03T10:00:00Z'), field: 'status', from: 'pending', to: 'finished' }] },
      { ...base, taskId: 'DB-102', title: 'T2', status: 'pending', sprint: 'bd-1', complexity: 15, history: [{ at: created, field: 'created', to: 'pending' }] },
      { ...base, taskId: 'DB-103', title: 'T3', status: 'pending', sprint: 'bd-1', complexity: 3, history: [{ at: new Date('2026-09-04T10:00:00Z'), field: 'sprint', from: null, to: 'bd-1' }] },
    ],
    { timestamps: false }
  );

  const r = await dev.get('/projects/DB/analytics/sprints/bd-1/burndown?unit=points');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.committed, 20);
  const day = (d) => r.body.days.find((x) => x.date === d);
  assert.equal(day('2026-09-02').remaining, 20);
  assert.equal(day('2026-09-03').remaining, 15);
  assert.equal(day('2026-09-04').scope, 23);
  assert.equal(r.body.ideal[0].value, 20);
  assert.equal(r.body.ideal.at(-1).value, 0);
  assert.ok(r.body.scopeChanges.some((c) => c.taskId === 'DB-103' && c.kind === 'added'));

  await Taxonomy.create({
    project: project._id,
    kind: 'sprint',
    key: 'bd-2',
    label: 'Burndown 2',
    meta: { status: 'finished', startDate: '2026-09-08T00:00:00.000Z', endDate: '2026-09-14T00:00:00.000Z', report: { committedPoints: 14, completedPoints: 12, committedCount: 4, completedCount: 3, carriedOverTaskIds: ['DB-1'], source: 'lifecycle' } },
  });
  const velocity = await dev.get('/projects/DB/analytics/velocity?last=5');
  assert.deepEqual(velocity.body.sprints.map((s) => [s.key, s.completed, s.source]), [['bd-1', 5, 'computed'], ['bd-2', 12, 'lifecycle']]);
  assert.equal(velocity.body.average, 8.5);

  const noSprint = await dev.post('/projects/DB/analytics/sprint-summary', { sprint: '@current' });
  assert.equal(noSprint.status, 404);
  const summary = await dev.post('/projects/DB/analytics/sprint-summary', { sprint: 'bd-1' });
  assert.equal(summary.body.points, 23);
  assert.equal(summary.body.donePoints, 5);
});
