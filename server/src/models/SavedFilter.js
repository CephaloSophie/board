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
const GROUP_KEYS = ['none', 'sprint', 'version', 'category', 'techno', 'area', 'type', 'priority', 'status', 'assignee', 'parent'];
const SORT_KEYS = ['taskId', 'title', 'status', 'priority', 'version', 'sprint', 'complexity', 'assignee', 'updatedAt', 'createdAt', 'dueDate'];
const RANGE_MODES = ['all', 'from', 'until', 'around'];
const RANGE_KEEP_SIDES = ['before', 'after', 'both'];
const RANGE_LIMIT_MAX = 999;
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
    // Board "group range" (see client utils/groupRange.ts): groups of an ordered
    // dimension kept around a reference, with status exceptions. Always sanitized.
    groupRange: { type: Schema.Types.Mixed, default: null },
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

// Board group range: { mode, ref, before, after, keep[], keepSide, showNone } or null (= whole range).
function sanitizeGroupRange(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const limit = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(RANGE_LIMIT_MAX, Math.floor(n)) : null;
  };
  const keep = Array.isArray(input.keep) ? input.keep.filter((x) => typeof x === 'string' && x && x.length <= 200) : [];
  return {
    mode: RANGE_MODES.includes(input.mode) ? input.mode : 'all',
    ref: typeof input.ref === 'string' && input.ref.trim() ? input.ref.trim().slice(0, 200) : '@current',
    before: limit(input.before),
    after: limit(input.after),
    keep: [...new Set(keep)].slice(0, 50),
    keepSide: RANGE_KEEP_SIDES.includes(input.keepSide) ? input.keepSide : 'before',
    showNone: input.showNone !== false,
  };
}

module.exports = {
  SavedFilter: model('SavedFilter', savedFilterSchema),
  sanitizeFilters,
  sanitizeGroupRange,
  RANGE_MODES,
  FILTER_ARRAY_FIELDS,
  FILTER_DATE_FIELDS,
  VIEWS,
  VISIBILITIES,
  GROUP_KEYS,
  SORT_KEYS,
};
