// Pure logic of the board "group range" filter (no React, no DOM): which groups
// of an ORDERED grouping dimension (sprint, version, priority, status) stay
// visible around a reference group, with "leftovers" exceptions.
// Tested by groupRange.test.ts (`npm test`).
import type { SprintMeta, TaxonomyItem, VersionMeta } from '../types';
import { compareVersions } from './versions.ts';

/**
 * - all: no range (default, every group visible)
 * - from: the reference and the groups after it ("actuel et suivants")
 * - until: the reference and the groups before it ("actuel et précédents")
 * - around: a window on both sides of the reference
 */
export type GroupRangeMode = 'all' | 'from' | 'until' | 'around';

// Which out-of-range groups the status exceptions apply to: the older ones
// (default: the "leftovers" of past sprints / versions), the newer ones, or both.
export type GroupRangeKeepSide = 'before' | 'after' | 'both';

export interface GroupRange {
  mode: GroupRangeMode;
  // '@current' (current sprint / current version) or a value key of the grouped dimension.
  ref: string;
  // Max number of groups kept before / after the reference (null = unlimited).
  before: number | null;
  after: number | null;
  // Exceptions: an out-of-range group stays visible when it holds tasks in one
  // of these statuses, showing only those tasks (the "leftovers").
  keep: string[];
  keepSide: GroupRangeKeepSide;
  // Show the group of tasks without a value ("Backlog", "Sans version"…).
  showNone: boolean;
}

export const CURRENT_REF = '@current';
export const RANGE_MODES: GroupRangeMode[] = ['all', 'from', 'until', 'around'];
export const KEEP_SIDES: GroupRangeKeepSide[] = ['before', 'after', 'both'];
export const RANGE_LIMIT_MAX = 999;

export const DEFAULT_GROUP_RANGE: GroupRange = {
  mode: 'all',
  ref: CURRENT_REF,
  before: null,
  after: null,
  keep: [],
  keepSide: 'before',
  showNone: true,
};

// Grouping dimensions whose values have a natural order.
export const ORDERED_DIMENSIONS = ['sprint', 'version', 'priority', 'status'] as const;
export type OrderedDimension = (typeof ORDERED_DIMENSIONS)[number];

export function isOrderedDimension(groupBy: string): groupBy is OrderedDimension {
  return (ORDERED_DIMENSIONS as readonly string[]).includes(groupBy);
}

// Only sprints and versions have a "current" value.
export function hasCurrentRef(groupBy: string): boolean {
  return groupBy === 'sprint' || groupBy === 'version';
}

function asLimit(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(RANGE_LIMIT_MAX, Math.floor(n));
}

export function normalizeGroupRange(input: unknown): GroupRange {
  const src = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof GroupRange, unknown>>;
  const mode = RANGE_MODES.includes(src.mode as GroupRangeMode) ? (src.mode as GroupRangeMode) : 'all';
  const ref = typeof src.ref === 'string' && src.ref.trim() ? src.ref.trim().slice(0, 200) : CURRENT_REF;
  const keep = Array.isArray(src.keep)
    ? [...new Set(src.keep.filter((x): x is string => typeof x === 'string' && !!x && x.length <= 200))].slice(0, 50)
    : [];
  return {
    mode,
    ref,
    before: asLimit(src.before),
    after: asLimit(src.after),
    keep,
    keepSide: KEEP_SIDES.includes(src.keepSide as GroupRangeKeepSide) ? (src.keepSide as GroupRangeKeepSide) : 'before',
    showNone: src.showNone !== false,
  };
}

// True when the range changes what the board shows (used for the filter badge).
export function isGroupRangeActive(r: GroupRange): boolean {
  return r.mode !== 'all' || !r.showNone;
}

export function isSameGroupRange(a: GroupRange, b: GroupRange): boolean {
  const canon = (r: GroupRange) => {
    const n = normalizeGroupRange(r);
    // Settings that have no effect in the current mode do not make a filter "modified".
    if (n.mode === 'all') return JSON.stringify({ mode: 'all', showNone: n.showNone });
    return JSON.stringify({
      ...n,
      before: n.mode === 'from' ? 0 : n.before,
      after: n.mode === 'until' ? 0 : n.after,
      keep: [...n.keep].sort(),
      keepSide: n.keep.length ? n.keepSide : 'before',
    });
  };
  return canon(a) === canon(b);
}

// ---------- Ordering of the dimension values ----------

const SPRINT_RANK: Record<string, number> = { finished: 0, active: 1, ready: 2, draft: 3 };

function timeOf(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// Dated items first (ascending), undated after them.
function byDate(a: number | null, b: number | null): number {
  if (a !== null && b !== null) return a - b;
  if (a !== null) return -1;
  if (b !== null) return 1;
  return 0;
}

const naturalKey = (a: TaxonomyItem, b: TaxonomyItem) => a.key.localeCompare(b.key, undefined, { numeric: true });
const looksLikeVersion = (key: string) => /^v?\d/i.test(key);

/**
 * Chronological / natural order of a dimension's values, oldest (or first) first:
 * - sprint: lifecycle (finished → active → ready → draft), then start date
 *   (end date when missing; undated last), then taxonomy order;
 * - version: semantic version of the key ("10.2.0" < "10.10.0"); keys that are
 *   not version numbers come after, by release / start date then taxonomy order;
 * - other dimensions (priority, status): the taxonomy order set by the admins.
 * Archived values are kept: they can still hold tasks.
 */
export function orderDimensionValues(groupBy: string, items: TaxonomyItem[]): TaxonomyItem[] {
  const list = items.filter((i) => i.kind === groupBy);
  const byOrder = (a: TaxonomyItem, b: TaxonomyItem) => (a.order ?? 0) - (b.order ?? 0) || naturalKey(a, b);
  if (groupBy === 'sprint') {
    const meta = (i: TaxonomyItem) => (i.meta || {}) as SprintMeta;
    const rank = (i: TaxonomyItem) => SPRINT_RANK[meta(i).status || 'draft'] ?? 3;
    const date = (i: TaxonomyItem) => timeOf(meta(i).startDate) ?? timeOf(meta(i).endDate);
    return list.sort((a, b) => rank(a) - rank(b) || byDate(date(a), date(b)) || byOrder(a, b));
  }
  if (groupBy === 'version') {
    const meta = (i: TaxonomyItem) => (i.meta || {}) as VersionMeta;
    const date = (i: TaxonomyItem) => timeOf(meta(i).releaseDate) ?? timeOf(meta(i).releasedAt) ?? timeOf(meta(i).startDate);
    return list.sort((a, b) => {
      const va = looksLikeVersion(a.key);
      const vb = looksLikeVersion(b.key);
      if (va && vb) return compareVersions(a.key, b.key) || byOrder(a, b);
      if (va !== vb) return va ? -1 : 1;
      return byDate(date(a), date(b)) || byOrder(a, b);
    });
  }
  return list.sort(byOrder);
}

export interface RangeContext {
  currentSprint?: string | null;
  currentVersion?: string | null;
}

/** Key of the reference group, or null when it cannot be resolved. */
export function resolveRangeRef(groupBy: string, ref: string, ordered: TaxonomyItem[], ctx: RangeContext = {}): string | null {
  const keys = new Set(ordered.map((i) => i.key));
  if (ref !== CURRENT_REF) return keys.has(ref) ? ref : null;
  if (groupBy === 'sprint') {
    if (ctx.currentSprint && keys.has(ctx.currentSprint)) return ctx.currentSprint;
    const active = ordered.find((i) => (i.meta as SprintMeta | undefined)?.status === 'active');
    return active?.key ?? null;
  }
  if (groupBy === 'version') return ctx.currentVersion && keys.has(ctx.currentVersion) ? ctx.currentVersion : null;
  return null;
}

// ---------- Visible window ----------

export interface RangeGroupInfo {
  // Shown only because of the status exceptions ("hors plage").
  outOfRange?: boolean;
  // Tasks of that group hidden because they are not in an exception status.
  hiddenCount?: number;
}

export interface RangeResult<G> {
  groups: (G & RangeGroupInfo)[];
  hiddenGroups: number;
  hiddenTasks: number;
  // Range requested but its reference is unknown: no range applied.
  refMissing: boolean;
  // The range actually filtered groups (ordered dimension, reference found).
  applied: boolean;
}

export interface ApplyRangeOptions {
  // Value keys of the dimension in order (see orderDimensionValues).
  order: string[];
  // Resolved reference key (see resolveRangeRef).
  refKey: string | null;
  range: GroupRange;
  // Key of the "no value" group (always visible unless showNone is false).
  noneKey: string;
  // Whether the dimension is ordered (otherwise only showNone applies).
  ordered: boolean;
}

/** Inclusive window of positions [lo, hi] around the reference. */
export function rangeWindow(range: GroupRange, refIndex: number): { lo: number; hi: number } {
  const before = range.mode === 'from' ? 0 : range.mode === 'all' ? null : range.before;
  const after = range.mode === 'until' ? 0 : range.mode === 'all' ? null : range.after;
  return {
    lo: before === null ? -Infinity : refIndex - before,
    hi: after === null ? Infinity : refIndex + after,
  };
}

/**
 * Filters already-built board groups (any order) with the range:
 * - groups inside the window are kept untouched;
 * - groups outside it (or whose value is unknown to the taxonomy) are hidden,
 *   EXCEPT when they are on the `keepSide` of the window (unknown values: any
 *   side) and hold tasks in one of the `keep` statuses: they are then kept with
 *   only those tasks and flagged `outOfRange`;
 * - the "no value" group follows `showNone`.
 * Group order is preserved.
 */
export function applyGroupRange<T extends { status: string }, G extends { key: string; tasks: T[] }>(
  groups: G[],
  opts: ApplyRangeOptions
): RangeResult<G> {
  const { range, noneKey } = opts;
  let hiddenGroups = 0;
  let hiddenTasks = 0;
  const wantsRange = opts.ordered && range.mode !== 'all';
  const position = new Map(opts.order.map((k, i) => [k, i]));
  const refIndex = opts.refKey !== null && position.has(opts.refKey) ? position.get(opts.refKey)! : -1;
  const applied = wantsRange && refIndex >= 0;
  const { lo, hi } = applied ? rangeWindow(range, refIndex) : { lo: -Infinity, hi: Infinity };
  const keep = new Set(range.keep);

  const out: (G & RangeGroupInfo)[] = [];
  for (const g of groups) {
    if (g.key === noneKey) {
      if (range.showNone) out.push(g);
      else {
        hiddenGroups++;
        hiddenTasks += g.tasks.length;
      }
      continue;
    }
    if (!applied) {
      out.push(g);
      continue;
    }
    const pos = position.get(g.key);
    if (pos !== undefined && pos >= lo && pos <= hi) {
      out.push(g);
      continue;
    }
    const side = pos === undefined ? null : pos < lo ? 'before' : 'after';
    const eligible = keep.size > 0 && (side === null || range.keepSide === 'both' || range.keepSide === side);
    const leftovers = eligible ? g.tasks.filter((t) => keep.has(t.status)) : [];
    if (leftovers.length) {
      const hidden = g.tasks.length - leftovers.length;
      hiddenTasks += hidden;
      out.push({ ...g, tasks: leftovers, outOfRange: true, hiddenCount: hidden });
    } else {
      hiddenGroups++;
      hiddenTasks += g.tasks.length;
    }
  }
  return { groups: out, hiddenGroups, hiddenTasks, refMissing: wantsRange && refIndex < 0, applied };
}
