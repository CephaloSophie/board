const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { loadProject, requireWriteAccess, blockWritesIfArchived } = require('../middleware/project');
const { httpError } = require('../utils/httpError');
const { resolveMentions, excerptOf, notify } = require('../utils/notify');
const { findTask, ensureCriteria, recordTaskEvents, CRITERIA_POPULATE } = require('../utils/taskEvents');
const {
  MAX_CRITERIA,
  MAX_CRITERION_COMMENT_LENGTH,
  cleanText,
  criteriaFromInput,
  criteriaProgress,
  findCriterion,
  reorderCriteria,
} = require('../utils/criteria');

/*
 * Acceptance criteria of a task: /api/projects/:projectKey/tasks/:taskId/criteria
 * Every write produces a task history entry (field "criteria" or
 * "criterionComment"), an activity row and, when relevant, notifications.
 * Responses always carry the whole, populated list: { criteria, progress }.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject, blockWritesIfArchived, requireWriteAccess);

const short = (text) => excerptOf(text, 120);

async function loadTask(req) {
  const task = await findTask(req);
  await ensureCriteria(task);
  return task;
}

async function respond(res, task, status = 200, extra = {}) {
  await task.populate(CRITERIA_POPULATE);
  res.status(status).json({ criteria: task.criteria, progress: criteriaProgress(task), ...extra });
}

function assertCommentOwner(req, comment, verb) {
  if (String(comment.author) === String(req.user._id) || req.projectRole === 'admin') return;
  throw httpError(403, 'NOT_COMMENT_AUTHOR', `Vous ne pouvez ${verb} que vos propres commentaires.`);
}

router.get('/', async (req, res) => {
  await respond(res, await loadTask(req));
});

// { text } adds one criterion, { items: [text | { text, done }] } adds a pasted list. position: "start" | "end".
router.post('/', async (req, res) => {
  const b = req.body || {};
  const task = await loadTask(req);
  const items = criteriaFromInput(Array.isArray(b.items) ? b.items : [b], req.user);
  if (!items.length) throw httpError(400, 'CRITERION_EMPTY', "Le critère d'acceptation est vide.");
  if (task.criteria.length + items.length > MAX_CRITERIA) {
    throw httpError(400, 'TOO_MANY_CRITERIA', `${MAX_CRITERIA} critères d'acceptation maximum par tâche.`);
  }
  if (b.position === 'start') task.criteria.unshift(...items);
  else task.criteria.push(...items);
  const created = b.position === 'start' ? task.criteria.slice(0, items.length) : task.criteria.slice(-items.length);
  await recordTaskEvents(req, task, [
    items.length === 1
      ? { field: 'criteria', to: short(items[0].text), note: 'Critère ajouté.' }
      : { field: 'criteria', to: short(items.map((i) => i.text).join(' · ')), note: `${items.length} critères ajoutés.` },
  ]);
  await respond(res, task, 201, { createdIds: created.map((c) => c._id) });
});

// { ids: [criterionId…] } — new priority order (drag and drop).
router.put('/order', async (req, res) => {
  const task = await loadTask(req);
  if (reorderCriteria(task, req.body?.ids)) {
    await recordTaskEvents(req, task, [{ field: 'criteria', to: short(task.criteria.map((c, i) => `${i + 1}. ${c.text}`).join(' ')), note: 'Critères réordonnés.' }]);
  }
  await respond(res, task);
});

// { text?, done? }
router.patch('/:criterionId', async (req, res) => {
  const b = req.body || {};
  const task = await loadTask(req);
  const criterion = findCriterion(task, req.params.criterionId);
  const entries = [];
  if (b.text !== undefined) {
    const text = cleanText(b.text);
    if (!text) throw httpError(400, 'CRITERION_EMPTY', "Le critère d'acceptation est vide.");
    if (text !== criterion.text) {
      entries.push({ field: 'criteria', from: short(criterion.text), to: short(text), note: 'Critère modifié.' });
      criterion.text = text;
    }
  }
  let completed = false;
  if (b.done !== undefined && Boolean(b.done) !== criterion.done) {
    const done = Boolean(b.done);
    criterion.done = done;
    criterion.doneAt = done ? new Date() : null;
    criterion.doneBy = done ? req.user._id : null;
    entries.push({ field: 'criteria', to: short(criterion.text), note: done ? 'Critère validé.' : 'Critère rouvert.' });
    const progress = criteriaProgress(task);
    completed = done && progress.done === progress.total;
  }
  if (entries.length) {
    await recordTaskEvents(req, task, entries);
    if (completed) {
      const { total } = criteriaProgress(task);
      await notify(req.project, req.user, { taskId: task.taskId, taskTitle: task.title, excerpt: `${total}/${total} critères d'acceptation validés.` }, [
        { user: task.reporter, type: 'criteria' },
        { user: task.assignee, type: 'criteria' },
      ]);
    }
  }
  await respond(res, task);
});

router.delete('/:criterionId', async (req, res) => {
  const task = await loadTask(req);
  const criterion = findCriterion(task, req.params.criterionId);
  const comments = criterion.comments.length;
  const text = criterion.text;
  criterion.deleteOne();
  await recordTaskEvents(req, task, [
    { field: 'criteria', from: short(text), note: comments ? `Critère supprimé (avec ${comments} commentaire(s)).` : 'Critère supprimé.' },
  ]);
  await respond(res, task);
});

// ---------- Discussion on one criterion ----------

function commentText(body) {
  const text = String(body?.text || '').trim();
  if (!text) throw httpError(400, 'COMMENT_EMPTY', 'Le commentaire est vide.');
  if (text.length > MAX_CRITERION_COMMENT_LENGTH) throw httpError(400, 'COMMENT_TOO_LONG', 'Commentaire trop long.');
  return text;
}

router.post('/:criterionId/comments', async (req, res) => {
  const text = commentText(req.body);
  const task = await loadTask(req);
  const criterion = findCriterion(task, req.params.criterionId);
  const mentioned = await resolveMentions(req.project, text);
  criterion.comments.push({ author: req.user._id, text, mentions: mentioned.length ? mentioned.map((u) => u._id) : undefined });
  const comment = criterion.comments[criterion.comments.length - 1];
  await recordTaskEvents(req, task, [{ field: 'criterionComment', from: short(criterion.text), to: short(text), note: 'Commentaire sur un critère.' }], {
    activity: { data: { criterionId: criterion._id, commentId: comment._id } },
  });
  const excerpt = `Critère « ${excerptOf(criterion.text, 60)} » : ${excerptOf(text, 100)}`;
  await notify(req.project, req.user, { taskId: task.taskId, taskTitle: task.title, excerpt }, [
    ...mentioned.map((u) => ({ user: u._id, type: 'mention' })),
    ...criterion.comments.filter((c) => c.author).map((c) => ({ user: c.author, type: 'reply' })),
    { user: task.assignee, type: 'comment' },
    { user: task.reporter, type: 'comment' },
  ]);
  await respond(res, task, 201, { commentId: comment._id });
});

router.patch('/:criterionId/comments/:commentId', async (req, res) => {
  const text = commentText(req.body);
  const task = await loadTask(req);
  const criterion = findCriterion(task, req.params.criterionId);
  const comment = criterion.comments.id(req.params.commentId);
  if (!comment) throw httpError(404, 'COMMENT_NOT_FOUND', 'Commentaire introuvable.');
  assertCommentOwner(req, comment, 'modifier');
  if (text !== comment.text) {
    const before = new Set((await resolveMentions(req.project, comment.text)).map((u) => String(u._id)));
    const after = await resolveMentions(req.project, text);
    const previous = comment.text;
    comment.text = text;
    comment.editedAt = new Date();
    comment.mentions = after.length ? after.map((u) => u._id) : undefined;
    await recordTaskEvents(req, task, [{ field: 'criterionComment', from: short(previous), to: short(text), note: 'Commentaire de critère modifié.' }]);
    const added = after.filter((u) => !before.has(String(u._id)));
    if (added.length) {
      await notify(
        req.project,
        req.user,
        { taskId: task.taskId, taskTitle: task.title, excerpt: `Critère « ${excerptOf(criterion.text, 60)} » : ${excerptOf(text, 100)}` },
        added.map((u) => ({ user: u._id, type: 'mention' }))
      );
    }
  }
  await respond(res, task);
});

router.delete('/:criterionId/comments/:commentId', async (req, res) => {
  const task = await loadTask(req);
  const criterion = findCriterion(task, req.params.criterionId);
  const comment = criterion.comments.id(req.params.commentId);
  if (!comment) throw httpError(404, 'COMMENT_NOT_FOUND', 'Commentaire introuvable.');
  assertCommentOwner(req, comment, 'supprimer');
  const text = comment.text;
  comment.deleteOne();
  await recordTaskEvents(req, task, [{ field: 'criterionComment', from: short(text), note: 'Commentaire de critère supprimé.' }]);
  await respond(res, task);
});

module.exports = router;
