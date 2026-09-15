const { Schema, model } = require('mongoose');

// Project-wide audit log: who did what, when, on which task / sprint / version.
// Task field changes are mirrored from Task.history (which stays the source for
// burndowns); lifecycle actions (sprints, versions, imports, bulk moves) only live here.
const activitySchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    at: { type: Date, default: Date.now },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorLabel: { type: String },
    // task | comment | sprint | version | project | import
    scope: { type: String, required: true },
    // e.g. task.created, task.updated, comment.added, sprint.closed, version.released, tasks.moved
    action: { type: String, required: true },
    taskId: { type: String },
    taskTitle: { type: String },
    field: { type: String },
    from: { type: Schema.Types.Mixed },
    to: { type: Schema.Types.Mixed },
    note: { type: String },
    // Sprint / version keys the entry relates to (task location before and after, lifecycle target).
    sprints: { type: [String], default: undefined },
    versions: { type: [String], default: undefined },
    data: { type: Schema.Types.Mixed },
  },
  { versionKey: false }
);

activitySchema.index({ project: 1, at: -1 });
activitySchema.index({ project: 1, actor: 1, at: -1 });
activitySchema.index({ project: 1, taskId: 1, at: -1 });
activitySchema.index({ project: 1, sprints: 1, at: -1 });

module.exports = { Activity: model('Activity', activitySchema) };
