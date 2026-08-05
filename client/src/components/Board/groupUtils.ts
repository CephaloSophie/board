import type { Task, TaxonomyItem, TaxonomyKind } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { metaOf } from '../../utils/format';

export type GroupByKey =
  | 'none'
  | 'sprint'
  | 'version'
  | 'category'
  | 'techno'
  | 'area'
  | 'type'
  | 'priority'
  | 'status'
  | 'assignee';

export const GROUP_OPTIONS: { value: GroupByKey; label: string }[] = [
  { value: 'sprint', label: 'Sprint' },
  { value: 'version', label: 'Version' },
  { value: 'category', label: 'Catégorie' },
  { value: 'techno', label: 'Techno' },
  { value: 'area', label: 'Domaine' },
  { value: 'type', label: 'Type' },
  { value: 'priority', label: 'Priorité' },
  { value: 'status', label: 'Statut' },
  { value: 'assignee', label: 'Assigné' },
  { value: 'none', label: 'Aucun regroupement' },
];

export interface TaskGroup {
  key: string;
  label: string;
  color?: string;
  sublabel?: string;
  order: number;
  tasks: Task[];
}

const UNGROUPED_KEY = '__ungrouped__';

// Bucket tasks by the chosen dimension. Group ordering, labels and colors
// come from the project's taxonomy (so admins can rename or recolor without
// touching the board), with sane fallbacks for values that don't have a
// matching taxonomy row (rare but possible during data migration).
export function groupTasks(tasks: Task[], groupBy: GroupByKey, taxonomies: TaxonomyItem[] | undefined): TaskGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'Toutes les tâches filtrées', order: 0, tasks }];
  }

  if (groupBy === 'assignee') {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.assignee?._id || UNGROUPED_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    const groups: TaskGroup[] = [];
    for (const [key, list] of map) {
      if (key === UNGROUPED_KEY) continue;
      const first = list[0]?.assignee;
      groups.push({
        key,
        label: first?.displayName || key,
        color: first?.color,
        order: 0,
        tasks: list,
      });
    }
    groups.sort((a, b) => a.label.localeCompare(b.label));
    if (map.has(UNGROUPED_KEY)) {
      groups.push({ key: UNGROUPED_KEY, label: 'Non assigné', color: '#6b7280', order: 999, tasks: map.get(UNGROUPED_KEY)! });
    }
    return groups;
  }

  const kind = groupBy as TaxonomyKind;
  const taxItems = taxonomiesByKind(taxonomies, kind);
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const key = ((t as unknown as Record<string, unknown>)[groupBy] as string | null) || UNGROUPED_KEY;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  const groups: TaskGroup[] = [];
  for (const item of taxItems) {
    if (map.has(item.key)) {
      groups.push({
        key: item.key,
        label: item.label,
        color: item.color,
        sublabel: kind === 'sprint' ? (item.meta as { status?: string })?.status : undefined,
        order: item.order,
        tasks: map.get(item.key)!,
      });
      map.delete(item.key);
    }
  }
  // Anything left has no taxonomy match — fall back to raw key.
  for (const [key, list] of map) {
    if (key === UNGROUPED_KEY) continue;
    const item = metaOf(taxonomies, kind, key);
    groups.push({ key, label: item.label, color: item.color, order: 1000, tasks: list });
  }
  if (map.has(UNGROUPED_KEY)) {
    groups.push({ key: UNGROUPED_KEY, label: '— Non défini —', color: '#6b7280', order: 9999, tasks: map.get(UNGROUPED_KEY)! });
  }
  return groups;
}

export const UNASSIGNED = UNGROUPED_KEY;
