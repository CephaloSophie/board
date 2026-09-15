import { useMemo, type ReactNode } from 'react';
import { useActivity, type ActivityQuery } from '../../api/activity';
import { errorMessage } from '../../api/client';
import { useProjectPeople } from '../../hooks/useProjectPeople';
import type { ActivityEntry, TaxonomyItem } from '../../types';
import { fmtDate, metaOf } from '../../utils/format';
import { fmtDayLabel, fmtTime, localDayKey } from '../../utils/dates';
import { FIELD_ICONS, FIELD_LABELS, labelForValue } from '../../utils/historyFormat';
import Avatar from '../common/Avatar';

const SCOPE_ICONS: Record<string, string> = { task: '✎', comment: '💬', sprint: '🏃', version: '🏷', project: '⚙', import: '⇪' };
const TEXT_FIELDS = new Set(['title', 'description', 'instructions', 'acceptance']);

function describe(e: ActivityEntry, taxonomies: TaxonomyItem[] | undefined, userName: (id: string) => string | undefined): ReactNode {
  const value = (v: unknown) => labelForValue(e.field, v, taxonomies, userName);
  const quote = (v: unknown) => (v ? <q className="timeline__quote">{String(v)}</q> : null);
  switch (e.action) {
    case 'task.created':
      return <>a créé la tâche{e.to ? <> en <b>{labelForValue('status', e.to, taxonomies)}</b></> : null}</>;
    case 'task.deleted':
      return <>a supprimé la tâche</>;
    case 'task.updated': {
      const label = FIELD_LABELS[e.field || ''] || e.field;
      if (TEXT_FIELDS.has(e.field || '')) return <>a modifié <b>{label}</b>{quote(e.to)}</>;
      return (
        <>
          a changé <b>{label}</b> : <span className="timeline__from">{value(e.from)}</span> → <span className="timeline__to">{value(e.to)}</span>
          {e.data?.bulk ? <span className="tag">action groupée</span> : null}
        </>
      );
    }
    case 'comment.added':
      return <>a commenté{quote(e.to)}</>;
    case 'comment.replied':
      return <>a répondu à un commentaire{quote(e.to)}</>;
    case 'comment.edited':
      return <>a modifié un commentaire{quote(e.to)}</>;
    case 'comment.deleted':
      return <>a supprimé un commentaire{quote(e.from)}</>;
    case 'reaction.added':
      return <>a réagi {String(e.to || '')} à un commentaire</>;
    default:
      return <>{e.note || e.action}</>;
  }
}

export default function ActivityFeed({
  projectKey,
  query,
  taxonomies,
  onOpenTask,
  compact,
  emptyLabel = 'Aucune activité pour ces critères.',
}: {
  projectKey: string;
  query: ActivityQuery;
  taxonomies: TaxonomyItem[] | undefined;
  onOpenTask?: (taskId: string) => void;
  compact?: boolean;
  emptyLabel?: string;
}) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useActivity(projectKey, query);
  const people = useProjectPeople(projectKey);

  const days = useMemo(() => {
    const map = new Map<string, ActivityEntry[]>();
    for (const e of data?.pages.flatMap((p) => p.entries) || []) {
      const key = localDayKey(e.at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()];
  }, [data]);

  if (isLoading) return <div className="loadbox">Chargement du journal…</div>;
  if (error) return <div className="form-error">{errorMessage(error)}</div>;
  if (!days.length) return <div className="empty">{emptyLabel}</div>;

  return (
    <div className={`activity-feed${compact ? ' compact' : ''}`}>
      {days.map(([day, entries]) => (
        <div key={day} className="timeline-day">
          <div className="timeline-day__label">{fmtDayLabel(entries[0].at)}</div>
          {entries.map((e) => {
            const actor = e.actor?.displayName || e.actorLabel || 'système';
            const icon = e.scope === 'task' && e.field ? FIELD_ICONS[e.field] || SCOPE_ICONS.task : SCOPE_ICONS[e.scope] || '•';
            return (
              <div key={e._id} className={`timeline__row scope-${e.scope}`}>
                <span className="timeline__icon">{icon}</span>
                <Avatar name={actor} color={e.actor?.color || '#6b7280'} size="sm" />
                <div className="timeline__text">
                  {e.taskId && (
                    <span className="timeline__task">
                      {onOpenTask ? (
                        <button className="link-btn mono" onClick={() => onOpenTask(e.taskId!)}>
                          {e.taskId}
                        </button>
                      ) : (
                        <span className="mono">{e.taskId}</span>
                      )}
                      {!compact && e.taskTitle && <span className="timeline__task-title">{e.taskTitle}</span>}
                    </span>
                  )}
                  <b>{actor}</b> {describe(e, taxonomies, people.userName)}
                  {e.note && e.scope === 'task' && e.action === 'task.updated' && !compact && <span className="timeline__note"> — {e.note}</span>}
                  {!compact && (e.sprints?.length || e.versions?.length) ? (
                    <span className="timeline__chips">
                      {(e.sprints || []).map((k) => (
                        <span key={`s${k}`} className="tag">
                          {metaOf(taxonomies, 'sprint', k).label}
                        </span>
                      ))}
                      {(e.versions || []).map((k) => (
                        <span key={`v${k}`} className="tag">
                          v{k}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
                <span className="timeline__time" title={fmtDate(e.at)}>
                  {fmtTime(e.at)}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      {hasNextPage && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button className="btn small" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
            {isFetchingNextPage ? 'Chargement…' : 'Charger plus'}
          </button>
        </div>
      )}
    </div>
  );
}
