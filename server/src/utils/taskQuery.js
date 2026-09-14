const { Types } = require('mongoose');
const { Taxonomy } = require('../models/Taxonomy');
const { statusCategoryOf, STATUS_CATEGORIES } = require('./taxonomyMeta');

// Task filter grammar shared by GET /tasks, saved filters, dashboards and exports.
const ARRAY_FIELDS = [
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
const DATE_FIELDS = ['createdFrom', 'createdTo', 'updatedFrom', 'updatedTo'];
const SORT_FIELDS = [
  'taskId',
  'title',
  'status',
  'priority',
  'version',
  'sprint',
  'complexity',
  'assignee',
  'updatedAt',
  'createdAt',
  'dueDate',
  'resolvedAt',
];
const SUMMARY_PROJECTION = '-comments -history -instructions -acceptance -spec';
const RELATIVE_DATE = /^-(\d{1,4})([dwm])$/;
const SEARCH_FIELDS = ['taskId', 'title', 'module', 'description', 'instructions', 'acceptance', 'labels', 'external.key'];

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  // Legacy comma-separated single value (?status=a,b).
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseTaskQueryParams(query = {}) {
  const filters = {};
  for (const f of ARRAY_FIELDS) filters[f] = toArray(query[f]);
  filters.search = String(query.search ?? query.q ?? '').trim();
  for (const f of DATE_FIELDS) filters[f] = typeof query[f] === 'string' ? query[f] : '';
  return filters;
}

// Explicit request params win over a saved filter, field by field.
function overlayFilters(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (Array.isArray(v) ? v.length : v) out[k] = v;
  }
  return out;
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function resolveDate(value, { project, sprints }, warnings) {
  if (!value) return null;
  if (value === 'now') return new Date();
  const rel = RELATIVE_DATE.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const days = rel[2] === 'd' ? n : rel[2] === 'w' ? n * 7 : n * 30;
    return new Date(Date.now() - days * 86400000);
  }
  if (value === '@sprintStart' || value === '@sprintEnd') {
    const current = sprints.find((s) => s.key === project.currentSprint);
    const d = current?.meta?.[value === '@sprintStart' ? 'startDate' : 'endDate'];
    if (!d) {
      warnings.push('NO_CURRENT_SPRINT');
      return null;
    }
    return new Date(d);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    warnings.push('DATE_UNPARSED');
    return null;
  }
  return d;
}

/**
 * Compiles a filter object (see ARRAY_FIELDS / DATE_FIELDS / search) into a
 * Mongo match for one project, resolving dynamic tokens:
 *   assignee/reporter: @me, unassigned | sprint: @current, @open, @none |
 *   version: @current, @unreleased, @none | statusCategory: todo|inprogress|done |
 *   dates: ISO, -7d / -2w / -1m, @sprintStart / @sprintEnd, now
 */
async function compileTaskQuery(filters = {}, ctx) {
  const { project, user } = ctx;
  const warnings = [];
  const taxonomies = ctx.taxonomies || (await Taxonomy.find({ project: project._id }).lean());
  const ofKind = (kind) => taxonomies.filter((t) => t.kind === kind);
  const values = (f) => toArray(filters[f]);
  const match = { project: project._id };

  for (const field of ['priority', 'type', 'category', 'techno', 'area', 'labels']) {
    const v = values(field);
    if (v.length) match[field] = { $in: v };
  }
  const parents = values('parent');
  if (parents.length) match.parent = { $in: parents.map((p) => (p === '@none' ? null : p)) };

  let statusKeys = values('status').length ? new Set(values('status')) : null;
  const categories = values('statusCategory').filter((c) => STATUS_CATEGORIES.includes(c));
  if (categories.length) {
    const inCategories = ofKind('status')
      .filter((s) => categories.includes(statusCategoryOf(s)))
      .map((s) => s.key);
    statusKeys = statusKeys ? new Set(inCategories.filter((k) => statusKeys.has(k))) : new Set(inCategories);
  }
  if (statusKeys) match.status = { $in: [...statusKeys] };

  const sprints = ofKind('sprint');
  const sprintValues = values('sprint');
  if (sprintValues.length) {
    const resolved = new Set();
    for (const v of sprintValues) {
      if (v === '@current') {
        if (project.currentSprint) resolved.add(project.currentSprint);
        else warnings.push('NO_CURRENT_SPRINT');
      } else if (v === '@open') {
        sprints
          .filter((s) => !s.archived && s.meta?.status !== 'finished')
          .forEach((s) => resolved.add(s.key));
      } else if (v === '@none') resolved.add(null);
      else resolved.add(v);
    }
    match.sprint = { $in: [...resolved] };
  }

  const versionValues = values('version');
  if (versionValues.length) {
    const resolved = new Set();
    for (const v of versionValues) {
      if (v === '@current') resolved.add(project.currentVersion);
      else if (v === '@unreleased') {
        ofKind('version')
          .filter((x) => !x.archived && x.meta?.status !== 'released')
          .forEach((x) => resolved.add(x.key));
      } else if (v === '@none') resolved.add(null);
      else resolved.add(v);
    }
    match.version = { $in: [...resolved] };
  }

  for (const field of ['assignee', 'reporter']) {
    const v = values(field);
    if (!v.length) continue;
    const ids = [];
    for (const x of v) {
      if (x === '@me') ids.push(user._id);
      else if (x === 'unassigned' || x === '@none') ids.push(null);
      else if (Types.ObjectId.isValid(x)) ids.push(new Types.ObjectId(x));
      else warnings.push('INVALID_USER');
    }
    match[field] = { $in: ids };
  }

  const dateCtx = { project, sprints };
  const range = (from, to) => {
    const r = {};
    const a = resolveDate(filters[from], dateCtx, warnings);
    const b = resolveDate(filters[to], dateCtx, warnings);
    if (a) r.$gte = a;
    if (b) r.$lte = b;
    return Object.keys(r).length ? r : null;
  };
  const created = range('createdFrom', 'createdTo');
  if (created) match.createdAt = created;
  const updated = range('updatedFrom', 'updatedTo');
  if (updated) match.updatedAt = updated;

  const search = String(filters.search || '').trim();
  if (search) {
    const rx = new RegExp(escapeRegExp(search.slice(0, 200)), 'i');
    match.$or = SEARCH_FIELDS.map((f) => ({ [f]: rx }));
  }

  return { match, warnings: [...new Set(warnings)] };
}

// "priority:desc" → { priority: -1, taskId: 1 }
function parseSort(value) {
  const [key, dir] = String(value || '').split(':');
  const field = SORT_FIELDS.includes(key) ? key : 'taskId';
  const direction = dir === 'desc' || dir === '-1' ? -1 : 1;
  return field === 'taskId' ? { taskId: direction } : { [field]: direction, taskId: 1 };
}

// Stable, comparable representation (sorted, deduplicated, empties removed).
function normalizeFilters(filters = {}) {
  const out = {};
  for (const f of ARRAY_FIELDS) {
    const v = [...new Set(toArray(filters[f]))].sort();
    if (v.length) out[f] = v;
  }
  const s = String(filters.search || '').trim();
  if (s) out.search = s;
  for (const f of DATE_FIELDS) if (filters[f]) out[f] = filters[f];
  return out;
}

module.exports = {
  ARRAY_FIELDS,
  DATE_FIELDS,
  SORT_FIELDS,
  SUMMARY_PROJECTION,
  RELATIVE_DATE,
  toArray,
  parseTaskQueryParams,
  overlayFilters,
  compileTaskQuery,
  parseSort,
  normalizeFilters,
};
