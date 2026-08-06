const { Schema, model } = require('mongoose');

// A linked backlog item inside an event (e.g. a story to refine, or a
// feature to demo). Keeps a per-event note / estimate / outcome without
// mutating the task itself.
const eventTaskSchema = new Schema(
  {
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    taskId: { type: String }, // denormalized human id for convenience
    note: { type: String, trim: true },
    outcome: { type: String, trim: true }, // e.g. "estimé 5 pts", "à revoir"
    presenter: { type: Schema.Types.ObjectId, ref: 'User' }, // demo prep
    order: { type: Number, default: 0 }, // demo order
  },
  { _id: true }
);

const actionItemSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    assignee: { type: Schema.Types.ObjectId, ref: 'User' },
    done: { type: Boolean, default: false },
  },
  { _id: true }
);

// An agile ceremony/event: refinement, grooming, technical point,
// architecture point, demo prep, etc. Sections are optional and driven by
// the event type's feature set — a single flexible schema covers every type.
const eventSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    type: { type: String, required: true }, // eventType taxonomy key
    title: { type: String, required: true, trim: true },
    status: { type: String, enum: ['draft', 'scheduled', 'done', 'cancelled'], default: 'draft' },
    sprint: { type: String, default: null }, // sprint taxonomy key (optional)
    scheduledAt: { type: Date, default: null },
    durationMin: { type: Number, default: 60 },

    participants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    tasks: { type: [eventTaskSchema], default: [] },

    agenda: { type: String, trim: true, default: '' },
    notes: { type: String, trim: true, default: '' },
    decisions: { type: [String], default: [] },
    actionItems: { type: [actionItemSchema], default: [] },

    // Architecture-decision-record fields (used by architecture point).
    adr: {
      context: { type: String, trim: true, default: '' },
      decision: { type: String, trim: true, default: '' },
      alternatives: { type: String, trim: true, default: '' },
      consequences: { type: String, trim: true, default: '' },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

eventSchema.index({ project: 1, sprint: 1 });
eventSchema.index({ project: 1, type: 1 });

module.exports = { Event: model('Event', eventSchema) };
