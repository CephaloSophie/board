// Run with `npm test` (node:test, native TypeScript type stripping — Node ≥ 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import { canScrollVertically, shouldChainWheel, wheelDeltaPx } from './scrollChain.ts';

const col = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({ scrollTop, scrollHeight, clientHeight });
const wheel = (deltaY: number, deltaX = 0, extra: Partial<{ ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  deltaX,
  deltaY,
  ctrlKey: false,
  shiftKey: false,
  ...extra,
});

test('a column with room keeps the wheel', () => {
  assert.equal(canScrollVertically(col(100), 50), true);
  assert.equal(canScrollVertically(col(100), -50), true);
  assert.equal(shouldChainWheel(wheel(50), col(100)), false);
});

test('at the bottom (or top) the wheel goes on to the board', () => {
  assert.equal(shouldChainWheel(wheel(50), col(600)), true);
  assert.equal(shouldChainWheel(wheel(50), col(599.5)), true, 'sub-pixel bottom');
  assert.equal(shouldChainWheel(wheel(-50), col(0)), true);
  // …but scrolling back into the column stays in the column.
  assert.equal(shouldChainWheel(wheel(-50), col(600)), false);
  assert.equal(shouldChainWheel(wheel(50), col(0)), false);
});

test('a column without overflow always chains', () => {
  assert.equal(shouldChainWheel(wheel(30), col(0, 300, 400)), true);
  assert.equal(shouldChainWheel(wheel(-30), col(0, 400, 400)), true);
});

test('horizontal scrolling, shift+wheel and pinch-zoom stay native', () => {
  assert.equal(shouldChainWheel(wheel(5, 40), col(600)), false);
  assert.equal(shouldChainWheel(wheel(50, 0, { shiftKey: true }), col(600)), false);
  assert.equal(shouldChainWheel(wheel(50, 0, { ctrlKey: true }), col(600)), false);
  assert.equal(shouldChainWheel(wheel(0), col(600)), false);
});

test('line and page deltas are converted to pixels', () => {
  assert.equal(wheelDeltaPx(3, 0, 800), 3);
  assert.equal(wheelDeltaPx(3, 1, 800), 48);
  assert.equal(wheelDeltaPx(-1, 2, 800), -800);
});
