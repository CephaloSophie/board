import { EMPTY_FILTERS, type BoardSort, type BoardView, type MultiFilterField, type SavedFilter, type TaskFilters } from '../types';
import { GROUP_OPTIONS, type GroupByKey } from '../components/Board/groupUtils';

// The whole board configuration lives in the URL query string so that any
// view can be bookmarked, shared as a link, or saved as a named filter:
//   ?view=list&groupBy=assignee&status=pending&status=onprocess&q=login&sort=priority:desc&filter=<savedId>
export interface BoardState {
  filters: TaskFilters;
  view: BoardView;
  groupBy: GroupByKey;
  sort: BoardSort;
}

export const DEFAULT_BOARD_STATE: BoardState = {
  filters: EMPTY_FILTERS,
  view: 'grouped',
  groupBy: 'sprint',
  sort: { key: 'taskId', dir: 1 },
};

const VIEWS: BoardView[] = ['grouped', 'jira', 'list'];
const GROUP_KEYS = GROUP_OPTIONS.map((o) => o.value);
export const MULTI_FILTER_FIELDS = (Object.keys(EMPTY_FILTERS) as (keyof TaskFilters)[]).filter(
  (k): k is MultiFilterField => k !== 'search'
);

function asView(v: unknown): BoardView {
  return VIEWS.includes(v as BoardView) ? (v as BoardView) : DEFAULT_BOARD_STATE.view;
}

function asGroupBy(v: unknown): GroupByKey {
  return GROUP_KEYS.includes(v as GroupByKey) ? (v as GroupByKey) : DEFAULT_BOARD_STATE.groupBy;
}

export function normalizeFilters(input: Partial<TaskFilters> | undefined): TaskFilters {
  const out = { ...EMPTY_FILTERS };
  for (const f of MULTI_FILTER_FIELDS) {
    const v = input?.[f];
    out[f] = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [];
  }
  out.search = typeof input?.search === 'string' ? input.search : '';
  return out;
}

export function boardStateFromParams(params: URLSearchParams): BoardState {
  const filters = { ...EMPTY_FILTERS };
  for (const f of MULTI_FILTER_FIELDS) filters[f] = params.getAll(f).filter(Boolean);
  filters.search = params.get('q') || '';
  const [sortKey, sortDir] = (params.get('sort') || '').split(':');
  return {
    filters,
    view: asView(params.get('view')),
    groupBy: asGroupBy(params.get('groupBy')),
    sort: sortKey ? { key: sortKey, dir: sortDir === 'desc' ? -1 : 1 } : DEFAULT_BOARD_STATE.sort,
  };
}

// Only non-default values are written, keeping URLs short and readable.
export function boardStateToParams(state: BoardState, filterId?: string | null): URLSearchParams {
  const p = new URLSearchParams();
  if (filterId) p.set('filter', filterId);
  if (state.view !== DEFAULT_BOARD_STATE.view) p.set('view', state.view);
  if (state.groupBy !== DEFAULT_BOARD_STATE.groupBy) p.set('groupBy', state.groupBy);
  const s = state.sort;
  if (s.key !== DEFAULT_BOARD_STATE.sort.key || s.dir !== DEFAULT_BOARD_STATE.sort.dir) {
    p.set('sort', `${s.key}:${s.dir === -1 ? 'desc' : 'asc'}`);
  }
  for (const f of MULTI_FILTER_FIELDS) state.filters[f].forEach((v) => p.append(f, v));
  if (state.filters.search) p.set('q', state.filters.search);
  return p;
}

export function boardStateOf(filter: SavedFilter): BoardState {
  return {
    filters: normalizeFilters(filter.filters),
    view: asView(filter.view),
    groupBy: asGroupBy(filter.groupBy),
    sort: filter.sort?.key ? { key: filter.sort.key, dir: filter.sort.dir === -1 ? -1 : 1 } : DEFAULT_BOARD_STATE.sort,
  };
}

// Order-insensitive comparison (chip toggling order must not mark a filter dirty).
export function isSameBoardState(a: BoardState, b: BoardState): boolean {
  const canon = (s: BoardState) => {
    const filters: Record<string, string[] | string> = { search: s.filters.search.trim() };
    for (const f of MULTI_FILTER_FIELDS) filters[f] = [...s.filters[f]].sort();
    return JSON.stringify({ view: s.view, groupBy: s.groupBy, sort: s.sort, filters });
  };
  return canon(a) === canon(b);
}

export function countActiveFilters(filters: TaskFilters): number {
  return MULTI_FILTER_FIELDS.reduce((n, f) => n + (filters[f].length ? 1 : 0), 0) + (filters.search.trim() ? 1 : 0);
}
