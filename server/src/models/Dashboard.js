const { Schema, model } = require('mongoose');

// A user's configurable dashboard for one project: 12-column grid of widgets,
// optional global filter inherited by widgets, private or shared.
const widgetSchema = new Schema(
  {
    id: { type: String, required: true },
    type: { type: String, required: true },
    title: { type: String, trim: true, maxlength: 80, default: '' },
    layout: {
      x: { type: Number, min: 0, max: 11, required: true },
      y: { type: Number, min: 0, required: true },
      w: { type: Number, min: 1, max: 12, required: true },
      h: { type: Number, min: 1, max: 12, required: true },
    },
    source: {
      mode: { type: String, enum: ['global', 'filter', 'inline', 'none'], default: 'global' },
      filterId: { type: String, default: null },
      filters: { type: Schema.Types.Mixed, default: {} },
    },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false, minimize: false }
);

const dashboardSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, default: '' },
    visibility: { type: String, enum: ['private', 'shared'], default: 'private' },
    globalFilters: { type: Schema.Types.Mixed, default: {} },
    widgets: { type: [widgetSchema], default: [] },
    starredBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    defaultFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    revision: { type: Number, default: 1 }, // optimistic concurrency
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, minimize: false }
);

dashboardSchema.index({ project: 1, owner: 1, name: 1 }, { unique: true });

module.exports = { Dashboard: model('Dashboard', dashboardSchema) };
