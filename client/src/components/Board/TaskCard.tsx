import { useDraggable } from '@dnd-kit/core';
import type { Task, TaxonomyItem } from '../../types';
import { metaOf } from '../../utils/format';
import Avatar from '../common/Avatar';

export default function TaskCard({
  task,
  taxonomies,
  onOpen,
}: {
  task: Task;
  taxonomies: TaxonomyItem[] | undefined;
  onOpen: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.taskId,
    data: { task },
  });
  const pm = metaOf(taxonomies, 'priority', task.priority);

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 10 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`card${isDragging ? ' dragging' : ''}`}
      onClick={() => !isDragging && onOpen(task.taskId)}
    >
      <div className="card__top">
        <span className="card__id">{task.taskId}</span>
        {task.priority && (
          <span className="card__pri" style={{ background: `${pm.color}22`, color: pm.color }}>
            {task.priority}
          </span>
        )}
      </div>
      <div className="card__title">{task.title}</div>
      <div className="card__tags">
        {task.type && <span className="tag type">{task.type}</span>}
        {task.category && <span className="tag">{task.category}</span>}
        {task.techno && <span className="tag">{task.techno}</span>}
        <span className="tag pts">{task.complexity} pts</span>
        {task.duration && <span className="tag dur">{task.duration}</span>}
        {task.version && <span className="tag">v{task.version}</span>}
        {task.assignee && (
          <span className="card__assignee">
            <Avatar name={task.assignee.displayName} color={task.assignee.color} size="sm" />
          </span>
        )}
      </div>
    </div>
  );
}
