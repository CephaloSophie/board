const { Task } = require('../models/Task');
const { httpError } = require('./httpError');
const { logActivity, taskActivities } = require('./activity');
const { needsCriteriaMigration } = require('./criteria');

// Shared by the task routers (tasks, criteria, merge requests).
const USER_FIELDS = 'username displayName color';

const FULL_POPULATE = [
  { path: 'assignee', select: USER_FIELDS },
  { path: 'reporter', select: USER_FIELDS },
  { path: 'comments.author', select: USER_FIELDS },
  { path: 'comments.reactions.users', select: USER_FIELDS },
  { path: 'history.by', select: USER_FIELDS },
  { path: 'criteria.doneBy', select: USER_FIELDS },
  { path: 'criteria.comments.author', select: USER_FIELDS },
  { path: 'mergeRequests.addedBy', select: USER_FIELDS },
];

const CRITERIA_POPULATE = [
  { path: 'criteria.doneBy', select: USER_FIELDS },
  { path: 'criteria.comments.author', select: USER_FIELDS },
];

async function findTask(req, taskId = req.params.taskId) {
  const task = await Task.findOne({ project: req.project._id, taskId: String(taskId || '').toUpperCase() });
  if (!task) throw httpError(404, 'TASK_NOT_FOUND', 'Tâche introuvable.');
  return task;
}

/**
 * One-off conversion of the legacy `acceptance` string list into structured
 * criteria, persisted without touching `updatedAt` (a format change, not an edit),
 * so that criterion ids stay stable between two reads.
 */
async function ensureCriteria(task) {
  if (!needsCriteriaMigration(task)) return false;
  task.markModified('acceptance');
  await task.save({ timestamps: false });
  return true;
}

/**
 * Records "event" history entries that are not plain field changes (criterion
 * checked, merge request added, sub-task attached…), saves the task and mirrors
 * them in the project activity log. entries: [{ field, from?, to?, note }].
 */
async function recordTaskEvents(req, task, entries, { save = true, activity = {} } = {}) {
  const now = new Date();
  const rows = entries.map((e) => ({
    at: now,
    by: req.user._id,
    byLabel: req.user.displayName,
    field: e.field,
    from: e.from ?? null,
    to: e.to ?? null,
    note: e.note,
  }));
  task.history.push(...rows);
  if (save) await task.save();
  await logActivity(taskActivities(req.project, task, rows, req.user, activity));
  return rows;
}

module.exports = { USER_FIELDS, FULL_POPULATE, CRITERIA_POPULATE, findTask, ensureCriteria, recordTaskEvents };
