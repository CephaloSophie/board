// Pure helpers for wheel scroll chaining (status column → board / page).
// Tested by scrollChain.test.ts; the DOM side lives in hooks/useWheelChaining.ts.

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

// Sub-pixel scroll positions (zoom, HiDPI) never reach the exact bound.
const EPSILON = 1;

/** True when the element can still scroll vertically in the direction of deltaY. */
export function canScrollVertically(m: ScrollMetrics, deltaY: number): boolean {
  if (deltaY === 0) return false;
  const max = m.scrollHeight - m.clientHeight;
  if (max <= EPSILON) return false;
  return deltaY < 0 ? m.scrollTop > EPSILON : m.scrollTop < max - EPSILON;
}

// WheelEvent.deltaMode: 0 = pixels, 1 = lines, 2 = pages.
export const LINE_HEIGHT_PX = 16;

/** Wheel delta converted to pixels. */
export function wheelDeltaPx(delta: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * pageHeight;
  return delta;
}

/**
 * Whether a wheel event over a column should be forwarded to the outer scroll
 * container: mostly vertical (horizontal scrolling and shift+wheel stay native),
 * not a pinch-zoom (ctrlKey), and the column has no room left in that direction.
 */
export function shouldChainWheel(
  e: { deltaX: number; deltaY: number; ctrlKey: boolean; shiftKey: boolean },
  column: ScrollMetrics
): boolean {
  if (e.ctrlKey || e.shiftKey) return false;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return false;
  return !canScrollVertically(column, e.deltaY);
}
