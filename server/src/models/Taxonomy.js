const { Schema, model } = require('mongoose');

// Unified collection for every configurable per-project dimension:
// status, priority, area, type, techno, category, version, sprint.
// One schema keeps the admin CRUD (list/create/update/delete/reorder) identical
// across all eight kinds instead of duplicating near-identical collections.
const KINDS = [
  'status',
  'priority',
  'area',
  'type',
  'techno',
  'category',
  'version',
  'sprint',
  // Type of agile ceremony/event (refinement, grooming, technical point,
  // architecture point, demo prep…). meta.features drives which sections
  // the event editor shows; meta.icon is an emoji shown in the UI.
  'eventType',
];

const taxonomySchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    kind: { type: String, enum: KINDS, required: true },
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    color: { type: String, default: '#6b7280' },
    description: { type: String, trim: true },
    order: { type: Number, default: 0 },
    // free-form extras: e.g. { isDone: true } for statuses, { startDate, endDate, goal } for sprints
    meta: { type: Schema.Types.Mixed, default: {} },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

taxonomySchema.index({ project: 1, kind: 1, key: 1 }, { unique: true });

module.exports = { Taxonomy: model('Taxonomy', taxonomySchema), KINDS };
