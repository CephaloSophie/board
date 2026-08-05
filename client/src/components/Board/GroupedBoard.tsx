import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { metaOf } from '../../utils/format';
import TaskCard from './TaskCard';
import GroupSidebar from './GroupSidebar';
import GroupStats from './GroupStats';
import { groupTasks, type GroupByKey } from './groupUtils';

// Namespaced droppable id so the same status column repeated across groups
// stays uniquely identifiable to dnd-kit ("<groupKey>::<statusKey>").
function GroupedStatusColumn({
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
      {tasks.map((t) => (
        <TaskCard key={t.taskId} task={t} taxonomies={taxonomies} onOpen={onOpen} />
      ))}
      {tasks.length === 0 && <div className="empty">—</div>}
    </div>
  );
}

export default function GroupedBoard({
  tasks,
  taxonomies,
  onOpen,
  onDrop,
  groupBy,
  currentSprintKey,
}: {
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
  onDrop: (taskId: string, status: string) => void;
  groupBy: GroupByKey;
  currentSprintKey?: string | null;
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
    const el = document.getElementById(`group-block-${cssId(key)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveTask((e.active.data.current?.task as Task) || null)}
      onDragEnd={handleDragEnd}
    >
      {groupBy === 'none' ? (
        // No grouping: render a single flat block, keeps the same layout the
        // rest of the code paths use so drag-and-drop stays identical.
        <main className="board-main" ref={containerRef}>
          {groups.map((group) => (
            <GroupBlock
              key={group.key}
              group={group}
              statuses={statuses}
              taxonomies={taxonomies}
              onOpen={onOpen}
              currentSprintKey={currentSprintKey}
            />
          ))}
          {tasks.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
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
          <div className="groups-main">
            {groups.map((group) => (
              <GroupBlock
                key={group.key}
                group={group}
                statuses={statuses}
                taxonomies={taxonomies}
                onOpen={onOpen}
                currentSprintKey={currentSprintKey}
              />
            ))}
            {tasks.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
          </div>
        </div>
      )}
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} taxonomies={taxonomies} onOpen={() => {}} />}
      </DragOverlay>
    </DndContext>
  );
}

function GroupBlock({
  group,
  statuses,
  taxonomies,
  onOpen,
  currentSprintKey,
}: {
  group: import('./groupUtils').TaskGroup;
  statuses: TaxonomyItem[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
  currentSprintKey?: string | null;
}) {
  const byStatus = new Map<string, Task[]>();
  for (const t of group.tasks) {
    if (!byStatus.has(t.status)) byStatus.set(t.status, []);
    byStatus.get(t.status)!.push(t);
  }
  const orderedStatuses = statuses.filter((s) => byStatus.has(s.key));
  for (const key of byStatus.keys()) {
    if (!orderedStatuses.find((s) => s.key === key)) orderedStatuses.push({ key, label: key } as TaxonomyItem);
  }
  const isCurrent = currentSprintKey && group.key === currentSprintKey;
  return (
    <section id={`group-block-${cssId(group.key)}`} className="group-block">
      <header className="group-block__head">
        <span className="group-block__title" style={group.color ? { color: group.color } : undefined}>
          {isCurrent && '★ '}
          {group.label}
        </span>
        {group.sublabel && <span className="group-block__sub">{group.sublabel}</span>}
        <GroupStats tasks={group.tasks} taxonomies={taxonomies} />
      </header>
      <div className="columns">
        {orderedStatuses.map((s) => (
          <GroupedStatusColumn
            key={s.key}
            dropId={`${group.key}::${s.key}`}
            statusKey={s.key}
            tasks={byStatus.get(s.key) || []}
            taxonomies={taxonomies}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}

function sidebarTitle(groupBy: GroupByKey): string {
  const opt = groupBy;
  switch (opt) {
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
