import { useMemo, useRef, useState } from 'react';
import { DndContext, type DragEndEvent, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import type { Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { metaOf } from '../../utils/format';
import TaskCard from './TaskCard';
import GroupSidebar from './GroupSidebar';
import GroupStats from './GroupStats';
import { groupTasks, type GroupByKey } from './groupUtils';

function DroppableColumn({
  dropId,
  statusKey,
  tasks,
  taxonomies,
  onOpen,
}: {
  dropId: string;
  statusKey: string;
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  const sm = metaOf(taxonomies, 'status', statusKey);
  const points = tasks.reduce((a, t) => a + (t.complexity || 0), 0);
  return (
    <div ref={setNodeRef} className={`col${isOver ? ' drag-over' : ''}`}>
      <div className="col__head">
        <span className="col__dot" style={{ background: sm.color }} />
        <span className="col__name" style={{ color: sm.color }}>
          {sm.label}
        </span>
        <span className="col__count">
          {tasks.length} · {points}pts
        </span>
      </div>
      {tasks
        .slice()
        .sort((a, b) => (a.priority || '').localeCompare(b.priority || '') || a.taskId.localeCompare(b.taskId))
        .map((t) => (
          <TaskCard key={t.taskId} task={t} taxonomies={taxonomies} onOpen={onOpen} />
        ))}
      {tasks.length === 0 && <div className="empty">—</div>}
    </div>
  );
}

/**
 * Jira-style kanban. If groupBy === 'none' it renders a single flat kanban
 * spanning every status column; otherwise it renders one kanban per group,
 * with the same left sidebar as the grouped board.
 */
export default function JiraBoard({
  tasks,
  taxonomies,
  onOpen,
  onDrop,
  groupBy,
  currentSprintKey,
  visibleStatuses,
}: {
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
  onDrop: (taskId: string, status: string) => void;
  groupBy: GroupByKey;
  currentSprintKey?: string | null;
  visibleStatuses?: string[] | null;
}) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const statuses = taxonomiesByKind(taxonomies, 'status');
  const containerRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupTasks(tasks, groupBy, taxonomies), [tasks, groupBy, taxonomies]);

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const status = String(over.id).split('::').pop();
    if (!status) return;
    const task = active.data.current?.task as Task | undefined;
    if (task && task.status !== status) onDrop(task.taskId, status);
  }

  function scrollToGroup(key: string) {
    if (key === '__top__') {
      setActiveGroupKey(null);
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setActiveGroupKey(key);
    document.getElementById(`jira-group-${cssId(key)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const body = (
    <>
      {groups.map((g) => {
        const byStatus = new Map<string, Task[]>();
        for (const t of g.tasks) {
          if (!byStatus.has(t.status)) byStatus.set(t.status, []);
          byStatus.get(t.status)!.push(t);
        }
        let ordered: TaxonomyItem[];
        if (visibleStatuses && visibleStatuses.length) {
          ordered = statuses.filter((s) => visibleStatuses.includes(s.key));
        } else {
          ordered = statuses.filter((s) => byStatus.has(s.key));
          for (const key of byStatus.keys()) {
            if (!ordered.find((s) => s.key === key)) ordered.push({ key, label: key } as TaxonomyItem);
          }
        }
        const isCurrent = currentSprintKey && g.key === currentSprintKey;
        return (
          <section id={`jira-group-${cssId(g.key)}`} className="group-block" key={g.key}>
            {groupBy !== 'none' && (
              <header className="group-block__head">
                <span className="group-block__title" style={g.color ? { color: g.color } : undefined}>
                  {isCurrent && '★ '}
                  {g.label}
                </span>
                {g.sublabel && <span className="group-block__sub">{g.sublabel}</span>}
                <GroupStats tasks={g.tasks} taxonomies={taxonomies} />
              </header>
            )}
            <div
              className="columns"
              style={{ gridTemplateColumns: `repeat(${Math.max(ordered.length, 1)}, minmax(220px, 1fr))` }}
            >
              {ordered.map((s) => (
                <DroppableColumn
                  key={s.key}
                  dropId={`${g.key}::${s.key}`}
                  statusKey={s.key}
                  tasks={byStatus.get(s.key) || []}
                  taxonomies={taxonomies}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </section>
        );
      })}
      {tasks.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
    </>
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveTask((e.active.data.current?.task as Task) || null)}
      onDragEnd={handleDragEnd}
    >
      {groupBy === 'none' ? (
        <main className="board-main" ref={containerRef}>
          {body}
        </main>
      ) : (
        <div className="grouped-layout" ref={containerRef}>
          <GroupSidebar
            title={sidebarTitle(groupBy)}
            groups={groups}
            activeKey={activeGroupKey}
            onSelect={scrollToGroup}
            currentSprintKey={currentSprintKey}
          />
          <div className="groups-main">{body}</div>
        </div>
      )}
      <DragOverlay>{activeTask && <TaskCard task={activeTask} taxonomies={taxonomies} onOpen={() => {}} />}</DragOverlay>
    </DndContext>
  );
}

function sidebarTitle(groupBy: GroupByKey): string {
  switch (groupBy) {
    case 'sprint': return 'Sprints';
    case 'version': return 'Versions';
    case 'category': return 'Catégories';
    case 'techno': return 'Technos';
    case 'area': return 'Domaines';
    case 'type': return 'Types';
    case 'priority': return 'Priorités';
    case 'status': return 'Statuts';
    case 'assignee': return 'Assignés';
    default: return 'Groupes';
  }
}

function cssId(v: string) {
  return v.replace(/[^a-zA-Z0-9_-]/g, '_');
}
