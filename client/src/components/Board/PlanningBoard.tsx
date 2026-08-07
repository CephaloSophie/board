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
import type { Task, TaxonomyItem } from '../../types';
import TaskCard from './TaskCard';
import { groupTasks, type GroupByKey, UNASSIGNED } from './groupUtils';

// Planning board: the *columns* are the values of the chosen grouping
// dimension (sprints, versions, technos, assignees…). Dragging a card into
// another column re-assigns that dimension on the task — e.g. move a story
// from "Sprint 12.4.3" to "Sprint 12.4.4", or onto a teammate's column to
// reassign it. Status grouping keeps the usual status semantics.
function PlanningColumn({
  groupKey,
  label,
  color,
  tasks,
  taxonomies,
  isCurrent,
  onOpen,
}: {
  groupKey: string;
  label: string;
  color?: string;
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  isCurrent?: boolean;
  onOpen: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: groupKey });
  const points = tasks.reduce((a, t) => a + (t.complexity || 0), 0);
  return (
    <div ref={setNodeRef} className={`planning-col${isOver ? ' drag-over' : ''}${isCurrent ? ' current' : ''}`}>
      <div className="planning-col__head">
        <span className="planning-col__dot" style={{ background: color || 'var(--soft)' }} />
        <span className="planning-col__name">
          {isCurrent && '★ '}
          {label}
        </span>
        <span className="planning-col__count">
          {tasks.length} · {points}pts
        </span>
      </div>
      {tasks.map((t) => (
        <TaskCard key={t.taskId} task={t} taxonomies={taxonomies} onOpen={onOpen} />
      ))}
      {tasks.length === 0 && <div className="empty">déposer ici</div>}
    </div>
  );
}

export default function PlanningBoard({
  tasks,
  taxonomies,
  groupBy,
  currentSprintKey,
  onOpen,
  onReassign,
}: {
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  groupBy: GroupByKey;
  currentSprintKey?: string | null;
  onOpen: (taskId: string) => void;
  // Called when a card is dropped in another column: (taskId, field, value)
  onReassign: (taskId: string, field: string, value: string | null) => void;
}) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Status grouping is a passthrough to the normal status field.
  const dimension = groupBy === 'none' ? 'status' : groupBy;
  const groups = useMemo(() => groupTasks(tasks, dimension as GroupByKey, taxonomies), [tasks, dimension, taxonomies]);

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;
    const task = active.data.current?.task as Task | undefined;
    if (!task) return;
    const target = String(over.id);
    const currentVal =
      dimension === 'assignee' ? task.assignee?._id || UNASSIGNED : ((task as any)[dimension] as string) || UNASSIGNED;
    if (target === currentVal) return;

    if (dimension === 'assignee') {
      onReassign(task.taskId, 'assignee', target === UNASSIGNED ? null : target);
    } else {
      onReassign(task.taskId, dimension, target === UNASSIGNED ? null : target);
    }
  }

  const dimLabel: Record<string, string> = {
    sprint: 'sprint', version: 'version', techno: 'techno', category: 'catégorie',
    area: 'domaine', type: 'type', priority: 'priorité', status: 'statut', assignee: 'assigné',
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActiveTask((e.active.data.current?.task as Task) || null)}
      onDragEnd={handleDragEnd}
    >
      <div className="planning-hint">
        ↔ Glissez une tâche d'une colonne à l'autre pour changer son <b>&nbsp;{dimLabel[dimension] || dimension}</b>.
      </div>
      <div className="planning-scroll">
        <div className="planning-cols">
          {groups.map((g) => (
            <PlanningColumn
              key={g.key}
              groupKey={g.key}
              label={g.label}
              color={g.color}
              tasks={g.tasks}
              taxonomies={taxonomies}
              isCurrent={dimension === 'sprint' && g.key === currentSprintKey}
              onOpen={onOpen}
            />
          ))}
          {groups.length === 0 && <div className="empty">Aucune tâche ne correspond aux filtres.</div>}
        </div>
      </div>
      <DragOverlay>{activeTask && <TaskCard task={activeTask} taxonomies={taxonomies} onOpen={() => {}} />}</DragOverlay>
    </DndContext>
  );
}
