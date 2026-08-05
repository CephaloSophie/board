import { useDroppable } from '@dnd-kit/core';
import type { Task, TaxonomyItem } from '../../types';
import TaskCard from './TaskCard';
import { metaOf } from '../../utils/format';

export default function StatusColumn({
  statusKey,
  tasks,
  taxonomies,
  onOpen,
}: {
  statusKey: string;
  tasks: Task[];
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: statusKey, data: { status: statusKey } });
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
