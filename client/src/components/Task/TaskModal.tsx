import { useTask } from '../../api/tasks';
import { useTaxonomies } from '../../api/taxonomies';
import TaskDetail from './TaskDetail';

export default function TaskModal({
  projectKey,
  taskId,
  onClose,
}: {
  projectKey: string;
  taskId: string;
  onClose: () => void;
}) {
  const { data: task, isLoading } = useTask(projectKey, taskId);
  const { data: taxonomies } = useTaxonomies(projectKey);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        {isLoading || !task ? (
          <div className="loadbox">Chargement…</div>
        ) : (
          <TaskDetail projectKey={projectKey} task={task} taxonomies={taxonomies} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
