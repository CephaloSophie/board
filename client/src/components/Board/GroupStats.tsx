import type { Task, TaxonomyItem } from '../../types';
import { fmtDur, hoursOf } from '../../utils/format';

// Computes and renders a compact stats bar for a group of tasks:
// - total tasks / points / estimated hours,
// - points breakdown by status "bucket" (todo / in-progress / done) derived
//   from the taxonomy's `meta.isDone` flag and the standard onprocess key,
// - unassigned count so PO/scrum masters see slack at a glance.
export interface GroupStatsData {
  count: number;
  points: number;
  hours: number;
  todoPoints: number;
  inProgressPoints: number;
  donePoints: number;
  unassigned: number;
}

const IN_PROGRESS_STATUSES = new Set(['onprocess', 'needreview', 'needconfirmation', 'tested']);

export function computeStats(tasks: Task[], taxonomies: TaxonomyItem[] | undefined): GroupStatsData {
  const doneKeys = new Set(
    (taxonomies || [])
      .filter((t) => t.kind === 'status' && (t.meta as { isDone?: boolean } | undefined)?.isDone)
      .map((t) => t.key)
  );
  let points = 0;
  let hours = 0;
  let todoPoints = 0;
  let inProgressPoints = 0;
  let donePoints = 0;
  let unassigned = 0;
  for (const t of tasks) {
    const p = t.complexity || 0;
    points += p;
    hours += hoursOf(t.duration);
    if (doneKeys.has(t.status)) donePoints += p;
    else if (IN_PROGRESS_STATUSES.has(t.status)) inProgressPoints += p;
    else todoPoints += p;
    if (!t.assignee) unassigned += 1;
  }
  return { count: tasks.length, points, hours, todoPoints, inProgressPoints, donePoints, unassigned };
}

export default function GroupStats({ tasks, taxonomies }: { tasks: Task[]; taxonomies: TaxonomyItem[] | undefined }) {
  const s = computeStats(tasks, taxonomies);
  return (
    <div className="group-block__stats">
      <span className="stat-pill">
        <b>{s.count}</b> tâches
      </span>
      <span className="stat-pill" style={{ borderColor: 'color-mix(in srgb, var(--gold) 40%, transparent)', color: 'var(--gold)' }}>
        <b>{s.points}</b> pts
      </span>
      <span className="stat-pill" style={{ color: 'var(--info)' }}>
        ~{fmtDur(s.hours)}
      </span>
      <span className="stat-pill" style={{ color: 'var(--soft)' }}>
        <span className="status-dot" style={{ background: '#9db4dd' }} /> à faire <b>{s.todoPoints}</b>
      </span>
      <span className="stat-pill" style={{ color: 'var(--soft)' }}>
        <span className="status-dot" style={{ background: '#e6c46a' }} /> en cours <b>{s.inProgressPoints}</b>
      </span>
      <span className="stat-pill" style={{ color: 'var(--soft)' }}>
        <span className="status-dot" style={{ background: '#2f8f57' }} /> terminé <b>{s.donePoints}</b>
      </span>
      {s.unassigned > 0 && (
        <span className="stat-pill" style={{ color: 'var(--danger)' }}>
          {s.unassigned} sans assigné
        </span>
      )}
    </div>
  );
}
