import type { WidgetLayout } from '../../api/dashboards';

export const GRID_COLUMNS = 12;
export const ROW_HEIGHT = 80;
export const GRID_GAP = 12;

interface Placed {
  id: string;
  layout: WidgetLayout;
}

export const overlaps = (a: WidgetLayout, b: WidgetLayout) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The moved widget keeps its place; anything it covers is pushed below it, in cascade.
export function resolveCollisions<T extends Placed>(items: T[], movedId: string): T[] {
  const result = items.map((i) => ({ ...i, layout: { ...i.layout } }));
  const queue = result.filter((i) => i.id === movedId);
  while (queue.length) {
    const current = queue.shift()!;
    for (const other of result) {
      if (other.id === current.id || other.id === movedId) continue;
      if (overlaps(current.layout, other.layout)) {
        other.layout.y = current.layout.y + current.layout.h;
        queue.push(other);
      }
    }
  }
  return result;
}

// Vertical compaction: every widget moves up as far as it can without overlapping.
export function compact<T extends Placed>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const placed: T[] = [];
  for (const item of sorted) {
    const layout = { ...item.layout, x: Math.min(Math.max(item.layout.x, 0), GRID_COLUMNS - item.layout.w) };
    layout.y = 0;
    while (placed.some((p) => overlaps(layout, p.layout))) layout.y += 1;
    placed.push({ ...item, layout });
  }
  const order = new Map(items.map((i, index) => [i.id, index]));
  return placed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export const bottomOf = (items: Placed[]) => items.reduce((m, i) => Math.max(m, i.layout.y + i.layout.h), 0);
