import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Task, TaxonomyItem } from '../../types';
import { useCreateTask, useSubtasks, useUpdateTask } from '../../api/tasks';
import { errorMessage } from '../../api/client';
import { metaOf } from '../../utils/format';
import Avatar from '../common/Avatar';
import TaskPicker from '../common/TaskPicker';

/*
 * Hierarchy of a task (module / package / epic → sous-tâches): breadcrumb of its
 * ancestors, progress roll-up, children list, quick creation (inheriting the
 * planning fields of the parent) and attachment of existing tasks.
 */
export default function SubtaskPanel({
  projectKey,
  task,
  taxonomies,
  readOnly,
  onOpenTask,
}: {
  projectKey: string;
  task: Task;
  taxonomies: TaxonomyItem[] | undefined;
  readOnly?: boolean;
  onOpenTask?: (taskId: string) => void;
}) {
  const { data, isLoading } = useSubtasks(projectKey, task.taskId);
  const createTask = useCreateTask(projectKey);
  const updateTask = useUpdateTask(projectKey);
  const [title, setTitle] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtasks = data?.subtasks || [];
  const rollup = data?.rollup;
  const percent = rollup && rollup.total ? Math.round((rollup.done / rollup.total) * 100) : 0;

  const open = (taskId: string, label: ReactNode) =>
    onOpenTask ? (
      <button type="button" className="link-btn mono" onClick={() => onOpenTask(taskId)}>
        {label}
      </button>
    ) : (
      <Link className="mono" to={`/projects/${projectKey}/tasks/${taskId}`}>
        {label}
      </Link>
    );

  function quickAdd() {
    const t = title.trim();
    if (!t) return;
    setError(null);
    // The sub-task lands where its parent is planned.
    createTask.mutate(
      {
        title: t,
        parent: task.taskId,
        sprint: task.sprint ?? null,
        version: task.version,
        category: task.category,
        techno: task.techno,
        area: task.area,
        priority: task.priority,
      },
      { onSuccess: () => setTitle(''), onError: (e) => setError(errorMessage(e)) }
    );
  }

  function setParent(child: string, parent: string | null, note: string) {
    setError(null);
    updateTask.mutate({ taskId: child, data: { parent, note } }, { onError: (e) => setError(errorMessage(e)) });
  }

  return (
    <div className="subtasks">
      {data && data.ancestors.length > 0 && (
        <nav className="subtasks__crumbs" aria-label="Hiérarchie">
          {[...data.ancestors].reverse().map((a) => (
            <span key={a.taskId} className="subtasks__crumb">
              {open(a.taskId, a.taskId)} <span className="text-muted">{a.title}</span> ›
            </span>
          ))}
          <span className="mono subtasks__self">{task.taskId}</span>
        </nav>
      )}

      {rollup && rollup.total > 0 && (
        <div className="subtasks__rollup" title={`${rollup.done} / ${rollup.total} sous-tâche(s) terminée(s)`}>
          <span>
            <b>{rollup.done}</b>/{rollup.total} terminée{rollup.done > 1 ? 's' : ''} · {rollup.donePoints}/{rollup.points} pts
          </span>
          <span className="progress">
            <span className={`progress__bar${percent === 100 ? ' complete' : ''}`} style={{ width: `${percent}%` }} />
          </span>
          <span className="mono">{percent}%</span>
        </div>
      )}

      {isLoading && <div className="text-muted small-text">Chargement…</div>}
      {!isLoading && subtasks.length === 0 && (
        <div className="text-muted small-text">Aucune sous-tâche. Découpez un module, un package ou une story en tâches livrables.</div>
      )}

      <ul className="subtasks__list">
        {subtasks.map((s) => {
          const status = metaOf(taxonomies, 'status', s.status);
          const stats = data?.subtaskStats[s.taskId];
          return (
            <li key={s.taskId} className="subtask">
              <span className="col__dot" style={{ background: status.color }} title={status.label} />
              {open(s.taskId, s.taskId)}
              <span className="subtask__title" title={s.title}>
                {s.title}
              </span>
              {stats && (
                <span className="tag" title="Sous-tâches terminées">
                  ⊟ {stats.done}/{stats.total}
                </span>
              )}
              <span className="tag" style={{ borderColor: status.color, color: status.color }}>
                {status.label}
              </span>
              <span className="tag pts">{s.complexity} pts</span>
              {s.assignee ? <Avatar name={s.assignee.displayName} color={s.assignee.color} size="sm" /> : <span className="avatar-placeholder" />}
              {!readOnly && (
                <button type="button" className="icon-btn" title="Détacher (la tâche est conservée)" onClick={() => setParent(s.taskId, null, `Détachée de ${task.taskId}.`)}>
                  ⤴
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {!readOnly && (
        <div className="subtasks__add">
          <input
            type="text"
            value={title}
            placeholder="Nouvelle sous-tâche… (Entrée pour créer)"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                quickAdd();
              }
            }}
          />
          <button type="button" className="btn small primary" disabled={!title.trim() || createTask.isPending} onClick={quickAdd}>
            + Créer
          </button>
          <button type="button" className={`btn small${attaching ? '' : ' ghost'}`} onClick={() => setAttaching((a) => !a)}>
            Rattacher une tâche existante
          </button>
        </div>
      )}
      {attaching && !readOnly && (
        <TaskPicker
          projectKey={projectKey}
          taxonomies={taxonomies}
          autoFocus
          exclude={[task.taskId, ...(data?.ancestors.map((a) => a.taskId) || []), ...subtasks.map((s) => s.taskId)]}
          onPick={(picked) => {
            if (picked) setParent(picked.taskId, task.taskId, `Rattachée à ${task.taskId}.`);
            setAttaching(false);
          }}
        />
      )}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
