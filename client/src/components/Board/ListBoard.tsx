import { useMemo, useRef, useState } from 'react';
import type { Task, TaxonomyItem } from '../../types';
import { metaOf } from '../../utils/format';
import Avatar from '../common/Avatar';
import GroupSidebar from './GroupSidebar';
import GroupStats from './GroupStats';
import { groupTasks, type GroupByKey } from './groupUtils';

type SortKey = 'taskId' | 'title' | 'status' | 'priority' | 'version' | 'sprint' | 'complexity' | 'assignee';

export default function ListBoard({
  tasks,
  taxonomies,
  onOpen,
  groupBy,
  currentSprintKey,
}: {
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
  groupBy: GroupByKey;
  currentSprintKey?: string | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('taskId');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupTasks(tasks, groupBy, taxonomies), [tasks, groupBy, taxonomies]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '');

  function sortTasks(list: Task[]): Task[] {
    const copy = [...list];
    copy.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      if (sortKey === 'assignee') {
        av = a.assignee?.displayName || '';
        bv = b.assignee?.displayName || '';
      } else if (sortKey === 'complexity') {
        av = a.complexity || 0;
        bv = b.complexity || 0;
      } else {
        av = (a[sortKey] as string) || '';
        bv = (b[sortKey] as string) || '';
      }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return copy;
  }

  function scrollToGroup(key: string) {
    if (key === '__top__') {
      setActiveGroupKey(null);
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setActiveGroupKey(key);
    document.getElementById(`list-group-${cssId(key)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderRows(list: Task[]) {
    return sortTasks(list).map((t) => {
      const sm = metaOf(taxonomies, 'status', t.status);
      const pm = metaOf(taxonomies, 'priority', t.priority);
      const sprintLabel = t.sprint ? metaOf(taxonomies, 'sprint', t.sprint).label : '—';
      return (
        <tr key={t.taskId} onClick={() => onOpen(t.taskId)}>
          <td style={{ fontFamily: 'var(--mono)', color: 'var(--mute)' }}>{t.taskId}</td>
          <td>{t.title}</td>
          <td>
            <span className="tag" style={{ borderColor: sm.color, color: sm.color }}>
              {sm.label}
            </span>
          </td>
          <td>
            {t.priority && (
              <span className="tag" style={{ borderColor: pm.color, color: pm.color }}>
                {t.priority}
              </span>
            )}
          </td>
          <td>{t.version || '—'}</td>
          <td>{sprintLabel}</td>
          <td className="tag pts" style={{ display: 'inline-block' }}>
            {t.complexity}
          </td>
          <td>
            {t.assignee ? (
              <span className="row">
                <Avatar name={t.assignee.displayName} color={t.assignee.color} size="sm" />
                {t.assignee.displayName}
              </span>
            ) : (
              <span className="text-muted">Non assigné</span>
            )}
          </td>
        </tr>
      );
    });
  }

  function renderTable(list: Task[]) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className="task-table">
          <thead>
            <tr>
              <th onClick={() => sortBy('taskId')}>ID{arrow('taskId')}</th>
              <th onClick={() => sortBy('title')}>Titre{arrow('title')}</th>
              <th onClick={() => sortBy('status')}>Statut{arrow('status')}</th>
              <th onClick={() => sortBy('priority')}>Priorité{arrow('priority')}</th>
              <th onClick={() => sortBy('version')}>Version{arrow('version')}</th>
              <th onClick={() => sortBy('sprint')}>Sprint{arrow('sprint')}</th>
              <th onClick={() => sortBy('complexity')}>Points{arrow('complexity')}</th>
              <th onClick={() => sortBy('assignee')}>Assigné{arrow('assignee')}</th>
            </tr>
          </thead>
          <tbody>{renderRows(list)}</tbody>
        </table>
      </div>
    );
  }

  const body = (
    <>
      {groups.map((g) => (
        <section id={`list-group-${cssId(g.key)}`} className="group-block" key={g.key}>
          {groupBy !== 'none' && (
            <header className="group-block__head">
              <span className="group-block__title" style={g.color ? { color: g.color } : undefined}>
                {currentSprintKey && g.key === currentSprintKey && '★ '}
                {g.label}
              </span>
              {g.sublabel && <span className="group-block__sub">{g.sublabel}</span>}
              <GroupStats tasks={g.tasks} taxonomies={taxonomies} />
            </header>
          )}
          {renderTable(g.tasks)}
        </section>
      ))}
      {tasks.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
    </>
  );

  if (groupBy === 'none') {
    return (
      <main className="board-main" ref={containerRef}>
        {body}
      </main>
    );
  }
  return (
    <div className="grouped-layout" ref={containerRef}>
      <GroupSidebar
        title="Groupes"
        groups={groups}
        activeKey={activeGroupKey}
        onSelect={scrollToGroup}
        currentSprintKey={currentSprintKey}
      />
      <div className="groups-main">{body}</div>
    </div>
  );
}

function cssId(v: string) {
  return v.replace(/[^a-zA-Z0-9_-]/g, '_');
}
