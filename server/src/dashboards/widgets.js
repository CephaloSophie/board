const crypto = require('crypto');
const { sanitizeFilters } = require('../models/SavedFilter');
const { httpError } = require('../utils/httpError');

// Widget catalogue: default/min size (grid units on 12 columns) and typed config.
const METRICS = ['count', 'points', 'hours'];
const DIMENSIONS = ['status', 'statusCategory', 'priority', 'type', 'category', 'techno', 'area', 'version', 'sprint', 'assignee', 'reporter', 'labels'];
const SOURCE_MODES = ['global', 'filter', 'inline', 'none'];

const enumOf = (list, def) => (v) => (list.includes(v) ? v : def);
const intOf = (min, max, def) => (v) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Math.round(Number(v)), min), max) : def);
const strOf = (def, max = 200) => (v) => (typeof v === 'string' ? v.slice(0, max) : def);
const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const boolOf = (def) => (v) => (typeof v === 'boolean' ? v : def);

const REGISTRY = {
  kpi: { size: [3, 2], min: [2, 2], config: { metric: enumOf([...METRICS, 'openBugs'], 'count'), suffix: strOf('', 20) } },
  breakdown: {
    size: [4, 4],
    min: [3, 3],
    config: {
      groupBy: enumOf(DIMENSIONS, 'status'),
      splitBy: (v) => (DIMENSIONS.includes(v) ? v : null),
      metric: enumOf(METRICS, 'count'),
      chart: enumOf(['bar', 'hbar', 'donut', 'table'], 'bar'),
      topN: intOf(1, 50, 12),
    },
  },
  matrix: {
    size: [6, 4],
    min: [4, 3],
    config: { rows: enumOf(DIMENSIONS, 'assignee'), cols: enumOf(DIMENSIONS, 'statusCategory'), metric: enumOf(METRICS, 'count') },
  },
  sprintBurndown: {
    size: [6, 4],
    min: [4, 3],
    source: 'none',
    config: { sprint: strOf('@current', 120), unit: enumOf(['points', 'count'], 'points'), mode: enumOf(['burndown', 'burnup'], 'burndown'), showIdeal: boolOf(true) },
  },
  velocity: { size: [6, 4], min: [4, 3], source: 'none', config: { last: intOf(1, 20, 6), unit: enumOf(['points', 'count'], 'points') } },
  workload: { size: [4, 4], min: [3, 3], config: { metric: enumOf(METRICS, 'points'), capacityPerUser: numOrNull, includeUnassigned: boolOf(true) } },
  taskList: {
    size: [6, 5],
    min: [4, 3],
    config: { sort: enumOf(['updatedAt:desc', 'priority:asc', 'dueDate:asc', 'taskId:asc', 'complexity:desc', 'createdAt:desc'], 'updatedAt:desc'), limit: intOf(1, 100, 20) },
  },
  recentActivity: { size: [4, 5], min: [3, 3], config: { limit: intOf(1, 50, 20) } },
  sprintSummary: { size: [4, 3], min: [3, 2], source: 'none', config: { sprint: strOf('@current', 120) } },
  note: { size: [4, 2], min: [2, 1], source: 'none', config: { text: strOf('', 5000) } },
};

function sanitizeWidget(input) {
  const def = REGISTRY[input?.type];
  if (!def) throw httpError(400, 'WIDGET_TYPE_UNKNOWN', `Type de widget inconnu : ${input?.type}.`);
  const [dw, dh] = def.size;
  const [mw, mh] = def.min;
  const w = intOf(mw, 12, dw)(input.layout?.w);
  const h = intOf(mh, 12, dh)(input.layout?.h);
  const layout = { x: intOf(0, 12 - w, 0)(input.layout?.x), y: intOf(0, 1000, 0)(input.layout?.y), w, h };
  const mode = SOURCE_MODES.includes(input.source?.mode) ? input.source.mode : def.source || 'global';
  const filterId = /^[a-f0-9]{24}$/i.test(String(input.source?.filterId || '')) ? String(input.source.filterId) : null;
  const config = {};
  for (const [key, parse] of Object.entries(def.config)) config[key] = parse(input.config?.[key]);
  return {
    id: String(input.id || crypto.randomUUID()).slice(0, 64),
    type: input.type,
    title: typeof input.title === 'string' ? input.title.slice(0, 80) : '',
    layout,
    source: {
      mode: mode === 'filter' && !filterId ? 'global' : mode,
      filterId: mode === 'filter' ? filterId : null,
      filters: mode === 'inline' ? sanitizeFilters(input.source?.filters) : {},
    },
    config,
  };
}

function sanitizeWidgets(list) {
  if (!Array.isArray(list)) throw httpError(400, 'WIDGETS_INVALID', 'widgets doit être un tableau.');
  if (list.length > 30) throw httpError(400, 'TOO_MANY_WIDGETS', '30 widgets maximum par dashboard.');
  const widgets = list.map(sanitizeWidget);
  const ids = new Set();
  for (const w of widgets) {
    if (ids.has(w.id)) w.id = crypto.randomUUID();
    ids.add(w.id);
  }
  return widgets;
}

// Ready-made dashboards (x, y, w, h).
const w = (type, [x, y, wd, ht], title, config = {}, source) => ({ type, title, layout: { x, y, w: wd, h: ht }, config, source });
const OPEN = ['todo', 'inprogress'];
const TEMPLATES = {
  blank: { globalFilters: {}, widgets: [] },
  sprint: {
    globalFilters: { sprint: ['@current'] },
    widgets: [
      w('sprintSummary', [0, 0, 4, 4], 'Sprint en cours'),
      w('sprintBurndown', [4, 0, 8, 4], 'Burndown du sprint'),
      w('workload', [0, 4, 4, 4], 'Charge par assigné'),
      w('breakdown', [4, 4, 4, 4], 'Répartition par avancement', { groupBy: 'statusCategory', chart: 'donut' }),
      w('taskList', [8, 4, 4, 4], 'Bloquants ouverts', { sort: 'priority:asc', limit: 10 }, { mode: 'inline', filters: { priority: ['P0', 'P1'], statusCategory: OPEN } }),
    ],
  },
  po: {
    globalFilters: {},
    widgets: [
      w('kpi', [0, 0, 3, 2], 'Points restants', { metric: 'points' }, { mode: 'inline', filters: { statusCategory: OPEN } }),
      w('kpi', [3, 0, 3, 2], 'Bugs ouverts', { metric: 'openBugs' }),
      w('kpi', [6, 0, 3, 2], 'Tâches terminées', { metric: 'count' }, { mode: 'inline', filters: { statusCategory: ['done'] } }),
      w('kpi', [9, 0, 3, 2], 'Backlog (sans sprint)', { metric: 'count' }, { mode: 'inline', filters: { sprint: ['@none'], statusCategory: OPEN } }),
      w('velocity', [0, 2, 6, 4], 'Vélocité'),
      w('breakdown', [6, 2, 6, 4], 'Avancement par version', { groupBy: 'version', splitBy: 'statusCategory', metric: 'points', chart: 'hbar' }),
      w('breakdown', [0, 6, 4, 4], 'Par type', { groupBy: 'type', chart: 'donut' }),
      w('matrix', [4, 6, 8, 4], 'Priorité × avancement', { rows: 'priority', cols: 'statusCategory' }),
      w('recentActivity', [0, 10, 12, 4], 'Activité récente'),
    ],
  },
  dev: {
    globalFilters: {},
    widgets: [
      w('taskList', [0, 0, 8, 5], 'Mes tâches ouvertes', { sort: 'priority:asc' }, { mode: 'inline', filters: { assignee: ['@me'], statusCategory: OPEN } }),
      w('kpi', [8, 0, 4, 2], 'Mes points restants', { metric: 'points' }, { mode: 'inline', filters: { assignee: ['@me'], statusCategory: OPEN } }),
      w('sprintSummary', [8, 2, 4, 3], 'Sprint en cours'),
      w('recentActivity', [0, 5, 12, 4], 'Mon activité', {}, { mode: 'inline', filters: { assignee: ['@me'] } }),
    ],
  },
};

module.exports = { REGISTRY, TEMPLATES, METRICS, DIMENSIONS, sanitizeWidget, sanitizeWidgets };
