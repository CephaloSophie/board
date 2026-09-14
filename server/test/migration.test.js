const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { Project } = require('../src/models/Project');
const { Taxonomy } = require('../src/models/Taxonomy');
const { Task } = require('../src/models/Task');
const { migrate } = require('../src/migrations/2026-09-lot1');

let ctx;
const silent = { log: () => {} };

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.stop();
});

test('Lot 1 migration upgrades legacy data and is idempotent', async () => {
  const doneAt = new Date('2026-08-01T10:00:00Z');
  const { insertedId: pid } = await Project.collection.insertOne({
    key: 'LG',
    name: 'Legacy',
    currentVersion: '1.1.0',
    currentSprint: 'sprint-a',
    owner: ctx.users.admin._id,
    archived: false,
  });
  await Taxonomy.collection.insertMany([
    { project: pid, kind: 'status', key: 'pending', label: 'À faire', order: 1, meta: {} },
    { project: pid, kind: 'status', key: 'onprocess', label: 'En cours', order: 2, meta: {} },
    { project: pid, kind: 'status', key: 'finished', label: 'Terminée', order: 3, meta: { isDone: true } },
    { project: pid, kind: 'type', key: 'bug', label: 'bug', meta: {} },
    { project: pid, kind: 'type', key: 'feature', label: 'feature', meta: {} },
    { project: pid, kind: 'sprint', key: 'backlog', label: 'Backlog', archived: false, meta: {} },
    { project: pid, kind: 'sprint', key: 'sprint-a', label: 'A', archived: false, meta: { status: 'active', startDate: '2026-07-01' } },
    { project: pid, kind: 'sprint', key: 'sprint-b', label: 'B', archived: false, meta: { status: 'active', startDate: '2026-07-08' } },
    { project: pid, kind: 'version', key: '1.0.0', label: '1.0.0', meta: {} },
    { project: pid, kind: 'version', key: '1.1.0', label: '1.1.0', meta: {} },
  ]);
  await Task.collection.insertMany([
    {
      project: pid,
      taskId: 'LG-001',
      title: 'Done in backlog',
      status: 'finished',
      sprint: 'backlog',
      duration: '4 h',
      history: [{ field: 'status', from: null, to: 'finished', at: doneAt }],
      createdAt: new Date('2026-07-01'),
      updatedAt: new Date('2026-08-02'),
    },
    { project: pid, taskId: 'LG-002', title: 'Open', status: 'pending', sprint: 'sprint-a', history: [], updatedAt: new Date() },
  ]);

  const dry = await migrate({ dryRun: true, logger: silent });
  assert.ok(dry.total > 0);
  assert.equal((await Taxonomy.collection.findOne({ project: pid, key: 'pending' })).meta.category, undefined, 'dry-run writes nothing');

  const first = await migrate({ logger: silent });
  assert.ok(first.total > 0);

  const status = async (key) => (await Taxonomy.collection.findOne({ project: pid, kind: 'status', key })).meta;
  assert.equal((await status('finished')).category, 'done');
  assert.equal((await status('onprocess')).category, 'inprogress');
  assert.equal((await status('pending')).category, 'todo');
  assert.equal((await Taxonomy.collection.findOne({ project: pid, kind: 'type', key: 'bug' })).meta.isBug, true);
  assert.equal((await Taxonomy.collection.findOne({ project: pid, kind: 'sprint', key: 'backlog' })).archived, true);
  assert.equal((await Taxonomy.collection.findOne({ project: pid, kind: 'sprint', key: 'sprint-b' })).meta.status, 'finished');
  assert.equal((await Taxonomy.collection.findOne({ project: pid, kind: 'sprint', key: 'sprint-a' })).meta.status, 'active');
  assert.equal((await Taxonomy.collection.findOne({ project: pid, kind: 'version', key: '1.0.0' })).meta.status, 'released');
  assert.equal((await Taxonomy.collection.findOne({ project: pid, kind: 'version', key: '1.1.0' })).meta.status, 'unreleased');

  const done = await Task.collection.findOne({ project: pid, taskId: 'LG-001' });
  assert.equal(done.sprint, null);
  assert.equal(done.resolvedAt.toISOString(), doneAt.toISOString());
  assert.equal(done.durationHours, 4);
  assert.equal(done.history.at(-1).note, 'Migration : backlog explicite');

  const project = await Project.collection.findOne({ _id: pid });
  assert.equal(project.access, 'open');
  assert.equal(project.members.length, 1);
  assert.equal(project.members[0].role, 'admin');
  assert.deepEqual(project.defaults, { status: 'pending', type: 'feature' });
  assert.equal(project.currentSprint, 'sprint-a');

  const second = await migrate({ logger: silent });
  assert.equal(second.total, 0, JSON.stringify(second.stats));
});
