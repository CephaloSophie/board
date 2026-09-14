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
  await admin.post('/projects', { key: 'SF', name: 'Saved filters' });
});

after(async () => {
  await ctx.stop();
});

test('create a private filter; unknown keys are stripped', async () => {
  const r = await dev.post('/projects/SF/filters', {
    name: 'Mes bugs',
    filters: { status: ['pending'], type: 'bug', $where: 'evil', search: 'login' },
    view: 'list',
    groupBy: 'assignee',
    sort: { key: 'priority', dir: -1 },
  });
  assert.equal(r.status, 201);
  const f = r.body.filter;
  assert.equal(f.isOwner, true);
  assert.equal(f.visibility, 'private');
  assert.deepEqual(f.filters.type, ['bug']);
  assert.equal(f.filters.search, 'login');
  assert.equal('$where' in f.filters, false);
  assert.deepEqual(f.sort, { key: 'priority', dir: -1 });
});

test('duplicate names per owner are refused with 409', async () => {
  const r = await dev.post('/projects/SF/filters', { name: 'Mes bugs' });
  assert.equal(r.status, 409);
  const other = await admin.post('/projects/SF/filters', { name: 'Mes bugs' });
  assert.equal(other.status, 201, 'another user may reuse the name');
});

test('private filters are invisible to others, shared ones are visible but read-only', async () => {
  const list = await admin.get('/projects/SF/filters');
  const names = list.body.filters.map((f) => `${f.name}:${f.owner.username}`);
  assert.equal(names.includes('Mes bugs:dev'), false);

  const shared = await dev.post('/projects/SF/filters', { name: 'Sprint courant', visibility: 'shared' });
  const id = shared.body.filter._id;
  const seen = await admin.get('/projects/SF/filters');
  assert.ok(seen.body.filters.some((f) => f._id === id && f.isOwner === false));

  // superadmin may still moderate; a developer may not edit someone else's filter
  const other = await admin.post('/projects/SF/filters', { name: 'Admin partagé', visibility: 'shared' });
  const denied = await dev.patch(`/projects/SF/filters/${other.body.filter._id}`, { name: 'hack' });
  assert.equal(denied.status, 403);
});

test('star and default are per-user, with a single default per project', async () => {
  const list = await dev.get('/projects/SF/filters');
  const [a, b] = list.body.filters.filter((f) => f.visibility === 'shared');

  const starred = await dev.put(`/projects/SF/filters/${a._id}/star`, { starred: true });
  assert.equal(starred.body.filter.isStarred, true);

  await dev.put(`/projects/SF/filters/${a._id}/default`, { isDefault: true });
  await dev.put(`/projects/SF/filters/${b._id}/default`, { isDefault: true });
  const after = await dev.get('/projects/SF/filters');
  const defaults = after.body.filters.filter((f) => f.isDefault);
  assert.deepEqual(defaults.map((f) => f._id), [b._id]);

  const adminView = await admin.get('/projects/SF/filters');
  assert.equal(adminView.body.filters.some((f) => f.isDefault || f.isStarred), false);
});

test('owner can update and delete', async () => {
  const created = await dev.post('/projects/SF/filters', { name: 'Temp' });
  const id = created.body.filter._id;
  const upd = await dev.patch(`/projects/SF/filters/${id}`, { filters: { priority: ['P0'] }, view: 'jira' });
  assert.equal(upd.status, 200);
  assert.deepEqual(upd.body.filter.filters.priority, ['P0']);
  assert.equal(upd.body.filter.view, 'jira');
  const del = await dev.del(`/projects/SF/filters/${id}`);
  assert.equal(del.status, 200);
  const gone = await dev.put(`/projects/SF/filters/${id}/star`, {});
  assert.equal(gone.status, 404);
});
