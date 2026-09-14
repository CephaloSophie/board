const { Schema, model } = require('mongoose');

// One Jira import run: summary, per-row report and what is needed to roll it back.
const importJobSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    source: { type: String, default: 'jira' },
    status: { type: String, enum: ['running', 'completed', 'partial', 'failed', 'rolledBack'], default: 'running' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    files: [{ _id: false, name: String, format: String, variant: String, size: Number, sha1: String, rows: Number }],
    options: { type: Schema.Types.Mixed, default: {} },
    mapping: { type: Schema.Types.Mixed, default: {} },
    counts: {
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      unchanged: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      errors: { type: Number, default: 0 },
      warnings: { type: Number, default: 0 },
    },
    taxonomiesCreated: [{ _id: false, id: Schema.Types.ObjectId, kind: String, key: String }],
    createdTaskIds: [{ type: Schema.Types.ObjectId }],
    // Updated tasks: values before the import and the imported values, per changed field.
    updates: [{ _id: false, task: Schema.Types.ObjectId, before: Schema.Types.Mixed, after: Schema.Types.Mixed, commentIds: [String] }],
    rows: { type: [Schema.Types.Mixed], default: [] }, // capped report
    warnings: { type: Schema.Types.Mixed, default: {} },
    error: { type: String },
    finishedAt: { type: Date },
    rollback: { type: Schema.Types.Mixed },
  },
  { timestamps: true, minimize: false }
);

module.exports = { ImportJob: model('ImportJob', importJobSchema) };
