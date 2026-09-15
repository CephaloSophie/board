import { ApiError } from '../../api/client';
import { useAnalytics, type Widget } from '../../api/dashboards';
import type { TaskFilters, TaxonomyItem, UserRef } from '../../types';
import { fmtDate, metaOf } from '../../utils/format';
import { fmtDay } from '../../utils/dates';
import { SPRINT_STATUS_META } from '../../utils/status';
import Avatar from '../common/Avatar';
import { Donut, fmtNum, GroupedBars, HorizontalBars, LineChart, VerticalBars, type Datum } from '../Charts/Charts';

interface WidgetProps {
  projectKey: string;
  widget: Widget;
  globalFilters: Partial<TaskFilters>;
  taxonomies?: TaxonomyItem[];
  onOpenTask: (taskId: string) => void;
}

// Request body shared by task-based widgets (global filter + widget source).
export function sourceBody(widget: Widget, globalFilters: Partial<TaskFilters>) {
  switch (widget.source.mode) {
    case 'none':
      return {};
    case 'filter':
      return { globalFilters, filterId: widget.source.filterId };
    case 'inline':
      return { globalFilters, filters: widget.source.filters };
    default:
      return { globalFilters };
  }
}

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'FILTER_NOT_FOUND') return 'Filtre indisponible (supprimé ou non partagé).';
    if (error.code === 'SPRINT_NOT_FOUND') return 'Aucun sprint courant : démarrez un sprint ou choisissez-en un dans la configuration.';
    if (error.code === 'SPRINT_WITHOUT_DATES') return 'Ce sprint n’a pas de dates : renseignez-les dans Paramètres → Sprints & versions pour tracer le burndown.';
    return error.message;
  }
  return 'Chargement impossible.';
}

function State({ loading, error, empty }: { loading?: boolean; error?: unknown; empty?: boolean }) {
  if (loading) return <div className="widget-state">Chargement…</div>;
  if (error) return <div className="widget-state error">{explain(error)}</div>;
  if (empty) return <div className="widget-state">Aucune donnée pour ces filtres.</div>;
  return null;
}

export function WidgetBody(props: WidgetProps) {
  switch (props.widget.type) {
    case 'kpi':
      return <KpiWidget {...props} />;
    case 'breakdown':
      return <BreakdownWidget {...props} />;
    case 'matrix':
      return <MatrixWidget {...props} />;
    case 'sprintBurndown':
      return <BurndownWidget {...props} />;
    case 'velocity':
      return <VelocityWidget {...props} />;
    case 'workload':
      return <WorkloadWidget {...props} />;
    case 'taskList':
      return <TaskListWidget {...props} />;
    case 'recentActivity':
      return <ActivityWidget {...props} />;
    case 'sprintSummary':
      return <SprintSummaryWidget {...props} />;
    case 'note':
      return <div className="widget-note">{props.widget.config.text || <span className="text-muted">Note vide : configurez ce widget.</span>}</div>;
    default:
      return null;
  }
}

function KpiWidget({ projectKey, widget, globalFilters }: WidgetProps) {
  const q = useAnalytics<{ value: number; count: number }>(projectKey, 'kpi', { ...sourceBody(widget, globalFilters), metric: widget.config.metric });
  if (!q.data) return <State loading={q.isLoading} error={q.error} />;
  return (
    <div className="kpi-widget">
      <div className="kpi-widget__value" style={{ fontSize: Math.min(20 + widget.layout.h * 12, 64) }}>
        {fmtNum(q.data.value)}
        {widget.config.suffix && <small> {widget.config.suffix}</small>}
      </div>
      {widget.config.metric !== 'count' && <div className="text-muted small-text">{q.data.count} tâche(s)</div>}
    </div>
  );
}

function BreakdownWidget({ projectKey, widget, globalFilters }: WidgetProps) {
  const c = widget.config;
  const q = useAnalytics<{ total: number; count: number; buckets: Datum[] }>(projectKey, 'aggregate', {
    ...sourceBody(widget, globalFilters),
    groupBy: c.groupBy,
    splitBy: c.splitBy,
    metric: c.metric,
    topN: c.topN,
  });
  if (!q.data || !q.data.buckets.length) return <State loading={q.isLoading} error={q.error} empty={!!q.data} />;
  const data = q.data.buckets;
  if (c.chart === 'donut') return <Donut data={data} centerLabel={c.metric === 'points' ? 'points' : c.metric === 'hours' ? 'heures' : 'tâches'} />;
  if (c.chart === 'hbar') return <HorizontalBars data={data} />;
  if (c.chart === 'table') {
    return (
      <table className="admin-table widget-table">
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <td>
                <span className="dot" style={{ background: d.color }} /> {d.label}
              </td>
              <td className="num">{fmtNum(d.value)}</td>
              <td className="num text-muted">{q.data.total ? Math.round((d.value / q.data.total) * 100) : 0}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return <VerticalBars data={data} />;
}

function MatrixWidget({ projectKey, widget, globalFilters }: WidgetProps) {
  const c = widget.config;
  const q = useAnalytics<{ rows: Datum[]; cols: Datum[]; cells: Record<string, Record<string, number>> }>(projectKey, 'matrix', {
    ...sourceBody(widget, globalFilters),
    rows: c.rows,
    cols: c.cols,
    metric: c.metric,
  });
  if (!q.data || !q.data.rows.length) return <State loading={q.isLoading} error={q.error} empty={!!q.data} />;
  const { rows, cols, cells } = q.data;
  const max = Math.max(1, ...rows.flatMap((r) => cols.map((col) => cells[r.key]?.[col.key] || 0)));
  return (
    <div className="table-scroll">
      <table className="matrix">
        <thead>
          <tr>
            <th />
            {cols.map((col) => (
              <th key={col.key}>
                <span className="dot" style={{ background: col.color }} /> {col.label}
              </th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = cols.reduce((a, col) => a + (cells[r.key]?.[col.key] || 0), 0);
            return (
              <tr key={r.key}>
                <th>{r.label}</th>
                {cols.map((col) => {
                  const v = cells[r.key]?.[col.key] || 0;
                  return (
                    <td key={col.key} style={{ background: v ? `color-mix(in srgb, var(--accent) ${Math.round((v / max) * 55) + 8}%, transparent)` : undefined }}>
                      {v ? fmtNum(v) : ''}
                    </td>
                  );
                })}
                <td className="num">
                  <b>{fmtNum(Math.round(total * 10) / 10)}</b>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface Burndown {
  committed: number;
  unit: string;
  days: { date: string; scope: number; completed: number; remaining: number }[];
  ideal: { date: string; value: number }[];
  scopeChanges: { at: string; taskId: string; kind: string }[];
  warnings: string[];
  sprint: { label: string };
}

function BurndownWidget({ projectKey, widget }: WidgetProps) {
  const c = widget.config;
  const q = useAnalytics<Burndown>(projectKey, `sprints/${encodeURIComponent(c.sprint || '@current')}/burndown?unit=${c.unit}`, null, 'GET');
  if (!q.data) return <State loading={q.isLoading} error={q.error} />;
  const { days, ideal } = q.data;
  const labels = ideal.map((d) => d.date.slice(5).split('-').reverse().join('/'));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const pick = (field: 'remaining' | 'completed' | 'scope') => ideal.map((i) => byDate.get(i.date)?.[field] ?? null);
  const unitLabel = c.unit === 'count' ? 'tâches' : 'points';
  const series =
    c.mode === 'burnup'
      ? [
          { key: 'scope', label: `Périmètre (${unitLabel})`, color: '#9db4dd', values: pick('scope') },
          { key: 'done', label: 'Terminé', color: '#2f8f57', values: pick('completed') },
        ]
      : [
          { key: 'remaining', label: `Reste à faire (${unitLabel})`, color: 'var(--accent)', values: pick('remaining') },
          ...(c.showIdeal !== false ? [{ key: 'ideal', label: 'Idéal', color: '#6b7280', values: ideal.map((i) => i.value), dashed: true }] : []),
        ];
  return (
    <div className="widget-fill">
      <div className="widget-sub">
        {q.data.sprint.label} · engagé {fmtNum(q.data.committed)} {unitLabel}
        {q.data.scopeChanges.length > 0 && ` · ${q.data.scopeChanges.length} changement(s) de périmètre`}
        {q.data.warnings.includes('HISTORY_INCOMPLETE') && <span title="Historique importé incomplet : courbe approximative"> · ⚠ approximatif</span>}
      </div>
      <LineChart labels={labels} series={series} />
    </div>
  );
}

function VelocityWidget({ projectKey, widget }: WidgetProps) {
  const c = widget.config;
  const q = useAnalytics<{ sprints: { key: string; label: string; committed: number | null; completed: number | null; source: string }[]; average: number | null }>(
    projectKey,
    `velocity?last=${c.last}&unit=${c.unit}`,
    null,
    'GET'
  );
  if (!q.data || !q.data.sprints.length) return <State loading={q.isLoading} error={q.error} empty={!!q.data} />;
  return (
    <GroupedBars
      labels={q.data.sprints.map((s) => s.label)}
      series={[
        { key: 'committed', label: 'Engagé', color: '#9db4dd', values: q.data.sprints.map((s) => s.committed) },
        { key: 'completed', label: 'Livré', color: '#2f8f57', values: q.data.sprints.map((s) => s.completed) },
      ]}
      average={q.data.average}
    />
  );
}

function WorkloadWidget({ projectKey, widget, globalFilters }: WidgetProps) {
  const c = widget.config;
  const q = useAnalytics<{ rows: { key: string; label: string; color: string; todo: number; inprogress: number; done: number; total: number }[] }>(projectKey, 'workload', {
    ...sourceBody(widget, globalFilters),
    metric: c.metric,
    includeUnassigned: c.includeUnassigned,
  });
  if (!q.data || !q.data.rows.length) return <State loading={q.isLoading} error={q.error} empty={!!q.data} />;
  const capacity = typeof c.capacityPerUser === 'number' ? c.capacityPerUser : null;
  const data: Datum[] = q.data.rows.map((r) => ({
    key: r.key,
    label: r.label,
    value: r.total,
    split: [
      { key: 'todo', label: 'À faire', color: '#9db4dd', value: r.todo },
      { key: 'inprogress', label: 'En cours', color: '#e6c46a', value: r.inprogress },
      { key: 'done', label: 'Terminé', color: '#2f8f57', value: r.done },
    ],
  }));
  return (
    <div className="widget-fill">
      <HorizontalBars data={data} />
      {capacity !== null && (
        <div className="widget-sub">
          Capacité : {capacity} par personne ·{' '}
          {q.data.rows.filter((r) => r.key !== '__none__' && r.todo + r.inprogress > capacity).map((r) => r.label).join(', ') || 'personne en surcharge'}
        </div>
      )}
    </div>
  );
}

interface ListTask {
  _id: string;
  taskId: string;
  title: string;
  status: string;
  priority?: string;
  complexity: number;
  assignee?: UserRef | null;
  dueDate?: string | null;
}

function TaskListWidget({ projectKey, widget, globalFilters, taxonomies, onOpenTask }: WidgetProps) {
  const c = widget.config;
  const q = useAnalytics<{ tasks: ListTask[]; total: number }>(projectKey, 'tasks', { ...sourceBody(widget, globalFilters), sort: c.sort, limit: c.limit });
  if (!q.data || !q.data.tasks.length) return <State loading={q.isLoading} error={q.error} empty={!!q.data} />;
  return (
    <div className="widget-fill">
      <table className="admin-table widget-table clickable">
        <tbody>
          {q.data.tasks.map((t) => {
            const s = metaOf(taxonomies, 'status', t.status);
            const p = metaOf(taxonomies, 'priority', t.priority);
            return (
              <tr key={t._id} onClick={() => onOpenTask(t.taskId)}>
                <td className="mono text-muted">{t.taskId}</td>
                <td className="widget-table__title">{t.title}</td>
                <td>
                  <span className="tag" style={{ borderColor: s.color, color: s.color }}>
                    {s.label}
                  </span>
                </td>
                <td>{t.priority && <span style={{ color: p.color }}>{t.priority}</span>}</td>
                <td className="num">{t.complexity}</td>
                <td>{t.assignee ? <Avatar name={t.assignee.displayName} color={t.assignee.color} size="sm" /> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {q.data.total > q.data.tasks.length && <div className="widget-sub">{q.data.total - q.data.tasks.length} autre(s) tâche(s)…</div>}
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  created: 'Création',
  status: 'Statut',
  priority: 'Priorité',
  assignee: 'Assignation',
  sprint: 'Sprint',
  version: 'Version',
  complexity: 'Points',
  title: 'Titre',
  labels: 'Étiquettes',
  type: 'Type',
  parent: 'Parent',
  dueDate: 'Échéance',
};

function ActivityWidget({ projectKey, widget, globalFilters, taxonomies, onOpenTask }: WidgetProps) {
  const q = useAnalytics<{
    entries: { at: string; taskId: string; title: string; field: string; from: unknown; to: unknown; by: UserRef | null; byLabel?: string; note?: string }[];
  }>(projectKey, 'activity', { ...sourceBody(widget, globalFilters), limit: widget.config.limit });
  if (!q.data || !q.data.entries.length) return <State loading={q.isLoading} error={q.error} empty={!!q.data} />;
  const label = (field: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'status' || field === 'priority' || field === 'sprint') return metaOf(taxonomies, field, String(v)).label;
    if (field === 'assignee') return 'une personne';
    return Array.isArray(v) ? v.join(', ') : String(v);
  };
  return (
    <ul className="activity">
      {q.data.entries.map((e, i) => (
        <li key={`${e.taskId}-${e.at}-${i}`} onClick={() => onOpenTask(e.taskId)}>
          <div className="activity__meta">
            {fmtDate(e.at)} · <span className="mono">{e.taskId}</span> · {e.by?.displayName || e.byLabel || 'système'}
          </div>
          <div>
            <b>{FIELD_LABELS[e.field] || e.field}</b>
            {e.field === 'created' ? ` : ${e.title}` : ` : ${label(e.field, e.from)} → ${label(e.field, e.to)}`}
          </div>
        </li>
      ))}
    </ul>
  );
}

function SprintSummaryWidget({ projectKey, widget }: WidgetProps) {
  const q = useAnalytics<{
    sprint: { key: string; label: string; status: keyof typeof SPRINT_STATUS_META; startDate?: string; endDate?: string; goal: string };
    taskCount: number;
    doneCount: number;
    points: number;
    donePoints: number;
    committed: number;
    pctDone: number;
    daysLeft: number | null;
    events: { _id: string; title: string; status: string; scheduledAt: string | null; icon: string; typeLabel: string }[];
  }>(projectKey, 'sprint-summary', { sprint: widget.config.sprint });
  if (!q.data) return <State loading={q.isLoading} error={q.error} />;
  const d = q.data;
  const meta = SPRINT_STATUS_META[d.sprint.status] || SPRINT_STATUS_META.draft;
  return (
    <div className="sprint-summary">
      <div className="row">
        <span className="sprint-status" style={{ background: `${meta.color}26`, color: meta.color }}>
          {meta.label}
        </span>
        <b>{d.sprint.label}</b>
        {d.daysLeft !== null && d.sprint.status === 'active' && (
          <span className={`tag${d.daysLeft < 0 ? ' danger-tag' : ''}`}>{d.daysLeft < 0 ? `+${-d.daysLeft} j de retard` : `J-${d.daysLeft}`}</span>
        )}
      </div>
      {d.sprint.goal && <div className="sprint-summary__goal">🎯 {d.sprint.goal}</div>}
      <div className="small-text text-muted">
        {fmtDay(d.sprint.startDate)} → {fmtDay(d.sprint.endDate)}
      </div>
      <div className="progress big">
        <span style={{ width: `${d.pctDone}%` }} />
      </div>
      <div className="small-text">
        <b>{d.pctDone} %</b> · {fmtNum(d.donePoints)}/{fmtNum(d.points)} pts · {d.doneCount}/{d.taskCount} tâches · engagé {fmtNum(d.committed)}
      </div>
      {d.events.length > 0 && (
        <ul className="sprint-summary__events">
          {d.events.map((e) => (
            <li key={e._id}>
              {e.icon} {e.title} <span className="text-muted">{e.scheduledAt ? fmtDate(e.scheduledAt) : e.typeLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
