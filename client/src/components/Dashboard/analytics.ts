import type { SprintMeta, Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';

export const QA_STATUSES = new Set(['tested', 'needconfirmation', 'needreview']);
export const IN_PROGRESS_STATUSES = new Set(['onprocess']);

export function doneKeysOf(taxonomies: TaxonomyItem[] | undefined): Set<string> {
  return new Set(
    (taxonomies || [])
      .filter((t) => t.kind === 'status' && (t.meta as { isDone?: boolean } | undefined)?.isDone)
      .map((t) => t.key)
  );
}

export type Bucket = 'todo' | 'doing' | 'done';
export function bucketOf(status: string, doneKeys: Set<string>): Bucket {
  if (doneKeys.has(status)) return 'done';
  if (IN_PROGRESS_STATUSES.has(status) || QA_STATUSES.has(status)) return 'doing';
  return 'todo';
}

// ---- Velocity: done points per sprint (in taxonomy order) ----
export function velocity(tasks: Task[], taxonomies: TaxonomyItem[] | undefined) {
  const doneKeys = doneKeysOf(taxonomies);
  const sprints = taxonomiesByKind(taxonomies, 'sprint');
  return sprints.map((s) => {
    const inSprint = tasks.filter((t) => t.sprint === s.key);
    const donePts = inSprint.filter((t) => doneKeys.has(t.status)).reduce((a, t) => a + (t.complexity || 0), 0);
    const totalPts = inSprint.reduce((a, t) => a + (t.complexity || 0), 0);
    return { key: s.key, label: s.label, color: s.color, done: donePts, total: totalPts };
  });
}

// ---- Real burndown for a sprint, using the task history done-dates ----
function firstDoneDate(task: Task, doneKeys: Set<string>): number | null {
  let earliest: number | null = null;
  for (const h of task.history || []) {
    if (h.to && doneKeys.has(String(h.to))) {
      const t = new Date(h.at).getTime();
      if (earliest === null || t < earliest) earliest = t;
    }
  }
  if (earliest === null && doneKeys.has(task.status)) {
    // Currently done but no history entry — approximate with updatedAt.
    earliest = new Date(task.updatedAt || task.createdAt).getTime();
  }
  return earliest;
}

export function burndown(tasks: Task[], sprintMeta: SprintMeta | undefined, taxonomies: TaxonomyItem[] | undefined) {
  if (!sprintMeta?.startDate || !sprintMeta?.endDate) return null;
  const doneKeys = doneKeysOf(taxonomies);
  const start = new Date(sprintMeta.startDate).getTime();
  const end = new Date(sprintMeta.endDate).getTime();
  const now = Date.now();
  const dayMs = 86400000;
  const days = Math.max(1, Math.round((end - start) / dayMs));
  const total = tasks.reduce((a, t) => a + (t.complexity || 0), 0);
  const doneDates = tasks.map((t) => ({ pts: t.complexity || 0, done: firstDoneDate(t, doneKeys) }));

  const points: { day: number; ideal: number; actual: number | null }[] = [];
  for (let d = 0; d <= days; d++) {
    const dayTime = start + d * dayMs;
    const ideal = total - (total * d) / days;
    let actual: number | null = null;
    if (dayTime <= now + dayMs) {
      const doneByDay = doneDates.reduce((a, x) => a + (x.done !== null && x.done <= dayTime ? x.pts : 0), 0);
      actual = Math.max(0, total - doneByDay);
    }
    points.push({ day: d, ideal, actual });
  }
  return { points, total, days };
}

// ---- Workload per assignee (points by bucket) ----
export function workload(tasks: Task[], taxonomies: TaxonomyItem[] | undefined) {
  const doneKeys = doneKeysOf(taxonomies);
  const map = new Map<string, { name: string; color?: string; todo: number; doing: number; done: number }>();
  for (const t of tasks) {
    const key = t.assignee?._id || '__none__';
    if (!map.has(key)) {
      map.set(key, { name: t.assignee?.displayName || 'Non assigné', color: t.assignee?.color, todo: 0, doing: 0, done: 0 });
    }
    const row = map.get(key)!;
    row[bucketOf(t.status, doneKeys)] += t.complexity || 0;
  }
  return Array.from(map.values())
    .map((r) => ({ ...r, total: r.todo + r.doing + r.done }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}

// ---- QA metrics ----
export function qaMetrics(tasks: Task[], taxonomies: TaxonomyItem[] | undefined) {
  const doneKeys = doneKeysOf(taxonomies);
  const bugsOpen = tasks.filter((t) => t.type === 'bug' && !doneKeys.has(t.status)).length;
  const bugsTotal = tasks.filter((t) => t.type === 'bug').length;
  const inQa = tasks.filter((t) => QA_STATUSES.has(t.status)).length;
  const total = tasks.length || 1;
  const defectRatio = Math.round((bugsTotal / total) * 100);
  return { bugsOpen, bugsTotal, inQa, defectRatio };
}

// ---- Sprint summary (for the current sprint) ----
export function sprintSummary(tasks: Task[], taxonomies: TaxonomyItem[] | undefined) {
  const doneKeys = doneKeysOf(taxonomies);
  const total = tasks.reduce((a, t) => a + (t.complexity || 0), 0);
  const done = tasks.filter((t) => doneKeys.has(t.status)).reduce((a, t) => a + (t.complexity || 0), 0);
  const estimated = tasks.filter((t) => (t.complexity || 0) > 0).length;
  const blockers = tasks.filter((t) => t.priority === 'P0' && !doneKeys.has(t.status)).length;
  const unassigned = tasks.filter((t) => !t.assignee).length;
  return { total, done, count: tasks.length, estimated, blockers, unassigned, pct: total ? Math.round((done / total) * 100) : 0 };
}
