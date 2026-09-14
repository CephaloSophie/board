const { Schema, model } = require('mongoose');

const PROJECT_ROLES = ['admin', 'member', 'viewer'];
const PROJECT_ACCESS = ['open', 'members'];

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: PROJECT_ROLES, default: 'member' },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: true }
);

const projectSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    vendor: { type: String, trim: true },
    description: { type: String, trim: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User' },
    currentVersion: { type: String, trim: true, default: '0.1.0' },
    complexityScale: { type: String, default: 'Fibonacci (points de story) : 1, 2, 3, 5, 8, 13' },
    // Default cadence for *future* sprints only. Existing sprints keep their
    // own start/end dates, so changing this never retroactively shifts the
    // current or past sprints — it just drives the dates proposed when the
    // next sprint is created.
    sprintDurationValue: { type: Number, default: 1 },
    sprintDurationUnit: { type: String, enum: ['days', 'weeks'], default: 'weeks' },
    // Key of the active sprint (taxonomy kind=sprint). Driven by the sprint
    // lifecycle routes (start/close), not edited directly.
    currentSprint: { type: String, default: null },

    // Access control: 'open' = every active user is a member; 'members' =
    // only listed members (plus owner and superadmins) can see the project.
    access: { type: String, enum: PROJECT_ACCESS, default: 'open' },
    members: { type: [memberSchema], default: [] },

    timezone: { type: String, default: 'Europe/Paris' },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0 = Sunday
    estimation: {
      unit: { type: String, enum: ['points', 'hours'], default: 'points' },
      scale: { type: [Number], default: [1, 2, 3, 5, 8, 13] },
    },
    // Values pre-selected when creating a task.
    defaults: {
      status: { type: String },
      type: { type: String },
      priority: { type: String },
    },

    archived: { type: Boolean, default: false },
    archivedAt: { type: Date },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

projectSchema.index({ 'members.user': 1 });

// Effective sprint length in days, derived from value + unit.
projectSchema.methods.effectiveSprintDays = function effectiveSprintDays() {
  const v = this.sprintDurationValue || 1;
  return this.sprintDurationUnit === 'weeks' ? v * 7 : v;
};

module.exports = { Project: model('Project', projectSchema), PROJECT_ROLES, PROJECT_ACCESS };
