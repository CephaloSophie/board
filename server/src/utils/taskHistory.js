// Fields that are tracked in a task's history timeline whenever they change.
const TRACKED_FIELDS = [
  'title',
  'status',
  'priority',
  'assignee',
  'sprint',
  'version',
  'type',
  'category',
  'techno',
  'area',
  'complexity',
  'team',
];

function valuesEqual(a, b) {
  if (a instanceof Object && a?.toString && b instanceof Object && b?.toString) {
    return a.toString() === b.toString();
  }
  return (a ?? null) === (b ?? null);
}

/**
 * Applies `patch` onto `task`, pushing one history entry per changed tracked
 * field. Mutates `task` in place; caller is responsible for saving it.
 */
function applyPatchWithHistory(task, patch, actingUser, note) {
  const entries = [];
  for (const field of TRACKED_FIELDS) {
    if (!(field in patch)) continue;
    const before = task[field];
    const after = patch[field];
    if (valuesEqual(before, after)) continue;
    entries.push({
      at: new Date(),
      by: actingUser?._id,
      byLabel: actingUser?.displayName,
      field,
      from: before ?? null,
      to: after ?? null,
      note: note || undefined,
    });
    task[field] = after;
  }

  // Non-tracked but still editable fields.
  const passthrough = [
    'description',
    'module',
    'estimate',
    'duration',
    'spec',
    'instructions',
    'acceptance',
  ];
  for (const field of passthrough) {
    if (field in patch) task[field] = patch[field];
  }

  if (entries.length) task.history.push(...entries);
  return entries;
}

module.exports = { applyPatchWithHistory, TRACKED_FIELDS };
