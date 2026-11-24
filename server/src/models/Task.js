const { Schema, model } = require('mongoose');
const { syncCriteriaOnSave } = require('../utils/criteria');
const { MR_STATES, MR_PROVIDERS } = require('../utils/mergeRequests');

const reactionSchema = new Schema(
  {
    emoji: { type: String, required: true },
    users: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
  },
  { _id: false }
);

const commentSchema = new Schema(
  {
    // null for imported comments whose author has no Kýdos account (see authorLabel).
    author: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    authorLabel: { type: String, trim: true },
    text: { type: String, required: true, trim: true, maxlength: 50000 },
    editedAt: { type: Date },
    externalId: { type: String }, // Jira comment id or "fp:<sha1>" fingerprint (idempotent re-imports)
    parent: { type: Schema.Types.ObjectId, default: null }, // reply to another comment of the same task (one level)
    mentions: { type: [Schema.Types.ObjectId], default: undefined },
    reactions: { type: [reactionSchema], default: undefined },
    // Pinned comments are listed first; a resolved thread is collapsed by default.
    pinned: { type: Boolean, default: undefined },
    pinnedAt: { type: Date },
    pinnedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolved: { type: Boolean, default: undefined },
    resolvedAt: { type: Date },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Discussion attached to one acceptance criterion (test notes, screenshots, links).
const criterionCommentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    text: { type: String, required: true, trim: true, maxlength: 20000 },
    editedAt: { type: Date },
    mentions: { type: [Schema.Types.ObjectId], default: undefined },
  },
  { timestamps: true }
);

// Acceptance criterion: ordered (array order = priority), checkable, commentable.
const criterionSchema = new Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 5000 },
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
    doneBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    comments: { type: [criterionCommentSchema], default: [] },
  },
  { timestamps: true }
);

// Merge / pull request pasted by the developer.
const mergeRequestSchema = new Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 2000 },
    title: { type: String, trim: true, maxlength: 300 },
    provider: { type: String, enum: MR_PROVIDERS, default: 'other' },
    repo: { type: String, trim: true },
    ref: { type: String, trim: true }, // "!42" (GitLab) or "#7" (GitHub…)
    state: { type: String, enum: MR_STATES, default: 'open' },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

const historySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    byLabel: { type: String }, // fallback label for seed-imported / system entries without a User ref
    field: { type: String, required: true }, // e.g. 'status', 'assignee', 'sprint', 'title', 'created'
    from: { type: Schema.Types.Mixed },
    to: { type: Schema.Types.Mixed },
    note: { type: String, trim: true },
  },
  { _id: true }
);

const taskSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    taskId: { type: String, required: true }, // e.g. "KB-142"
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },

    area: { type: String, trim: true },
    module: { type: String, trim: true },
    type: { type: String, trim: true },
    status: { type: String, trim: true, required: true },
    priority: { type: String, trim: true },
    version: { type: String, trim: true },
    sprint: { type: String, trim: true, default: null },
    techno: { type: String, trim: true },
    category: { type: String, trim: true },
    labels: { type: [String], default: [] },
    parent: { type: String, trim: true, default: null }, // taskId of the parent (epic / story)
    // Multi-valued data coming from Jira; `version` / `sprint` stay the primary values.
    components: { type: [String], default: undefined },
    fixVersions: { type: [String], default: undefined },
    affectsVersions: { type: [String], default: undefined },
    sprintHistory: { type: [String], default: undefined },
    resolution: { type: String, trim: true },
    timeOriginalEstimateSec: { type: Number },
    timeRemainingSec: { type: Number },
    timeSpentSec: { type: Number },

    estimate: { type: String, trim: true },
    duration: { type: String, trim: true },
    durationHours: { type: Number, default: 0 }, // derived from `duration` on write
    // Coerce loosely-typed inputs (e.g. "1 h", "5") to a finite number of
    // points so a stray string can never blow up a save/update.
    complexity: {
      type: Number,
      default: 0,
      set: (v) => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
        const n = parseFloat(String(v ?? '').replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
      },
    },
    spec: { type: String, trim: true },

    instructions: { type: [String], default: [] },
    // Plain mirror of `criteria[].text` (search, CSV, Jira re-import); kept in sync on save.
    acceptance: { type: [String], default: [] },
    criteria: { type: [criterionSchema], default: [] },
    mergeRequests: { type: [mergeRequestSchema], default: [] },

    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    dueDate: { type: Date, default: null },
    resolvedAt: { type: Date, default: null }, // entered a "done" status category
    statusChangedAt: { type: Date, default: null },

    // Provenance of imported tasks (Jira…), used for idempotent re-imports.
    external: {
      source: { type: String },
      key: { type: String },
      id: { type: String },
      url: { type: String },
      importJob: { type: Schema.Types.ObjectId, ref: 'ImportJob' },
      assigneeName: { type: String },
      reporterName: { type: String },
      importHash: { type: String }, // sha1 of the mapped values of the last import
    },

    comments: { type: [commentSchema], default: [] },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

taskSchema.index({ project: 1, taskId: 1 }, { unique: true });
taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ project: 1, sprint: 1 });
taskSchema.index({ project: 1, assignee: 1 });
taskSchema.index({ project: 1, updatedAt: -1 });
taskSchema.index({ project: 1, labels: 1 });
taskSchema.index({ project: 1, parent: 1 });
taskSchema.index(
  { project: 1, 'external.source': 1, 'external.key': 1 },
  { unique: true, partialFilterExpression: { 'external.key': { $exists: true } } }
);
taskSchema.index({ title: 'text', description: 'text' });

taskSchema.pre('save', function syncCriteria(next) {
  syncCriteriaOnSave(this);
  next();
});

module.exports = { Task: model('Task', taskSchema) };
