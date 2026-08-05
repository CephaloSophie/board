import { useState } from 'react';
import { DndContext, type DragEndEvent, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import StatusColumn from './StatusColumn';
import TaskCard from './TaskCard';

export default function JiraBoard({
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
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const statuses = taxonomiesByKind(taxonomies, 'status');

  const byStatus = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!byStatus.has(t.status)) byStatus.set(t.status, []);
    byStatus.get(t.status)!.push(t);
  }
  const ordered = statuses.filter((s) => byStatus.has(s.key));
  for (const key of byStatus.keys()) {
    if (!ordered.find((s) => s.key === key)) ordered.push({ key, label: key } as TaxonomyItem);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const status = String(over.id);
    const task = active.data.current?.task as Task | undefined;
    if (task && task.status !== status) onDrop(task.taskId, status);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveTask((e.active.data.current?.task as Task) || null)}
      onDragEnd={handleDragEnd}
    >
      <main className="board-main">
        <div className="columns" style={{ gridTemplateColumns: `repeat(${Math.max(ordered.length, 1)}, minmax(240px, 1fr))` }}>
          {ordered.map((s) => (
            <StatusColumn
              key={s.key}
              statusKey={s.key}
              tasks={(byStatus.get(s.key) || []).sort(
                (a, b) => a.priority?.localeCompare(b.priority || '') || a.taskId.localeCompare(b.taskId)
              )}
              taxonomies={taxonomies}
              onOpen={onOpen}
            />
          ))}
        </div>
        {tasks.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
      </main>
      <DragOverlay>
        {activeTask && <TaskCard task={activeTask} taxonomies={taxonomies} onOpen={() => {}} />}
      </DragOverlay>
    </DndContext>
  );
}
