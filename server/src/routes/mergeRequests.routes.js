const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { loadProject, requireWriteAccess, blockWritesIfArchived } = require('../middleware/project');
const { httpError } = require('../utils/httpError');
const { notify } = require('../utils/notify');
const { findTask, recordTaskEvents, USER_FIELDS } = require('../utils/taskEvents');
const {
  MAX_MERGE_REQUESTS,
  MR_STATES,
  mergeRequestFromInput,
  mergeRequestLabel,
  parseMergeRequestUrl,
  cleanState,
  cleanTitle,
  findMergeRequest,
} = require('../utils/mergeRequests');

/*
 * Merge / pull requests linked to a task: /api/projects/:projectKey/tasks/:taskId/merge-requests
 * Responses carry the whole populated list: { mergeRequests }.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject, blockWritesIfArchived, requireWriteAccess);

const STATE_LABELS = { draft: 'brouillon', open: 'ouverte', merged: 'fusionnée', closed: 'fermée' };

async function respond(res, task, status = 200, extra = {}) {
  await task.populate({ path: 'mergeRequests.addedBy', select: USER_FIELDS });
  res.status(status).json({ mergeRequests: task.mergeRequests, ...extra });
}

const sameUrl = (a, b) => String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();

router.get('/', async (req, res) => {
  await respond(res, await findTask(req));
});

// { url, title?, state? }
router.post('/', async (req, res) => {
  const task = await findTask(req);
  const mr = mergeRequestFromInput(req.body || {}, req.user);
  if (task.mergeRequests.some((m) => sameUrl(m.url, mr.url))) {
    throw httpError(409, 'MR_DUPLICATE', 'Cette merge request est déjà liée à la tâche.');
  }
  if (task.mergeRequests.length >= MAX_MERGE_REQUESTS) {
    throw httpError(400, 'TOO_MANY_MR', `${MAX_MERGE_REQUESTS} merge requests maximum par tâche.`);
  }
  task.mergeRequests.push(mr);
  const created = task.mergeRequests[task.mergeRequests.length - 1];
  await recordTaskEvents(req, task, [{ field: 'mergeRequest', to: mergeRequestLabel(created), note: `Merge request liée (${STATE_LABELS[created.state]}).` }], {
    activity: { data: { url: created.url } },
  });
  await notify(req.project, req.user, { taskId: task.taskId, taskTitle: task.title, excerpt: mergeRequestLabel(created) }, [
    { user: task.reporter, type: 'merge_request' },
    { user: task.assignee, type: 'merge_request' },
  ]);
  await respond(res, task, 201, { mergeRequestId: created._id });
});

// { url?, title?, state? }
router.patch('/:mrId', async (req, res) => {
  const b = req.body || {};
  const task = await findTask(req);
  const mr = findMergeRequest(task, req.params.mrId);
  const before = mergeRequestLabel(mr);
  const entries = [];
  if (b.url !== undefined) {
    const parsed = parseMergeRequestUrl(b.url);
    if (!sameUrl(parsed.url, mr.url)) {
      if (task.mergeRequests.some((m) => String(m._id) !== String(mr._id) && sameUrl(m.url, parsed.url))) {
        throw httpError(409, 'MR_DUPLICATE', 'Cette merge request est déjà liée à la tâche.');
      }
      Object.assign(mr, { url: parsed.url, provider: parsed.provider, repo: parsed.repo || undefined, ref: parsed.ref || undefined });
    }
  }
  if (b.title !== undefined) mr.title = cleanTitle(b.title) || undefined;
  if (mergeRequestLabel(mr) !== before) entries.push({ field: 'mergeRequest', from: before, to: mergeRequestLabel(mr), note: 'Merge request modifiée.' });
  if (b.state !== undefined) {
    const state = cleanState(b.state, mr.state);
    if (state !== mr.state) {
      entries.push({ field: 'mergeRequest', from: STATE_LABELS[mr.state], to: STATE_LABELS[state], note: `Merge request ${mergeRequestLabel(mr)} : statut changé.` });
      mr.state = state;
    }
  }
  if (entries.length) {
    await recordTaskEvents(req, task, entries, { activity: { data: { url: mr.url } } });
    if (entries.some((e) => e.to === STATE_LABELS.merged)) {
      await notify(req.project, req.user, { taskId: task.taskId, taskTitle: task.title, excerpt: `Fusionnée : ${mergeRequestLabel(mr)}` }, [
        { user: task.reporter, type: 'merge_request' },
        { user: task.assignee, type: 'merge_request' },
      ]);
    }
  }
  await respond(res, task);
});

router.delete('/:mrId', async (req, res) => {
  const task = await findTask(req);
  const mr = findMergeRequest(task, req.params.mrId);
  const label = mergeRequestLabel(mr);
  mr.deleteOne();
  await recordTaskEvents(req, task, [{ field: 'mergeRequest', from: label, note: 'Merge request retirée.' }]);
  await respond(res, task);
});

module.exports = router;
module.exports.MR_STATES = MR_STATES;
