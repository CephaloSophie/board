const { Activity } = require('../models/Activity');

const compact = (list) => {
  const keys = [...new Set(list.filter((v) => v !== null && v !== undefined && v !== false && v !== '').map(String))];
  return keys.length ? keys : undefined;
};

const actorOf = (user, fallbackLabel) => ({ actor: user?._id || null, actorLabel: user?.displayName || fallbackLabel || 'système' });

// Never let the audit log break the action it describes.
async function logActivity(entries) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  if (!list.length) return;
  try {
    await Activity.insertMany(list, { ordered: false });
  } catch (err) {
    console.error('[activity]', err.message);
  }
}

// One activity row per task history entry, tagged with the sprints / versions it touches.
function taskActivities(project, task, historyEntries, user, extra = {}) {
  return historyEntries.map((h) => ({
    project: project._id,
    at: h.at || new Date(),
    ...actorOf(user, h.byLabel),
    scope: 'task',
    action: h.field === 'created' ? 'task.created' : 'task.updated',
    taskId: task.taskId,
    taskTitle: task.title,
    field: h.field,
    from: h.from,
    to: h.to,
    note: h.note,
    sprints: compact([task.sprint, h.field === 'sprint' && h.from, h.field === 'sprint' && h.to]),
    versions: compact([task.version, h.field === 'version' && h.from, h.field === 'version' && h.to]),
    ...extra,
  }));
}

// Lifecycle / project level entry (sprint started, version released, import…).
function projectActivity(project, user, fields) {
  const { sprints, versions, ...rest } = fields;
  return { project: project._id, at: new Date(), ...actorOf(user), ...rest, sprints: compact(sprints || []), versions: compact(versions || []) };
}

module.exports = { logActivity, taskActivities, projectActivity, compact };
