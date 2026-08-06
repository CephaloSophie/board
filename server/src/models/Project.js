const { Schema, model } = require('mongoose');

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
    // key of the taxonomy(kind=sprint) that is considered "current" for
    // the app (default target for new tasks, highlighted in the sidebar).
    currentSprint: { type: String, default: null },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Effective sprint length in days, derived from value + unit.
projectSchema.methods.effectiveSprintDays = function effectiveSprintDays() {
  const v = this.sprintDurationValue || 1;
  return this.sprintDurationUnit === 'weeks' ? v * 7 : v;
};

module.exports = { Project: model('Project', projectSchema) };
