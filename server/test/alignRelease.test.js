const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { Project } = require('../src/models/Project');
const { Taxonomy } = require('../src/models/Taxonomy');
const { Task } = require('../src/models/Task');
const { Activity } = require('../src/models/Activity');
const { alignRelease, sprintVersionOf } = require('../src/migrations/alignRelease');

let ctx;
let admin;
const silent = { log: () => {} };
const NOW = new Date('2026-09-15T10:00:00Z'); // a Tuesday

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  assert.equal((await admin.post('/projects', { key: 'AL', name: 'Alignement' })).status, 201);
  for (const key of ['1.0.0', '12.4.4', '20.0.0']) assert.equal((await admin.post('/projects/AL/versions', { key })).status, 201);
  await admin.post('/projects/AL/sprints', { label: 'Sprint 12.4.4', startDate: '2026-08-01', endDate: '2026-08-07' });
  await admin.post('/projects/AL/tasks', { title: 'Livrée', status: 'finished', sprint: 'sprint-12.4.4', complexity: 3 });
  await admin.post('/projects/AL/tasks', { title: 'Ouverte', status: 'pending', sprint: 'sprint-12.4.4', complexity: 5 });
  assert.equal((await admin.post('/projects/AL/sprints/sprint-12.4.4/start')).status, 200);
  await admin.post('/projects/AL/sprints', { label: 'Sprint 20.0.0', startDate: '2099-01-01', endDate: '2099-01-07' });
  await admin.post('/projects/AL/sprints', { label: 'Sprint futur', startDate: '2099-02-01', endDate: '2099-02-07' });
});

after(async () => {
  await ctx.stop();
});

test('sprint version is read from linkedVersion or the sprint-<version> key', () => {
  assert.equal(sprintVersionOf({ key: 'sprint-12.4.4', meta: {} }), '12.4.4');
  assert.equal(sprintVersionOf({ key: 'sprint-x', meta: { linkedVersion: '3.0.0' } }), '3.0.0');
  assert.equal(sprintVersionOf({ key: 'sprint-futur', meta: {} }), null);
});

test('dry-run reports the plan without writing', async () => {
  const [report] = await alignRelease({ version: '19.0.3', projectKeys: ['AL'], dryRun: true, now: NOW, logger: silent });
  assert.ok(report.changes > 0);
  assert.deepEqual(report.versionsReleased, ['0.1.0', '1.0.0', '12.4.4']); // 0.1.0 = version created with the project
  assert.deepEqual(report.sprintsFinished, ['sprint-12.4.4']);
  assert.equal(report.sprintCreated, 'sprint-19.0.3');
  const project = await Project.findOne({ key: 'AL' });
  assert.equal(project.currentSprint, 'sprint-12.4.4');
  assert.equal(await Taxonomy.countDocuments({ project: project._id, key: '19.0.3' }), 0);
});

test('older sprints are finished, older versions released, 19.0.3 becomes current and active', async () => {
  await alignRelease({ version: '19.0.3', projectKeys: ['AL'], now: NOW, logger: silent });
  const project = await Project.findOne({ key: 'AL' });
  assert.equal(project.currentVersion, '19.0.3');
  assert.equal(project.currentSprint, 'sprint-19.0.3');

  const versions = (await admin.get('/projects/AL/versions')).body.versions;
  const statusOf = (key) => versions.find((v) => v.key === key)?.status;
  assert.equal(statusOf('1.0.0'), 'released');
  assert.equal(statusOf('12.4.4'), 'released');
  assert.equal(statusOf('19.0.3'), 'unreleased');
  assert.equal(statusOf('20.0.0'), 'unreleased'); // newer versions stay open

  const sprints = (await admin.get('/projects/AL/sprints')).body;
  assert.equal(sprints.currentSprint, 'sprint-19.0.3');
  const byKey = Object.fromEntries(sprints.sprints.map((s) => [s.key, s]));
  assert.deepEqual(sprints.sprints.filter((s) => s.status === 'active').map((s) => s.key), ['sprint-19.0.3']);
  assert.equal(byKey['sprint-12.4.4'].status, 'finished');
  assert.equal(byKey['sprint-12.4.4'].meta.report.completedPoints, 3);
  assert.equal(byKey['sprint-12.4.4'].meta.report.committedPoints, 8);
  assert.equal(byKey['sprint-12.4.4'].meta.report.keptTaskIds.length, 1);
  assert.equal(byKey['sprint-20.0.0'].status, 'draft');
  assert.equal(byKey['sprint-futur'].status, 'draft');
  assert.equal(byKey['sprint-19.0.3'].meta.startDate.slice(0, 10), '2026-09-14');
  assert.equal(byKey['sprint-19.0.3'].meta.linkedVersion, '19.0.3');

  // Tasks are never moved: the open one is left in the finished sprint (Planification → reste à faire).
  assert.equal(await Task.countDocuments({ project: project._id, sprint: 'sprint-12.4.4' }), 2);
  const leftovers = await admin.get('/projects/AL/sprints/sprint-12.4.4/leftovers');
  assert.equal(leftovers.body.notDone.length, 1);
  assert.ok(await Activity.exists({ project: project._id, action: 'release.aligned' }));
});

test('re-running is a no-op', async () => {
  const [report] = await alignRelease({ version: '19.0.3', projectKeys: ['AL'], now: NOW, logger: silent });
  assert.equal(report.changes, 0);
  await assert.rejects(alignRelease({ version: 'v19', projectKeys: ['AL'], logger: silent }), /Version invalide/);
});
