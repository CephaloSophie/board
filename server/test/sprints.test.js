const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

let ctx;
let admin;
let dev;
const ids = {};

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  dev = ctx.client(await ctx.login('dev'));
  assert.equal((await admin.post('/projects', { key: 'SP', name: 'Sprints' })).status, 201);
});

after(async () => {
  await ctx.stop();
});

test('sprints are created with chained dates using the project cadence', async () => {
  const s1 = await admin.post('/projects/SP/sprints', { label: 'Sprint 1', startDate: '2026-09-01', endDate: '2026-09-07' });
  assert.equal(s1.status, 201);
  assert.equal(s1.body.sprint.key, 'sprint-1');
  assert.equal(s1.body.sprint.status, 'draft');
  const s2 = await admin.post('/projects/SP/sprints', { label: 'Sprint 2' });
  assert.equal(s2.body.sprint.meta.startDate.slice(0, 10), '2026-09-08');
  assert.equal(s2.body.sprint.meta.endDate.slice(0, 10), '2026-09-14');
  assert.equal((await dev.post('/projects/SP/sprints', { label: 'x' })).status, 403);
});

test('start takes a snapshot, enforces a single active sprint and protects lifecycle fields', async () => {
  const devId = ctx.users.dev._id.toString();
  for (const [title, complexity] of [['A', 3], ['B', 5], ['C', 2]]) {
    const t = await dev.post('/projects/SP/tasks', { title, status: 'pending', sprint: 'sprint-1', complexity, assignee: devId });
    ids[title] = t.body.task.taskId;
  }
  assert.equal((await admin.post('/projects/SP/sprints/sprint-1/ready')).status, 200);
  const started = await admin.post('/projects/SP/sprints/sprint-1/start', { goal: 'Livrer A' });
  assert.equal(started.status, 200);
  assert.equal(started.body.sprint.status, 'active');
  assert.equal(started.body.sprint.meta.startSnapshot.committedPoints, 10);
  assert.equal(started.body.currentSprint, 'sprint-1');

  const second = await admin.post('/projects/SP/sprints/sprint-2/start');
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'ACTIVE_SPRINT_EXISTS');

  const lifecycle = await admin.patch('/projects/SP/sprints/sprint-1', { status: 'finished' });
  assert.equal(lifecycle.body.code, 'LIFECYCLE_FIELD');
  const current = await dev.get('/projects/SP/tasks?sprint=@current');
  assert.equal(current.body.tasks.length, 3);
});

test('close carries unfinished work over, keeps selected tasks, starts the target and prepares the retro', async () => {
  await dev.patch(`/projects/SP/tasks/${ids.A}`, { status: 'finished' });
  const preview = await admin.get('/projects/SP/sprints/sprint-1/close-preview');
  assert.equal(preview.body.done.points, 3);
  assert.equal(preview.body.notDone.length, 2);
  assert.deepEqual(preview.body.targets.map((t) => t.key), ['sprint-2']);

  const closed = await admin.post('/projects/SP/sprints/sprint-1/close', {
    carryOver: { mode: 'sprint', targetKey: 'sprint-2' },
    keep: [ids.C],
    startTarget: true,
    createRetro: true,
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.carriedOver, 1);
  assert.equal(closed.body.sprint.status, 'finished');
  assert.equal(closed.body.sprint.meta.report.completedPoints, 3);
  assert.equal(closed.body.sprint.meta.report.committedPoints, 10);
  assert.deepEqual(closed.body.sprint.meta.report.carriedOverTaskIds, [ids.B]);
  assert.deepEqual(closed.body.sprint.meta.report.keptTaskIds, [ids.C]);
  assert.equal(closed.body.currentSprint, 'sprint-2');

  const moved = await dev.get(`/projects/SP/tasks/${ids.B}`);
  assert.equal(moved.body.task.sprint, 'sprint-2');
  assert.match(moved.body.task.history.at(-1).note, /Report automatique/);
  assert.equal((await dev.get(`/projects/SP/tasks/${ids.C}`)).body.task.sprint, 'sprint-1');

  const retro = await dev.get('/projects/SP/events?type=retro');
  assert.equal(retro.body.events.length, 1);
  assert.equal(retro.body.events[0].tasks.length, 1);
  assert.equal(retro.body.events[0].participants.length, 1);

  const sprints = await dev.get('/projects/SP/sprints');
  assert.equal(sprints.body.sprints.find((s) => s.key === 'sprint-2').status, 'active');
});

test('close to the backlog, reopen, and refuse deleting a referenced sprint', async () => {
  const closed = await admin.post('/projects/SP/sprints/sprint-2/close', { carryOver: { mode: 'backlog' } });
  assert.equal(closed.status, 200);
  assert.equal((await dev.get(`/projects/SP/tasks/${ids.B}`)).body.task.sprint, null);
  assert.equal(closed.body.currentSprint, null);

  const reopened = await admin.post('/projects/SP/sprints/sprint-1/reopen');
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.currentSprint, 'sprint-1');
  const del = await admin.del('/projects/SP/sprints/sprint-2');
  assert.equal(del.body.code, 'SPRINT_IN_USE');

  const empty = await admin.post('/projects/SP/sprints', { label: 'Vide' });
  assert.equal((await admin.del(`/projects/SP/sprints/${empty.body.sprint.key}`)).status, 200);
});

test('releasing a version moves open tasks and updates the current version', async () => {
  assert.equal((await admin.post('/projects/SP/versions', { key: '0.2.0', releaseDate: '2026-10-01' })).status, 201);
  const open = await dev.post('/projects/SP/tasks', { title: 'Open v1', status: 'pending', version: '0.1.0' });
  await dev.post('/projects/SP/tasks', { title: 'Done v1', status: 'finished', version: '0.1.0' });

  const denied = await admin.patch('/projects/SP/versions/0.1.0', { status: 'released' });
  assert.equal(denied.body.code, 'LIFECYCLE_FIELD');

  const released = await admin.post('/projects/SP/versions/0.1.0/release', { moveOpenTo: '0.2.0', setCurrent: '0.2.0' });
  assert.equal(released.status, 200);
  assert.equal(released.body.version.meta.status, 'released');
  assert.ok(released.body.version.meta.releasedAt);
  assert.equal(released.body.moved, 1);
  assert.equal(released.body.currentVersion, '0.2.0');
  assert.equal((await dev.get(`/projects/SP/tasks/${open.body.task.taskId}`)).body.task.version, '0.2.0');

  const unreleased = await dev.get('/projects/SP/tasks?version=@unreleased');
  assert.deepEqual(unreleased.body.tasks.map((t) => t.title), ['Open v1']);
  const list = await dev.get('/projects/SP/versions');
  assert.deepEqual(list.body.versions.map((v) => v.key), ['0.2.0', '0.1.0']);
});
