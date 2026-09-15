const { Schema, model } = require('mongoose');

// Multi-select task dimensions a saved filter can hold (mirrors the query
// params accepted by GET /tasks, see utils/taskQuery.js).
const FILTER_ARRAY_FIELDS = [
  'status',
  'priority',
  'type',
  'category',
  'techno',
  'version',
  'sprint',
  'area',
  'assignee',
  'labels',
  'statusCategory',
  'reporter',
  'parent',
];
const FILTER_DATE_FIELDS = ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'];
const VIEWS = ['grouped', 'jira', 'list'];
const VISIBILITIES = ['private', 'shared'];
const GROUP_KEYS = ['none', 'sprint', 'version', 'category', 'techno', 'area', 'type', 'priority', 'status', 'assignee'];
const SORT_KEYS = ['taskId', 'title', 'status', 'priority', 'version', 'sprint', 'complexity', 'assignee', 'updatedAt', 'createdAt', 'dueDate'];
const DATE_VALUE = /^(\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?([+-]\d{2}:?\d{2})?)?|-\d{1,4}[dwm]|@sprintStart|@sprintEnd|now)$/;

// A named board configuration (filters + view + grouping + sort) saved by a
// user for one project. Shared filters are visible to every project user;
// each user can star any visible filter and pick one as their default.
const savedFilterSchema = new Schema(
  {
    project: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, default: '' },
    filters: { type: Schema.Types.Mixed, default: {} },
    view: { type: String, enum: VIEWS, default: 'grouped' },
    groupBy: { type: String, enum: GROUP_KEYS, default: 'sprint' },
    sort: {
      key: { type: String, default: 'taskId' },
      dir: { type: Number, enum: [1, -1], default: 1 },
    },
    visibility: { type: String, enum: VISIBILITIES, default: 'private' },
    starredBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    defaultFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true, minimize: false }
);

savedFilterSchema.index({ project: 1, owner: 1, name: 1 }, { unique: true });

// Keep only known keys with string values so arbitrary client payloads never
// end up stored (or later spread into Mongo queries).
function sanitizeFilters(input) {
  const out = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const field of FILTER_ARRAY_FIELDS) {
    const v = src[field];
    const arr = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
    out[field] = [...new Set(arr.filter((x) => typeof x === 'string' && x.length <= 200))].slice(0, 200);
  }
  out.search = typeof src.search === 'string' ? src.search.slice(0, 200) : '';
  for (const field of FILTER_DATE_FIELDS) {
    const v = src[field];
    out[field] = typeof v === 'string' && DATE_VALUE.test(v) ? v : '';
  }
  return out;
}

module.exports = {
  SavedFilter: model('SavedFilter', savedFilterSchema),
  sanitizeFilters,
  FILTER_ARRAY_FIELDS,
  FILTER_DATE_FIELDS,
  VIEWS,
  VISIBILITIES,
  GROUP_KEYS,
  SORT_KEYS,
};
