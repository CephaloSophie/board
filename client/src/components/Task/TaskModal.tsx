import { useEffect, useState } from 'react';
import { useTask } from '../../api/tasks';
import { useTaxonomies } from '../../api/taxonomies';
import TaskDetail from './TaskDetail';

// Task popup. Parent / sub-task links open in place, with a way back.
export default function TaskModal({
  projectKey,
  taskId,
  onClose,
}: {
  projectKey: string;
  taskId: string;
  onClose: () => void;
}) {
  const [stack, setStack] = useState<string[]>([taskId]);
  const current = stack[stack.length - 1];
  const { data: task, isLoading, isError } = useTask(projectKey, current);
  const { data: taxonomies } = useTaxonomies(projectKey);

  useEffect(() => setStack([taskId]), [taskId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Leave Escape to editors, pickers and dialogs that are focused inside the popup.
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide task-modal" role="dialog" aria-modal="true" aria-label={task ? `${task.taskId} · ${task.title}` : 'Tâche'}>
        {stack.length > 1 && (
          <button className="btn ghost small task-modal__back" onClick={() => setStack((s) => s.slice(0, -1))}>
            ← Retour à {stack[stack.length - 2]}
          </button>
        )}
        {isError ? (
          <div className="empty">Tâche introuvable ou inaccessible.</div>
        ) : isLoading || !task ? (
          <div className="loadbox">Chargement…</div>
        ) : (
          <TaskDetail
            projectKey={projectKey}
            task={task}
            taxonomies={taxonomies}
            onClose={onClose}
            onOpenTask={(id) => id !== current && setStack((s) => [...s, id])}
          />
        )}
      </div>
    </div>
  );
}
