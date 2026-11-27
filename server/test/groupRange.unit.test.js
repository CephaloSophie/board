// Pure unit tests (no database): saved filter group range sanitization.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeGroupRange } = require('../src/models/SavedFilter');

test('group range: null / non-objects mean "no range"', () => {
  assert.equal(sanitizeGroupRange(undefined), null);
  assert.equal(sanitizeGroupRange('from'), null);
  assert.equal(sanitizeGroupRange([1, 2]), null);
});

test('group range: only known keys, bounded limits, unique string statuses', () => {
  const r = sanitizeGroupRange({
    mode: 'until',
    ref: '  s-12 ',
    before: '3',
    after: -1,
    keep: ['todo', 'todo', { $ne: 1 }, 'x'.repeat(201), 'doing'],
    showNone: 0,
    $where: 'evil',
  });
  assert.deepEqual(r, { mode: 'until', ref: 's-12', before: 3, after: null, keep: ['todo', 'doing'], keepSide: 'before', showNone: true });
  assert.equal(sanitizeGroupRange({ mode: '$gt', before: 1e6 }).mode, 'all');
  assert.equal(sanitizeGroupRange({ before: 1e6 }).before, 999);
  assert.equal(sanitizeGroupRange({ showNone: false }).showNone, false);
  assert.equal(sanitizeGroupRange({ keepSide: 'both' }).keepSide, 'both');
  assert.equal(sanitizeGroupRange({ keepSide: '$gt' }).keepSide, 'before');
  assert.equal(sanitizeGroupRange({ ref: '' }).ref, '@current');
});
