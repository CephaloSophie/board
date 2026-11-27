// Run with `npm test` (node:test, native TypeScript type stripping — Node ≥ 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TaxonomyItem } from '../types';
import {
  DEFAULT_GROUP_RANGE,
  applyGroupRange,
  isGroupRangeActive,
  isOrderedDimension,
  isSameGroupRange,
  normalizeGroupRange,
  orderDimensionValues,
  rangeWindow,
  resolveRangeRef,
  type GroupRange,
} from './groupRange.ts';

const NONE = '__ungrouped__';

const item = (kind: string, key: string, order: number, meta: Record<string, unknown> = {}): TaxonomyItem =>
  ({ _id: key, project: 'p', kind, key, label: key.toUpperCase(), order, meta, archived: false }) as TaxonomyItem;

// s1..s5 in chronological order, deliberately shuffled taxonomy order.
const sprints = [
  item('sprint', 's3', 0, { status: 'active', startDate: '2026-03-01' }),
  item('sprint', 's5', 1, { status: 'draft' }),
  item('sprint', 's1', 2, { status: 'finished', startDate: '2026-01-01' }),
  item('sprint', 's4', 3, { status: 'ready', startDate: '2026-04-01' }),
  item('sprint', 's2', 4, { status: 'finished', startDate: '2026-02-01' }),
];
const order = ['s1', 's2', 's3', 's4', 's5'];

const task = (status: string) => ({ status });
const group = (key: string, ...statuses: string[]) => ({ key, tasks: statuses.map(task) });
const groups = () => [
  group('s1', 'done', 'todo'),
  group('s2', 'done'),
  group('s3', 'todo', 'doing'),
  group('s4', 'todo'),
  group('s5', 'todo'),
  group(NONE, 'todo'),
];
const range = (patch: Partial<GroupRange>): GroupRange => ({ ...DEFAULT_GROUP_RANGE, ...patch });
const run = (r: GroupRange, refKey: string | null = 's3') =>
  applyGroupRange(groups(), { order, refKey, range: r, noneKey: NONE, ordered: true });
const keys = (res: ReturnType<typeof run>) => res.groups.map((g) => g.key);

test('sprints are ordered by lifecycle then dates, whatever the taxonomy order', () => {
  assert.deepEqual(orderDimensionValues('sprint', sprints).map((s) => s.key), order);
});

test('versions follow semantic versioning, non-numeric keys last', () => {
  const versions = [
    item('version', '10.10.0', 0),
    item('version', 'backlog', 1),
    item('version', '10.2.0', 2),
    item('version', '9.0.1', 3),
  ];
  assert.deepEqual(orderDimensionValues('version', versions).map((v) => v.key), ['9.0.1', '10.2.0', '10.10.0', 'backlog']);
});

test('priority / status use the taxonomy order; other dimensions are not ordered', () => {
  const prio = [item('priority', 'low', 2), item('priority', 'high', 0), item('priority', 'mid', 1)];
  assert.deepEqual(orderDimensionValues('priority', prio).map((p) => p.key), ['high', 'mid', 'low']);
  assert.equal(isOrderedDimension('sprint'), true);
  assert.equal(isOrderedDimension('status'), true);
  assert.equal(isOrderedDimension('category'), false);
  assert.equal(isOrderedDimension('assignee'), false);
});

test('"@current" resolves to the project current sprint, else the active one, and to the current version', () => {
  const ordered = orderDimensionValues('sprint', sprints);
  assert.equal(resolveRangeRef('sprint', '@current', ordered, { currentSprint: 's4' }), 's4');
  assert.equal(resolveRangeRef('sprint', '@current', ordered, {}), 's3');
  assert.equal(resolveRangeRef('sprint', 's2', ordered), 's2');
  assert.equal(resolveRangeRef('sprint', 'deleted', ordered), null);
  const versions = [item('version', '1.0.0', 0), item('version', '1.1.0', 1)];
  assert.equal(resolveRangeRef('version', '@current', versions, { currentVersion: '1.1.0' }), '1.1.0');
  assert.equal(resolveRangeRef('priority', '@current', [item('priority', 'high', 0)]), null);
});

test('mode "all" keeps every group (current behaviour)', () => {
  const res = run(DEFAULT_GROUP_RANGE);
  assert.deepEqual(keys(res), ['s1', 's2', 's3', 's4', 's5', NONE]);
  assert.equal(res.applied, false);
  assert.equal(res.hiddenGroups, 0);
});

test('"reference and later" hides older groups; "max after" paginates', () => {
  assert.deepEqual(keys(run(range({ mode: 'from' }))), ['s3', 's4', 's5', NONE]);
  const res = run(range({ mode: 'from', after: 1 }));
  assert.deepEqual(keys(res), ['s3', 's4', NONE]);
  assert.equal(res.hiddenGroups, 3);
  assert.equal(res.hiddenTasks, 4);
});

test('"reference and earlier" hides newer groups; "max before" paginates', () => {
  assert.deepEqual(keys(run(range({ mode: 'until' }))), ['s1', 's2', 's3', NONE]);
  assert.deepEqual(keys(run(range({ mode: 'until', before: 1 }))), ['s2', 's3', NONE]);
  // "after" is meaningless in "until" mode.
  assert.deepEqual(keys(run(range({ mode: 'until', before: 1, after: 3 }))), ['s2', 's3', NONE]);
});

test('"around" keeps a window on both sides', () => {
  assert.deepEqual(keys(run(range({ mode: 'around', before: 1, after: 1 }))), ['s2', 's3', 's4', NONE]);
  assert.deepEqual(keys(run(range({ mode: 'around', before: 0, after: null }))), ['s3', 's4', 's5', NONE]);
  assert.deepEqual(rangeWindow(range({ mode: 'around', before: 2, after: 0 }), 5), { lo: 3, hi: 5 });
});

test('exceptions keep out-of-range groups with only their tasks in the selected statuses', () => {
  const res = run(range({ mode: 'from', keep: ['todo'] }));
  assert.deepEqual(keys(res), ['s1', 's3', 's4', 's5', NONE]);
  const s1 = res.groups.find((g) => g.key === 's1')!;
  assert.equal(s1.outOfRange, true);
  assert.equal(s1.hiddenCount, 1);
  assert.deepEqual(s1.tasks.map((t) => t.status), ['todo']);
  // In-range groups are untouched and not flagged.
  const s3 = res.groups.find((g) => g.key === 's3')!;
  assert.equal(s3.outOfRange, undefined);
  assert.equal(s3.tasks.length, 2);
  // s2 (only done tasks) stays hidden.
  assert.equal(res.hiddenGroups, 1);
  assert.equal(res.hiddenTasks, 2);
});

test('exceptions apply to older groups by default, newer or both on demand', () => {
  // s5 (after the window) has a todo task too: not kept with the default side.
  const before = run(range({ mode: 'from', after: 1, keep: ['todo'] }));
  assert.deepEqual(keys(before), ['s1', 's3', 's4', NONE]);
  const after = run(range({ mode: 'from', after: 1, keep: ['todo'], keepSide: 'after' }));
  assert.deepEqual(keys(after), ['s3', 's4', 's5', NONE]);
  const both = run(range({ mode: 'from', after: 1, keep: ['todo'], keepSide: 'both' }));
  assert.deepEqual(keys(both), ['s1', 's3', 's4', 's5', NONE]);
  assert.deepEqual(both.groups.filter((g) => g.outOfRange).map((g) => g.key), ['s1', 's5']);
  // "until" hides newer groups: their leftovers need keepSide after / both.
  assert.deepEqual(keys(run(range({ mode: 'until', keep: ['todo'], keepSide: 'after' }))), ['s1', 's2', 's3', 's4', 's5', NONE]);
});

test('values unknown to the taxonomy are out of range (exceptions still apply)', () => {
  const list = [group('ghost', 'todo'), group('s3', 'todo')];
  const opts = { order, refKey: 's3', noneKey: NONE, ordered: true };
  assert.deepEqual(applyGroupRange(list, { ...opts, range: range({ mode: 'from' }) }).groups.map((g) => g.key), ['s3']);
  const kept = applyGroupRange(list, { ...opts, range: range({ mode: 'from', keep: ['todo'] }) });
  assert.deepEqual(kept.groups.map((g) => [g.key, !!g.outOfRange]), [['ghost', true], ['s3', false]]);
});

test('an unresolvable reference applies no range and reports it', () => {
  const res = run(range({ mode: 'from' }), null);
  assert.deepEqual(keys(res), ['s1', 's2', 's3', 's4', 's5', NONE]);
  assert.equal(res.refMissing, true);
  assert.equal(res.applied, false);
});

test('the "no value" group follows showNone, even for unordered dimensions', () => {
  const res = applyGroupRange(groups(), { order: [], refKey: null, range: range({ showNone: false }), noneKey: NONE, ordered: false });
  assert.equal(res.groups.some((g) => g.key === NONE), false);
  assert.equal(res.hiddenTasks, 1);
  // A range on an unordered dimension is ignored without complaint.
  const unordered = applyGroupRange(groups(), { order: [], refKey: null, range: range({ mode: 'from' }), noneKey: NONE, ordered: false });
  assert.equal(unordered.groups.length, 6);
  assert.equal(unordered.refMissing, false);
});

test('normalizeGroupRange sanitizes untrusted input', () => {
  assert.deepEqual(normalizeGroupRange(undefined), DEFAULT_GROUP_RANGE);
  assert.deepEqual(
    normalizeGroupRange({ mode: 'from', ref: ' s2 ', before: '-3', after: '2.7', keep: ['todo', 'todo', 3, ''], showNone: false }),
    { mode: 'from', ref: 's2', before: null, after: 2, keep: ['todo'], keepSide: 'before', showNone: false }
  );
  assert.equal(normalizeGroupRange({ keepSide: 'both' }).keepSide, 'both');
  assert.equal(normalizeGroupRange({ keepSide: 'up' }).keepSide, 'before');
  assert.equal(normalizeGroupRange({ mode: 'evil', after: 1e9 }).mode, 'all');
  assert.equal(normalizeGroupRange({ after: 1e9 }).after, 999);
});

test('active flag and comparison ignore settings without effect', () => {
  assert.equal(isGroupRangeActive(DEFAULT_GROUP_RANGE), false);
  assert.equal(isGroupRangeActive(range({ mode: 'from' })), true);
  assert.equal(isGroupRangeActive(range({ showNone: false })), true);
  assert.equal(isSameGroupRange(DEFAULT_GROUP_RANGE, range({ after: 3, keep: ['x'] })), true);
  assert.equal(isSameGroupRange(range({ mode: 'from', after: 2 }), range({ mode: 'from', after: 2, before: 5 })), true);
  assert.equal(isSameGroupRange(range({ mode: 'from', keep: ['a', 'b'] }), range({ mode: 'from', keep: ['b', 'a'] })), true);
  assert.equal(isSameGroupRange(range({ mode: 'from', after: 2 }), range({ mode: 'from', after: 3 })), false);
  assert.equal(isSameGroupRange(range({ mode: 'from' }), range({ mode: 'from', keepSide: 'both' })), true, 'side without statuses');
  assert.equal(isSameGroupRange(range({ mode: 'from', keep: ['a'] }), range({ mode: 'from', keep: ['a'], keepSide: 'both' })), false);
});
