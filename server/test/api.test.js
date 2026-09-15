const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

let ctx;
let admin;
let dev;

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  dev = ctx.client(await ctx.login('dev'));
});

after(async () => {
  await ctx.stop();
});

test('auth: wrong password is rejected, /me returns the profile', async () => {
  const bad = await ctx.request('POST', '/auth/login', null, { username: 'admin', password: 'nope' });
  assert.equal(bad.status, 401);
  const me = await admin.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.username, 'admin');
});

test('projects: only superadmin creates, default taxonomies are seeded', async () => {
  const forbidden = await dev.post('/projects', { key: 'NOPE', name: 'Nope' });
  assert.equal(forbidden.status, 403);

  const created = await admin.post('/projects', { key: 'tp', name: 'Test Project' });
  assert.equal(created.status, 201);
  assert.equal(created.body.project.key, 'TP');

  const tax = await admin.get('/projects/TP/taxonomies');
  const kinds = new Set(tax.body.taxonomies.map((t) => t.kind));
  for (const k of ['status', 'priority', 'type', 'version', 'eventType']) assert.ok(kinds.has(k), `missing ${k}`);
  // The backlog is "no sprint" (sprint: null), not a pseudo-sprint.
  assert.equal(kinds.has('sprint'), false);
});

test('tasks: create, patch with history, filter and search', async () => {
  const a = await dev.post('/projects/TP/tasks', { title: 'Écran de login', status: 'pending', priority: 'P1', complexity: 3 });
  assert.equal(a.status, 201);
  assert.equal(a.body.task.taskId, 'TP-001');
  const b = await dev.post('/projects/TP/tasks', { title: 'Corriger le cache', status: 'onprocess', type: 'bug' });
  assert.equal(b.body.task.taskId, 'TP-002');

  const patched = await dev.patch('/projects/TP/tasks/TP-001', { status: 'onprocess', note: 'go' });
  assert.equal(patched.status, 200);
  const statusEntry = patched.body.task.history.find((h) => h.field === 'status');
  assert.equal(statusEntry.from, 'pending');
  assert.equal(statusEntry.to, 'onprocess');

  const byStatus = await dev.get('/projects/TP/tasks?status=onprocess');
  assert.equal(byStatus.body.tasks.length, 2);
  const search = await dev.get('/projects/TP/tasks?search=cache');
  assert.deepEqual(search.body.tasks.map((t) => t.taskId), ['TP-002']);
});

test('comments: add then delete own comment', async () => {
  const added = await dev.post('/projects/TP/tasks/TP-001/comments', { text: 'Hello' });
  assert.equal(added.status, 201);
  const id = added.body.comments[0]._id;
  const removed = await dev.del(`/projects/TP/tasks/TP-001/comments/${id}`);
  assert.equal(removed.status, 200);
});

test('robustness: malformed ids answer 400 instead of crashing the process', async () => {
  const r = await dev.get('/projects/TP/events/not-an-object-id');
  assert.equal(r.status, 400);
  const health = await ctx.request('GET', '/health');
  assert.equal(health.status, 200);
  const unknown = await dev.get('/does-not-exist');
  assert.equal(unknown.status, 404);
});

test('events: action items added with a blank _id are accepted', async () => {
  const ev = await dev.post('/projects/TP/events', { type: 'retro', title: 'Rétro' });
  assert.equal(ev.status, 201);
  const upd = await dev.patch(`/projects/TP/events/${ev.body.event._id}`, {
    actionItems: [{ _id: '', text: 'Mettre à jour la DoD', done: false, assignee: '' }],
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.event.actionItems.length, 1);
  assert.ok(upd.body.event.actionItems[0]._id);
});

test('taxonomies: archived items are listed only with includeArchived', async () => {
  const created = await admin.post('/projects/TP/taxonomies', { kind: 'category', key: 'old', label: 'Old' });
  assert.equal(created.status, 201);
  await admin.patch(`/projects/TP/taxonomies/${created.body.taxonomy._id}`, { archived: true });
  const hidden = await admin.get('/projects/TP/taxonomies?kind=category');
  assert.equal(hidden.body.taxonomies.some((t) => t.key === 'old'), false);
  const shown = await admin.get('/projects/TP/taxonomies?kind=category&includeArchived=1');
  assert.equal(shown.body.taxonomies.some((t) => t.key === 'old'), true);
});
