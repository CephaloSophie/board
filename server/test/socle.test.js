const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, PASSWORD } = require('./helpers');
const { Project } = require('../src/models/Project');
const { User } = require('../src/models/User');
const { hashPassword } = require('../src/utils/password');

let ctx;
let admin;
let dev;
let viewer;
let viewerId;

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  dev = ctx.client(await ctx.login('dev'));
  const v = await User.create({ username: 'viewer', displayName: 'Viewer', passwordHash: await hashPassword(PASSWORD) });
  viewerId = v._id.toString();
  viewer = ctx.client(await ctx.login('viewer'));
  const r = await admin.post('/projects', { key: 'SO', name: 'Socle' });
  assert.equal(r.status, 201);
  assert.equal(r.body.project.myRole, 'admin');
});

after(async () => {
  await ctx.stop();
});

test('default statuses carry a category; isDone is derived', async () => {
  const r = await admin.get('/projects/SO/taxonomies?kind=status');
  const meta = Object.fromEntries(r.body.taxonomies.map((t) => [t.key, t.meta]));
  assert.equal(meta.finished.category, 'done');
  assert.equal(meta.finished.isDone, true);
  assert.equal(meta.onprocess.category, 'inprogress');
  assert.equal(meta.pending.category, 'todo');
  assert.equal(meta.pending.isDone, false);
});

test('taxonomy meta is merged and lifecycle keys are reserved', async () => {
  const s = await admin.post('/projects/SO/taxonomies', {
    kind: 'sprint',
    key: 's1',
    label: 'Sprint 1',
    meta: { startDate: '2026-09-01', endDate: '2026-09-07', status: 'active' },
  });
  assert.equal(s.status, 201);
  assert.equal(s.body.taxonomy.meta.status, 'draft');
  const p = await admin.patch(`/projects/SO/taxonomies/${s.body.taxonomy._id}`, { meta: { goal: 'Livrer', status: 'active' } });
  assert.equal(p.status, 200);
  assert.equal(p.body.taxonomy.meta.goal, 'Livrer');
  assert.equal(p.body.taxonomy.meta.startDate, '2026-09-01');
  assert.equal(p.body.taxonomy.meta.status, 'draft');
  const denied = await dev.post('/projects/SO/taxonomies', { kind: 'category', key: 'x', label: 'X' });
  assert.equal(denied.status, 403);
});

test('task query: @me/@current tokens, statusCategory, labels, summary, search, sort and paging', async () => {
  await Project.updateOne({ key: 'SO' }, { $set: { currentSprint: 's1' } });
  const devId = ctx.users.dev._id.toString();
  await admin.post('/projects/SO/tasks', { title: 'Mine in sprint', status: 'pending', sprint: 's1', assignee: devId, labels: ['auth', 'mobile'] });
  await admin.post('/projects/SO/tasks', { title: 'Other in sprint', status: 'onprocess', sprint: 's1' });
  await admin.post('/projects/SO/tasks', { title: 'Mine done', status: 'finished', assignee: devId });

  const mine = await dev.get('/projects/SO/tasks?assignee=@me&sprint=@current');
  assert.deepEqual(mine.body.tasks.map((t) => t.title), ['Mine in sprint']);

  const open = await dev.get('/projects/SO/tasks?statusCategory=todo&statusCategory=inprogress');
  assert.equal(open.body.tasks.length, 2);

  const labelled = await dev.get('/projects/SO/tasks?labels=mobile&fields=summary');
  assert.equal(labelled.body.tasks.length, 1);
  assert.equal('history' in labelled.body.tasks[0], false);

  const search = await dev.get('/projects/SO/tasks?search=MINE');
  assert.equal(search.body.tasks.length, 2);

  const paged = await dev.get('/projects/SO/tasks?limit=1&sort=title:desc');
  assert.equal(paged.body.tasks.length, 1);
  assert.equal(paged.headers.get('x-total-count'), '3');
  assert.equal(paged.body.tasks[0].title, 'Other in sprint');

  const backlog = await dev.get('/projects/SO/tasks?sprint=@none');
  assert.deepEqual(backlog.body.tasks.map((t) => t.title), ['Mine done']);
});

test('saved filter applied server-side through filterId; explicit params override it', async () => {
  const f = await dev.post('/projects/SO/filters', { name: 'Sprint courant', filters: { sprint: ['@current'] } });
  assert.equal(f.status, 201);
  const viaFilter = await dev.get(`/projects/SO/tasks?filterId=${f.body.filter._id}`);
  assert.equal(viaFilter.body.tasks.length, 2);
  const overridden = await dev.get(`/projects/SO/tasks?filterId=${f.body.filter._id}&status=onprocess`);
  assert.deepEqual(overridden.body.tasks.map((t) => t.title), ['Other in sprint']);
  const invalid = await dev.post('/projects/SO/filters', { name: 'Bad', groupBy: 'foo' });
  assert.equal(invalid.status, 400);
  const badSort = await dev.post('/projects/SO/filters', { name: 'Bad sort', sort: { key: '$where' } });
  assert.equal(badSort.status, 400);
  const dup = await admin.post(`/projects/SO/filters/${f.body.filter._id}/duplicate`, {});
  assert.equal(dup.status, 404, 'private filter of someone else cannot be duplicated');
});

test('resolvedAt / statusChangedAt follow the status category; labels are tracked once', async () => {
  const t = await dev.post('/projects/SO/tasks', { title: 'Resolve me', status: 'pending' });
  const id = t.body.task.taskId;
  assert.equal(t.body.task.resolvedAt, null);
  const done = await dev.patch(`/projects/SO/tasks/${id}`, { status: 'finished' });
  assert.ok(done.body.task.resolvedAt);
  assert.ok(done.body.task.statusChangedAt);
  const back = await dev.patch(`/projects/SO/tasks/${id}`, { status: 'pending' });
  assert.equal(back.body.task.resolvedAt, null);
  await dev.patch(`/projects/SO/tasks/${id}`, { labels: ['a', 'b'] });
  const same = await dev.patch(`/projects/SO/tasks/${id}`, { labels: ['a', 'b'], duration: '2 j' });
  assert.equal(same.body.task.history.filter((h) => h.field === 'labels').length, 1);
  assert.equal(same.body.task.durationHours, 16);
});

test('roles: members cannot delete tasks, viewers are read-only, members-only projects are hidden', async () => {
  const t = await dev.post('/projects/SO/tasks', { title: 'Delete me', status: 'pending' });
  const denied = await dev.del(`/projects/SO/tasks/${t.body.task.taskId}`);
  assert.equal(denied.status, 403);

  const added = await admin.post('/projects/SO/members', { userIds: [viewerId], role: 'viewer' });
  assert.equal(added.status, 201);
  const ro = await viewer.post('/projects/SO/tasks', { title: 'nope', status: 'pending' });
  assert.equal(ro.status, 403);
  assert.equal(ro.body.code, 'READ_ONLY_ROLE');
  assert.equal((await viewer.get('/projects/SO/tasks')).status, 200);

  assert.equal((await admin.patch('/projects/SO', { access: 'members' })).status, 200);
  assert.equal((await dev.get('/projects/SO/tasks')).status, 404);
  assert.equal((await dev.get('/projects')).body.projects.some((p) => p.key === 'SO'), false);
  assert.equal((await viewer.get('/projects/SO')).body.project.myRole, 'viewer');
  const members = await admin.get('/projects/SO/members');
  assert.deepEqual(members.body.members.map((m) => m.user.username).sort(), ['admin', 'viewer']);

  assert.equal((await admin.del(`/projects/SO/tasks/${t.body.task.taskId}`)).status, 200);
  await admin.patch('/projects/SO', { access: 'open' });
  assert.equal((await dev.get('/projects/SO/tasks')).status, 200);
});

test('project settings: defaults validated and applied, currentSprint not writable', async () => {
  const bad = await admin.patch('/projects/SO', { defaults: { status: 'nope' } });
  assert.equal(bad.status, 400);
  const ok = await admin.patch('/projects/SO', {
    defaults: { status: 'draft', priority: 'P1' },
    timezone: 'Europe/Paris',
    estimation: { unit: 'points', scale: [1, 2, 4, 8] },
    currentSprint: 'hijack',
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.project.currentSprint, 's1');
  const created = await dev.post('/projects/SO/tasks', { title: 'Defaults' });
  assert.equal(created.status, 201);
  assert.equal(created.body.task.status, 'draft');
  assert.equal(created.body.task.priority, 'P1');
  const stats = await dev.get('/projects/SO/stats');
  assert.equal(typeof stats.body.openBugs, 'number');
  const overview = await dev.get('/projects/SO/overview');
  assert.equal(overview.status, 200);
  assert.ok(overview.body.taskCount >= 4);
});

test('archived project is read-only, then deletable by a superadmin only', async () => {
  await admin.post('/projects', { key: 'AR', name: 'Archive me' });
  await admin.post('/projects/AR/tasks', { title: 'x', status: 'pending' });
  const early = await admin.del('/projects/AR?confirmKey=AR');
  assert.equal(early.body.code, 'NOT_ARCHIVED');

  assert.equal((await admin.post('/projects/AR/archive')).status, 200);
  const write = await admin.post('/projects/AR/tasks', { title: 'y', status: 'pending' });
  assert.equal(write.status, 423);
  assert.equal((await admin.get('/projects/AR/tasks')).status, 200);
  assert.equal((await admin.get('/projects')).body.projects.some((p) => p.key === 'AR'), false);
  assert.equal((await admin.get('/projects?archived=1')).body.projects.some((p) => p.key === 'AR'), true);

  assert.equal((await admin.del('/projects/AR?confirmKey=XX')).body.code, 'CONFIRM_MISMATCH');
  assert.equal((await dev.del('/projects/AR?confirmKey=AR')).status, 403);
  const deleted = await admin.del('/projects/AR?confirmKey=AR');
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted.tasks, 1);
  assert.equal((await admin.get('/projects/AR')).status, 404);
});

test('taxonomies: replace migrates tasks and saved filters, reorder, workflow keeps a done status', async () => {
  const oldCat = await admin.post('/projects/SO/taxonomies', { kind: 'category', key: 'old', label: 'Old' });
  await admin.post('/projects/SO/taxonomies', { kind: 'category', key: 'new', label: 'New' });
  const t = await dev.post('/projects/SO/tasks', { title: 'Cat', status: 'pending', category: 'old' });
  await dev.post('/projects/SO/filters', { name: 'Old cat', filters: { category: ['old'] } });

  const r = await admin.post(`/projects/SO/taxonomies/${oldCat.body.taxonomy._id}/replace`, { replacementKey: 'new' });
  assert.equal(r.status, 200);
  assert.equal(r.body.tasksUpdated, 1);
  assert.equal(r.body.filtersUpdated, 1);
  const task = await dev.get(`/projects/SO/tasks/${t.body.task.taskId}`);
  assert.equal(task.body.task.category, 'new');
  assert.ok(task.body.task.history.some((h) => h.field === 'category' && h.to === 'new'));
  const filters = await dev.get('/projects/SO/filters');
  assert.deepEqual(filters.body.filters.find((f) => f.name === 'Old cat').filters.category, ['new']);

  const statuses = (await admin.get('/projects/SO/taxonomies?kind=status')).body.taxonomies;
  const reversed = statuses.map((s) => s.key).reverse();
  assert.equal((await admin.put('/projects/SO/taxonomies/order', { kind: 'status', keys: reversed })).status, 200);
  const reordered = (await admin.get('/projects/SO/taxonomies?kind=status')).body.taxonomies;
  assert.deepEqual(reordered.map((s) => s.key), reversed);

  const confirmed = reordered.find((s) => s.key === 'confirmed');
  assert.equal((await admin.del(`/projects/SO/taxonomies/${confirmed._id}`)).status, 200);
  const finished = reordered.find((s) => s.key === 'finished');
  const guard = await admin.post(`/projects/SO/taxonomies/${finished._id}/replace`, { replacementKey: 'pending' });
  assert.equal(guard.status, 409);
  assert.equal(guard.body.code, 'CATEGORY_REQUIRED');
  const recategorize = await admin.patch(`/projects/SO/taxonomies/${finished._id}`, { meta: { category: 'todo' } });
  assert.equal(recategorize.body.code, 'CATEGORY_REQUIRED');
});
