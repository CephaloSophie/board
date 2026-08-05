import { useMemo, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Task, TaxonomyItem, TaxonomyKind } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { metaOf } from '../../utils/format';
import TaskCard from './TaskCard';

const GROUP_OPTIONS: { value: TaxonomyKind | 'status'; label: string }[] = [
  { value: 'status', label: 'Statut (colonnes)' },
  { value: 'version', label: 'Version' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'category', label: 'Catégorie' },
  { value: 'techno', label: 'Techno' },
  { value: 'type', label: 'Type' },
  { value: 'priority', label: 'Priorité' },
  { value: 'area', label: 'Domaine' },
];

// A status column occurs once per group, so its droppable id is namespaced
// as "<groupKey>::<statusKey>" — handleDragEnd below strips the prefix back off.
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
}: {
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
  onDrop: (taskId: string, status: string) => void;
}) {
  const [groupBy, setGroupBy] = useState<TaxonomyKind | 'status'>('status');
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const statuses = taxonomiesByKind(taxonomies, 'status');

  const groups = useMemo(() => {
    if (groupBy === 'status') return [{ key: '__all__', label: 'Toutes les tâches filtrées', tasks }];
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = (t as any)[groupBy] || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (groupBy === 'version' || groupBy === 'sprint') return b.localeCompare(a, undefined, { numeric: true });
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      key: k,
      label:
        groupBy === 'priority'
          ? `${k} · ${metaOf(taxonomies, 'priority', k).label}`
          : metaOf(taxonomies, groupBy, k).label || k,
      tasks: map.get(k)!,
    }));
  }, [tasks, groupBy, taxonomies]);

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const status = String(over.id).split('::').pop();
    if (!status) return;
    const task = active.data.current?.task as Task | undefined;
    if (task && task.status !== status) onDrop(task.taskId, status);
  }

  return (
    <>
      <div className="controls" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <div className="ctrl">
          <label>Regrouper par</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as TaxonomyKind | 'status')}>
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={(e) => setActiveTask((e.active.data.current?.task as Task) || null)}
        onDragEnd={handleDragEnd}
      >
        <main className="board-main">
          {groups.map((group) => {
            const byStatus = new Map<string, Task[]>();
            for (const t of group.tasks) {
              if (!byStatus.has(t.status)) byStatus.set(t.status, []);
              byStatus.get(t.status)!.push(t);
            }
            const points = group.tasks.reduce((a, t) => a + (t.complexity || 0), 0);
            const orderedStatuses = statuses.filter((s) => byStatus.has(s.key));
            for (const key of byStatus.keys()) {
              if (!orderedStatuses.find((s) => s.key === key)) orderedStatuses.push({ key, label: key } as TaxonomyItem);
            }
            return (
              <div className="group" key={group.key}>
                <div className="group__head">
                  <span className="group__title">{group.label}</span>
                  <span className="group__meta">
                    {group.tasks.length} tâches · {points} pts
                  </span>
                </div>
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
              </div>
            );
          })}
          {groups.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
        </main>
        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} taxonomies={taxonomies} onOpen={() => {}} />}
        </DragOverlay>
      </DndContext>
    </>
  );
}
