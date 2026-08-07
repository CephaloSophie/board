const { Schema, model } = require('mongoose');

const commentSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true },
    editedAt: { type: Date },
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

    estimate: { type: String, trim: true },
    duration: { type: String, trim: true },
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
    acceptance: { type: [String], default: [] },

    assignee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reporter: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    team: { type: Schema.Types.ObjectId, ref: 'Team', default: null },

    comments: { type: [commentSchema], default: [] },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

taskSchema.index({ project: 1, taskId: 1 }, { unique: true });
taskSchema.index({ project: 1, status: 1 });
taskSchema.index({ title: 'text', description: 'text' });

module.exports = { Task: model('Task', taskSchema) };
