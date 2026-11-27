import { useEffect, type RefObject } from 'react';
import { shouldChainWheel, wheelDeltaPx, canScrollVertically } from '../utils/scrollChain';

const isScrollableY = (el: Element) => {
  const { overflowY } = getComputedStyle(el);
  return (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && el.scrollHeight > el.clientHeight + 1;
};

// Nearest ancestor that actually scrolls vertically, else the page itself.
function scrollParentOf(el: Element): Element {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (isScrollableY(p)) return p;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * Wheel scroll chaining for the board's status columns (`selector`, fixed lane
 * height): while a column has room it scrolls natively; once it reaches its
 * top / bottom, the remaining wheel deltas scroll the board / page instead of
 * being swallowed. Browsers latch a wheel gesture (trackpad, fast mouse wheel)
 * on the column where it started, so CSS chaining alone would only resume
 * after a pause. Horizontal scrolling, shift+wheel and pinch-zoom stay native;
 * drag & drop autoscroll (pointer based) is untouched.
 */
// `rebindKey`: change it when the ref moves to another element (e.g. layout switch).
export function useWheelChaining(containerRef: RefObject<HTMLElement>, rebindKey?: unknown, selector = '.col__body') {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      const column = (e.target as Element | null)?.closest?.(selector);
      if (!column || !container.contains(column)) return;
      // A column without overflow already lets the browser chain natively.
      if (column.scrollHeight <= column.clientHeight + 1) return;
      if (!shouldChainWheel(e, column)) return;
      const outer = scrollParentOf(column);
      const dy = wheelDeltaPx(e.deltaY, e.deltaMode, outer.clientHeight || window.innerHeight);
      // Outer container at its own limit too: let the browser do its usual overscroll.
      if (!canScrollVertically(outer, dy)) return;
      e.preventDefault();
      outer.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
    };
    // Non-passive: preventDefault is needed to stop the latched column from eating the delta.
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [containerRef, rebindKey, selector]);
}
