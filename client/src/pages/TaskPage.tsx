import { Link, useParams } from 'react-router-dom';
import { useTask } from '../api/tasks';
import { useTaxonomies } from '../api/taxonomies';
import TaskDetail from '../components/Task/TaskDetail';

export default function TaskPage() {
  const { projectKey, taskId } = useParams();
  const { data: task, isLoading } = useTask(projectKey, taskId);
  const { data: taxonomies } = useTaxonomies(projectKey);

  return (
    <main className="board-main" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ padding: '14px 0' }}>
        <Link className="btn ghost small" to={`/projects/${projectKey}/board`}>
          ← Retour au board
        </Link>
      </div>
      <div className="admin-panel">
        {isLoading || !task || !projectKey ? (
          <div className="loadbox">Chargement…</div>
        ) : (
          <TaskDetail projectKey={projectKey} task={task} taxonomies={taxonomies} standalone />
        )}
      </div>
    </main>
  );
}
