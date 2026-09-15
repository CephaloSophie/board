const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { Taxonomy } = require('../src/models/Taxonomy');
const { Project } = require('../src/models/Project');

let ctx;
let admin;
let dev;
let taskId;

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

before(async () => {
  ctx = await startTestServer();
  admin = ctx.client(await ctx.login('admin'));
  dev = ctx.client(await ctx.login('dev'));
  assert.equal((await admin.post('/projects', { key: 'CO', name: 'Collab' })).status, 201);
});

after(async () => {
  await ctx.stop();
});

const unreadOf = async (client) => (await client.get('/notifications')).body;

test('assignment, comments, replies, mentions and reactions notify the right people and are traced', async () => {
  const devId = ctx.users.dev._id.toString();
  const created = await admin.post('/projects/CO/tasks', { title: 'Écran de login', status: 'pending', assignee: devId });
  assert.equal(created.status, 201);
  taskId = created.body.task.taskId;

  let inbox = await unreadOf(dev);
  assert.equal(inbox.unread, 1);
  assert.equal(inbox.notifications[0].type, 'assigned');
  assert.equal(inbox.notifications[0].taskId, taskId);
  assert.equal((await unreadOf(admin)).unread, 0); // never notified of one's own action

  const c1 = await admin.post(`/projects/CO/tasks/${taskId}/comments`, { text: 'Salut @dev, regarde **ça** {color:#e85d70}vite{color}' });
  assert.equal(c1.status, 201);
  inbox = await unreadOf(dev);
  assert.equal(inbox.unread, 2);
  assert.equal(inbox.notifications[0].type, 'mention'); // mention wins over "comment on your task"
  assert.equal(inbox.notifications[0].excerpt, 'Salut @dev, regarde ça vite');

  const reply = await dev.post(`/projects/CO/tasks/${taskId}/comments`, { text: 'Je regarde', parent: c1.body.commentId });
  assert.equal(reply.status, 201);
  const replyComment = reply.body.comments.find((c) => c._id === reply.body.commentId);
  assert.equal(replyComment.parent, c1.body.commentId);
  // A reply to a reply is attached to the thread root.
  const nested = await admin.post(`/projects/CO/tasks/${taskId}/comments`, { text: 'Merci', parent: reply.body.commentId });
  assert.equal(nested.body.comments.find((c) => c._id === nested.body.commentId).parent, c1.body.commentId);
  assert.equal((await unreadOf(admin)).notifications[0].type, 'reply');

  const react = await dev.post(`/projects/CO/tasks/${taskId}/comments/${c1.body.commentId}/reactions`, { emoji: '👍' });
  assert.equal(react.status, 200);
  assert.equal(react.body.added, true);
  const reacted = react.body.comments.find((c) => c._id === c1.body.commentId);
  assert.equal(reacted.reactions[0].users[0].username, 'dev');
  assert.ok((await unreadOf(admin)).notifications.some((n) => n.type === 'reaction'));
  const toggled = await dev.post(`/projects/CO/tasks/${taskId}/comments/${c1.body.commentId}/reactions`, { emoji: '👍' });
  assert.equal(toggled.body.added, false);
  assert.equal(toggled.body.comments.find((c) => c._id === c1.body.commentId).reactions.length, 0);
  assert.equal((await dev.post(`/projects/CO/tasks/${taskId}/comments/${c1.body.commentId}/reactions`, { emoji: '💩' })).body.code, 'REACTION_INVALID');

  assert.equal((await dev.del(`/projects/CO/tasks/${taskId}/comments/${c1.body.commentId}`)).status, 403);
  const removed = await admin.del(`/projects/CO/tasks/${taskId}/comments/${c1.body.commentId}`);
  assert.equal(removed.body.removed, 3);

  const task = (await dev.get(`/projects/CO/tasks/${taskId}`)).body.task;
  assert.equal(task.comments.length, 0);
  const commentHistory = task.history.filter((h) => h.field === 'comment').map((h) => h.note);
  assert.deepEqual(commentHistory, ['Commentaire ajouté.', 'Réponse à un commentaire.', 'Réponse à un commentaire.', 'Commentaire supprimé (avec 2 réponse(s)).']);

  const read = await dev.post('/notifications/read', { all: true });
  assert.equal(read.body.unread, 0);
  assert.equal((await dev.post('/notifications/read', {})).status, 400);
});

test('every field change is in the task history and the filterable activity feed', async () => {
  const patched = await dev.patch(`/projects/CO/tasks/${taskId}`, {
    status: 'finished',
    complexity: 5,
    estimate: '2h',
    description: 'Voir avec @admin le **design**',
  });
  assert.equal(patched.status, 200);
  const fields = patched.body.task.history.map((h) => h.field);
  for (const f of ['status', 'complexity', 'estimate', 'description']) assert.ok(fields.includes(f), f);
  assert.equal(patched.body.task.history.find((h) => h.field === 'description').to, 'Voir avec @admin le design');

  const adminInbox = await unreadOf(admin);
  const types = adminInbox.notifications.filter((n) => !n.read).map((n) => n.type);
  assert.ok(types.includes('mention'));
  assert.ok(!types.includes('status')); // same patch: the mention already notified the reporter

  const feed = await admin.get(`/projects/CO/activity?taskId=${taskId}&limit=100`);
  assert.equal(feed.status, 200);
  const actions = feed.body.entries.map((e) => `${e.action}:${e.field || ''}`);
  for (const a of ['task.created:created', 'comment.added:comment', 'comment.replied:comment', 'reaction.added:', 'comment.deleted:comment', 'task.updated:status', 'task.updated:description']) {
    assert.ok(actions.includes(a), a);
  }
  const byDev = await admin.get(`/projects/CO/activity?user=${ctx.users.dev._id}&field=status`);
  assert.equal(byDev.body.entries.length, 1);
  assert.equal(byDev.body.entries[0].actor.username, 'dev');
  assert.equal(byDev.body.entries[0].to, 'finished');

  const page1 = await admin.get('/projects/CO/activity?limit=2');
  assert.equal(page1.body.entries.length, 2);
  assert.ok(page1.body.nextCursor);
  const page2 = await admin.get(`/projects/CO/activity?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
  assert.ok(!page2.body.entries.some((e) => page1.body.entries.some((x) => x._id === e._id)));

  const future = await admin.get('/projects/CO/activity?from=2999-01-01');
  assert.equal(future.body.entries.length, 0);
  const global = await dev.get('/activity?project=CO&limit=1');
  assert.equal(global.body.entries[0].projectKey, 'CO');
});

test('planning: bulk moves, current sprint, leftovers of the previous sprint, tolerant sprint meta', async () => {
  const ids = [];
  for (const title of ['P1', 'P2', 'P3']) ids.push((await dev.post('/projects/CO/tasks', { title, status: 'pending', complexity: 2 })).body.task.taskId);
  await admin.post('/projects/CO/sprints', { label: 'Sprint 1', startDate: '2026-09-01', endDate: '2026-09-14' });
  await admin.post('/projects/CO/sprints', { label: 'Sprint 2' });

  const bulk = await dev.post('/projects/CO/tasks/bulk', { taskIds: [...ids, 'CO-999'], patch: { sprint: 'sprint-1', title: 'ignored' } });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.updated, 3);
  assert.deepEqual(bulk.body.notFound, ['CO-999']);
  assert.equal((await dev.post('/projects/CO/tasks/bulk', { taskIds: ids, patch: { title: 'x' } })).body.code, 'EMPTY_PATCH');
  const moved = await admin.get('/projects/CO/activity?sprint=sprint-1&field=sprint');
  assert.equal(moved.body.entries.length, 3);

  const current = await admin.put('/projects/CO/sprints/current', { key: 'sprint-2' });
  assert.equal(current.body.currentSprint, 'sprint-2');
  assert.equal((await dev.put('/projects/CO/sprints/current', { key: 'sprint-1' })).status, 403);
  assert.equal((await admin.get('/projects/CO/activity?action=sprint.current')).body.entries[0].to, 'sprint-2');

  assert.equal((await admin.post('/projects/CO/sprints/sprint-1/start')).status, 200);
  assert.equal((await admin.put('/projects/CO/sprints/current', { key: 'sprint-2' })).body.code, 'ACTIVE_SPRINT_EXISTS');
  await dev.patch(`/projects/CO/tasks/${ids[0]}`, { status: 'finished' });
  const closed = await admin.post('/projects/CO/sprints/sprint-1/close', { carryOver: { mode: 'sprint', targetKey: 'sprint-2' }, keep: [ids[2]] });
  assert.equal(closed.status, 200);

  const leftovers = await admin.get('/projects/CO/sprints/sprint-1/leftovers');
  assert.deepEqual(leftovers.body.notDone.map((t) => t.taskId), [ids[2]]);
  assert.deepEqual(leftovers.body.carriedOver.map((t) => [t.taskId, t.sprint]), [[ids[1], 'sprint-2']]);
  const sprintFeed = (await admin.get('/projects/CO/activity?scope=sprint&sprint=sprint-1')).body.entries.map((e) => e.action);
  for (const a of ['sprint.created', 'sprint.started', 'sprint.closed']) assert.ok(sprintFeed.includes(a), a);

  // Sprint rows whose meta was never written still expose an object.
  const project = await Project.findOne({ key: 'CO' });
  await Taxonomy.create({ project: project._id, kind: 'sprint', key: 'legacy', label: 'Legacy' });
  const list = await admin.get('/projects/CO/sprints');
  assert.deepEqual(list.body.sprints.find((s) => s.key === 'legacy').meta, {});
});

test('images are uploaded as attachments and served publicly by unguessable id', async () => {
  const up = await dev.post('/projects/CO/attachments', { name: 'capture écran.png', data: `data:image/png;base64,${PNG_1PX}`, taskId });
  assert.equal(up.status, 201);
  assert.match(up.body.attachment.url, /^\/api\/files\/[\w-]{24}\/capture-ecran\.png$/);
  const res = await fetch(ctx.base.replace(/\/api$/, '') + up.body.attachment.url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString('base64'), PNG_1PX);

  const fake = await dev.post('/projects/CO/attachments', { name: 'x.png', data: Buffer.from('<svg onload=alert(1)>').toString('base64') });
  assert.equal(fake.status, 415);
  assert.equal((await fetch(`${ctx.base}/files/nope/x.png`)).status, 404);
});
