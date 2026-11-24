// BOARD-001: acceptance criteria, sub-tasks, merge requests, pinned / resolved comments.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { Task } = require('../src/models/Task');
const { Project } = require('../src/models/Project');
const { migrate } = require('../src/migrations/2026-11-board-001');

let ctx;
let admin;
let dev;
const P = '/projects/BO';

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  dev = ctx.client(await ctx.login('dev'));
  assert.equal((await admin.post('/projects', { key: 'BO', name: 'Board 001' })).status, 201);
});

after(async () => {
  await ctx.stop();
});

const create = async (client, body) => {
  const r = await client.post(`${P}/tasks`, { status: 'pending', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.task;
};
const historyOf = async (taskId) => (await admin.get(`${P}/tasks/${taskId}`)).body.task.history;
const unread = async (client) => (await client.get('/notifications')).body;

test('a task is created with rich criteria and merge requests; the mirror stays searchable', async () => {
  const task = await create(admin, {
    title: 'Module paiement',
    description: '## Contexte\n- **Stripe**',
    criteria: ['Le paiement CB fonctionne', { text: 'Le reçu est envoyé', done: true }, '   '],
    mergeRequests: ['https://gitlab.example.com/pay/api/-/merge_requests/12', 'https://gitlab.example.com/pay/api/-/merge_requests/12'],
  });
  const full = (await admin.get(`${P}/tasks/${task.taskId}`)).body.task;
  assert.deepEqual(full.criteria.map((c) => [c.text, c.done]), [['Le paiement CB fonctionne', false], ['Le reçu est envoyé', true]]);
  assert.equal(full.criteria[1].doneBy.username, 'admin');
  assert.deepEqual(full.acceptance, ['Le paiement CB fonctionne', 'Le reçu est envoyé']);
  assert.equal(full.mergeRequests.length, 1, 'duplicate URLs are merged');
  assert.deepEqual([full.mergeRequests[0].provider, full.mergeRequests[0].ref], ['gitlab', '!12']);

  const found = (await admin.get(`${P}/tasks?search=reçu est envoyé&fields=summary`)).body.tasks;
  assert.deepEqual(found.map((t) => t.taskId), [task.taskId]);
  assert.equal(found[0].criteria.length, 2, 'summary keeps the criteria done flags');
  assert.equal(found[0].criteria[0].text, undefined, 'summary drops the criteria texts');

  const bad = await admin.post(`${P}/tasks`, { title: 'x', status: 'pending', mergeRequests: ['javascript:alert(1)'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'MR_URL_INVALID');
});

test('criteria: add, paste a list, edit, check, reorder, comment and delete — all traced', async () => {
  const task = await create(admin, { title: 'Recette', assignee: ctx.users.dev._id.toString() });
  const base = `${P}/tasks/${task.taskId}/criteria`;

  const one = await dev.post(base, { text: 'Connexion OK' });
  assert.equal(one.status, 201);
  const pasted = await dev.post(base, { items: ['Erreur affichée', { text: 'Mot de passe masqué', done: true }] });
  assert.equal(pasted.status, 201);
  assert.equal(pasted.body.createdIds.length, 2);
  assert.deepEqual(pasted.body.progress, { total: 3, done: 1 });
  const [a, b, c] = pasted.body.criteria.map((x) => x._id);

  assert.equal((await dev.post(base, { text: '  ' })).body.code, 'CRITERION_EMPTY');
  assert.equal((await dev.patch(`${base}/ffffffffffffffffffffffff`, { done: true })).body.code, 'CRITERION_NOT_FOUND');

  const edited = await dev.patch(`${base}/${a}`, { text: 'Connexion **OK** avec SSO' });
  assert.equal(edited.body.criteria[0].text, 'Connexion **OK** avec SSO');

  const reordered = await dev.put(`${base}/order`, { ids: [c, a] });
  assert.deepEqual(reordered.body.criteria.map((x) => x._id), [c, a, b]);

  const commented = await admin.post(`${base}/${b}/comments`, { text: 'KO sur Safari @dev ![capture](/api/files/abc/x.png)' });
  assert.equal(commented.status, 201);
  const thread = commented.body.criteria.find((x) => x._id === b).comments;
  assert.equal(thread[0].author.username, 'admin');
  const inbox = await unread(dev);
  assert.equal(inbox.notifications[0].type, 'mention');
  assert.match(inbox.notifications[0].excerpt, /^Critère « Erreur affichée »/);

  const forbidden = await dev.patch(`${base}/${b}/comments/${thread[0]._id}`, { text: 'pirate' });
  assert.equal(forbidden.status, 403);
  assert.equal((await admin.patch(`${base}/${b}/comments/${thread[0]._id}`, { text: 'OK sur Safari' })).status, 200);
  assert.equal((await admin.del(`${base}/${b}/comments/${thread[0]._id}`)).status, 200);

  // Validating the last open criteria notifies the reporter once everything is green.
  await dev.patch(`${base}/${a}`, { done: true });
  const done = await dev.patch(`${base}/${b}`, { done: true });
  assert.deepEqual(done.body.progress, { total: 3, done: 3 });
  assert.equal((await unread(admin)).notifications[0].type, 'criteria');

  const removed = await dev.del(`${base}/${c}`);
  assert.equal(removed.body.criteria.length, 2);

  const notes = (await historyOf(task.taskId)).filter((h) => h.field === 'criteria' || h.field === 'criterionComment').map((h) => h.note);
  for (const expected of ['Critère ajouté.', '2 critères ajoutés.', 'Critère modifié.', 'Critères réordonnés.', 'Commentaire sur un critère.', 'Critère validé.', 'Critère supprimé.']) {
    assert.ok(notes.includes(expected), `history contains « ${expected} »`);
  }
  const rows = (await admin.get(`${P}/activity?taskId=${task.taskId}`)).body.entries;
  assert.ok(rows.some((r) => r.field === 'criteria'), 'criteria changes reach the project journal');
});

test('criteria: a whole-list PATCH keeps matching criteria (done flag, comments)', async () => {
  const task = await create(admin, { title: 'Liste', criteria: [{ text: 'Garder', done: true }, 'Retirer'] });
  const before = (await admin.get(`${P}/tasks/${task.taskId}`)).body.task.criteria;
  const r = await admin.patch(`${P}/tasks/${task.taskId}`, { criteria: ['Nouveau', 'Garder'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.task.criteria.map((c) => [c.text, c.done]), [['Nouveau', false], ['Garder', true]]);
  assert.equal(r.body.task.criteria[1]._id, before[0]._id);
  assert.ok(r.body.task.history.some((h) => h.field === 'acceptance'));
});

test('legacy acceptance lists are converted lazily on read and by the migration', async () => {
  const project = await Project.findOne({ key: 'BO' });
  await Task.collection.insertMany([
    { project: project._id, taskId: 'BO-900', title: 'Ancienne', status: 'pending', acceptance: ['A', 'B'], history: [], comments: [] },
    { project: project._id, taskId: 'BO-901', title: 'Ancienne 2', status: 'pending', acceptance: ['C'], history: [], comments: [] },
  ]);
  const first = (await admin.get(`${P}/tasks/BO-900`)).body.task.criteria;
  const second = (await admin.get(`${P}/tasks/BO-900`)).body.task.criteria;
  assert.deepEqual(first.map((c) => c.text), ['A', 'B']);
  assert.deepEqual(second.map((c) => c._id), first.map((c) => c._id), 'ids are stable between reads');

  const quiet = { log() {} };
  assert.equal((await migrate({ dryRun: true, logger: quiet })).total, 1);
  assert.equal((await migrate({ logger: quiet })).total, 1);
  assert.equal((await migrate({ logger: quiet })).total, 0, 'idempotent');
  const migrated = await Task.findOne({ taskId: 'BO-901' }).lean();
  assert.deepEqual(migrated.criteria.map((c) => c.text), ['C']);
});

test('sub-tasks: validated hierarchy, roll-up, parent history, detach on delete', async () => {
  const module = await create(admin, { title: 'Package API', complexity: 0 });
  const s1 = await create(dev, { title: 'Endpoint A', parent: module.taskId.toLowerCase(), complexity: 3 });
  assert.equal(s1.parent, module.taskId, 'parent key is normalised');
  const s2 = await create(dev, { title: 'Endpoint B', complexity: 5 });
  assert.equal((await dev.patch(`${P}/tasks/${s2.taskId}`, { parent: module.taskId })).status, 200);
  const grand = await create(dev, { title: 'Test B', parent: s2.taskId });

  assert.equal((await dev.post(`${P}/tasks`, { title: 'x', status: 'pending', parent: 'BO-999' })).body.code, 'PARENT_NOT_FOUND');
  assert.equal((await dev.patch(`${P}/tasks/${module.taskId}`, { parent: module.taskId })).body.code, 'PARENT_SELF');
  const cycle = await dev.patch(`${P}/tasks/${module.taskId}`, { parent: grand.taskId });
  assert.equal(cycle.status, 409);
  assert.equal(cycle.body.code, 'PARENT_CYCLE');
  const bulkCycle = await dev.post(`${P}/tasks/bulk`, { taskIds: [s1.taskId, module.taskId], patch: { parent: s2.taskId } });
  assert.equal(bulkCycle.body.code, 'PARENT_CYCLE');
  assert.equal((await Task.findOne({ taskId: s1.taskId }).lean()).parent, module.taskId, 'bulk is all-or-nothing');

  await dev.patch(`${P}/tasks/${s1.taskId}`, { status: 'done' });
  const tree = (await dev.get(`${P}/tasks/${module.taskId}/subtasks`)).body;
  assert.deepEqual(tree.subtasks.map((t) => t.taskId), [s1.taskId, s2.taskId]);
  assert.deepEqual(tree.rollup, { total: 2, done: 1, points: 8, donePoints: 3 });
  assert.equal(tree.subtaskStats[s2.taskId].total, 1);
  const breadcrumb = (await dev.get(`${P}/tasks/${grand.taskId}/subtasks`)).body.ancestors.map((t) => t.taskId);
  assert.deepEqual(breadcrumb, [s2.taskId, module.taskId]);

  const list = (await dev.get(`${P}/tasks?fields=summary`)).body;
  assert.deepEqual(list.subtaskStats[module.taskId], { total: 2, done: 1, points: 8, donePoints: 3 });

  const parentHistory = (await historyOf(module.taskId)).filter((h) => h.field === 'subtask');
  assert.deepEqual(parentHistory.map((h) => h.to).filter(Boolean), [s1.taskId, s2.taskId]);
  assert.ok((await unread(admin)).notifications.some((n) => n.type === 'subtask' && n.taskId === module.taskId));

  const removed = await admin.del(`${P}/tasks/${s2.taskId}`);
  assert.deepEqual(removed.body.detached, [grand.taskId]);
  const orphan = (await admin.get(`${P}/tasks/${grand.taskId}`)).body.task;
  assert.equal(orphan.parent, null);
  assert.ok(orphan.history.some((h) => h.field === 'parent' && h.note === `Tâche parente ${s2.taskId} supprimée.`));
});

test('merge requests: link, duplicate, state change (merged notifies), edit, remove — all traced', async () => {
  const task = await create(admin, { title: 'MR', assignee: ctx.users.dev._id.toString() });
  const base = `${P}/tasks/${task.taskId}/merge-requests`;
  const added = await dev.post(base, { url: 'https://github.com/acme/board/pull/7', title: 'Fix login' });
  assert.equal(added.status, 201);
  const id = added.body.mergeRequestId;
  assert.equal(added.body.mergeRequests[0].addedBy.username, 'dev');
  assert.equal((await dev.post(base, { url: 'https://github.com/acme/board/pull/7/' })).body.code, 'MR_DUPLICATE');
  assert.equal((await dev.post(base, { url: 'notaurl' })).body.code, 'MR_URL_INVALID');
  assert.equal((await dev.patch(`${base}/${id}`, { state: 'shipped' })).body.code, 'MR_STATE_INVALID');

  const merged = await dev.patch(`${base}/${id}`, { state: 'merged' });
  assert.equal(merged.body.mergeRequests[0].state, 'merged');
  assert.equal((await unread(admin)).notifications[0].type, 'merge_request');
  const renamed = await dev.patch(`${base}/${id}`, { title: 'Fix login (SSO)' });
  assert.equal(renamed.body.mergeRequests[0].title, 'Fix login (SSO)');
  assert.equal((await dev.del(`${base}/${id}`)).body.mergeRequests.length, 0);

  const notes = (await historyOf(task.taskId)).filter((h) => h.field === 'mergeRequest').map((h) => h.note);
  assert.equal(notes.length, 4);
  assert.equal(notes[0], 'Merge request liée (ouverte).');
  assert.equal(notes[3], 'Merge request retirée.');
});

test('comments: pin and resolve threads (any writer), traced; text stays author-only', async () => {
  const task = await create(admin, { title: 'Discussion' });
  const c = await admin.post(`${P}/tasks/${task.taskId}/comments`, { text: 'Question ?' });
  const reply = await dev.post(`${P}/tasks/${task.taskId}/comments`, { text: 'Réponse', parent: c.body.commentId });
  const url = (id) => `${P}/tasks/${task.taskId}/comments/${id}`;

  const pinned = await dev.patch(url(c.body.commentId), { pinned: true });
  assert.equal(pinned.status, 200);
  const root = pinned.body.comments.find((x) => x._id === c.body.commentId);
  assert.equal(root.pinned, true);
  assert.equal((await dev.patch(url(reply.body.commentId), { resolved: true })).body.code, 'COMMENT_NOT_ROOT');
  const resolved = await dev.patch(url(c.body.commentId), { resolved: true });
  assert.equal(resolved.body.comments.find((x) => x._id === c.body.commentId).resolved, true);
  assert.equal((await dev.patch(url(c.body.commentId), { text: 'détourné' })).status, 403);
  assert.equal((await dev.patch(url(c.body.commentId), {})).body.code, 'EMPTY_PATCH');

  const notes = (await historyOf(task.taskId)).filter((h) => h.field === 'comment').map((h) => h.note);
  assert.ok(notes.includes('Commentaire épinglé.'));
  assert.ok(notes.includes('Discussion résolue.'));
});

test('viewers cannot touch criteria nor merge requests', async () => {
  const task = await create(admin, { title: 'Lecture seule', criteria: ['A'] });
  const devId = ctx.users.dev._id.toString();
  assert.ok((await admin.post(`${P}/members`, { userIds: [devId], role: 'viewer' })).status < 300);
  assert.equal((await dev.get(`${P}/tasks/${task.taskId}/criteria`)).status, 200);
  assert.equal((await dev.post(`${P}/tasks/${task.taskId}/criteria`, { text: 'B' })).status, 403);
  assert.equal((await dev.post(`${P}/tasks/${task.taskId}/merge-requests`, { url: 'https://github.com/a/b/pull/1' })).status, 403);
});
