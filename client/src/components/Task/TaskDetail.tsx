import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useUpdateTask, useDeleteTask } from '../../api/tasks';
import { useUsers } from '../../api/users';
import { metaOf } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../common/Avatar';
import CommentList from './CommentList';
import HistoryList from './HistoryList';

const SELECT_DIMENSIONS = [
  { field: 'status', kind: 'status', label: 'Statut' },
  { field: 'priority', kind: 'priority', label: 'Priorité' },
  { field: 'type', kind: 'type', label: 'Type' },
  { field: 'category', kind: 'category', label: 'Catégorie' },
  { field: 'techno', kind: 'techno', label: 'Techno' },
  { field: 'area', kind: 'area', label: 'Domaine' },
  { field: 'version', kind: 'version', label: 'Version' },
  { field: 'sprint', kind: 'sprint', label: 'Sprint' },
] as const;

export default function TaskDetail({
  projectKey,
  task,
  taxonomies,
  onClose,
  standalone,
}: {
  projectKey: string;
  task: Task;
  taxonomies: TaxonomyItem[] | undefined;
  onClose?: () => void;
  standalone?: boolean;
}) {
  const { user } = useAuth();
  const { data: users } = useUsers();
  const updateTask = useUpdateTask(projectKey);
  const deleteTask = useDeleteTask(projectKey);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [instructions, setInstructions] = useState(task.instructions.join('\n'));
  const [acceptance, setAcceptance] = useState(task.acceptance.join('\n'));
  const [complexity, setComplexity] = useState(String(task.complexity ?? 0));
  const [duration, setDuration] = useState(task.duration || '');
  const [editingText, setEditingText] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setInstructions(task.instructions.join('\n'));
    setAcceptance(task.acceptance.join('\n'));
    setComplexity(String(task.complexity ?? 0));
    setDuration(task.duration || '');
    setEditingText(false);
  }, [task._id]);

  function field(field: string, value: unknown) {
    updateTask.mutate({ taskId: task.taskId, data: { [field]: value } as any });
  }

  function saveText() {
    updateTask.mutate({
      taskId: task.taskId,
      data: {
        title,
        description,
        instructions: instructions.split('\n').map((s) => s.trim()).filter(Boolean),
        acceptance: acceptance.split('\n').map((s) => s.trim()).filter(Boolean),
        complexity: Number(complexity) || 0,
        duration,
      } as any,
    });
    setEditingText(false);
  }

  function handleDelete() {
    if (!confirm(`Supprimer définitivement ${task.taskId} ?`)) return;
    deleteTask.mutate(task.taskId, { onSuccess: onClose });
  }

  const dirty =
    title !== task.title ||
    description !== task.description ||
    instructions !== task.instructions.join('\n') ||
    acceptance !== task.acceptance.join('\n') ||
    Number(complexity) !== task.complexity ||
    duration !== (task.duration || '');

  return (
    <div>
      <div className="modal-head">
        <div>
          <div className="m-id">
            {task.taskId} {task.spec ? `· ${task.spec}` : ''}
          </div>
          {editingText ? (
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: 17, fontWeight: 700, width: '100%' }} />
          ) : (
            <h3>{task.title}</h3>
          )}
        </div>
        <div className="row">
          {!standalone && (
            <Link className="btn ghost small" to={`/projects/${projectKey}/tasks/${task.taskId}`}>
              Page dédiée ↗
            </Link>
          )}
          {onClose && (
            <button className="close-btn" onClick={onClose}>
              Fermer ✕
            </button>
          )}
        </div>
      </div>

      <div className="field-grid">
        {SELECT_DIMENSIONS.map(({ field: f, kind, label }) => {
          const items = taxonomiesByKind(taxonomies, kind);
          const current = (task as any)[f] as string | undefined;
          return (
            <div className="field" key={f}>
              <label>{label}</label>
              <select value={current || ''} onChange={(e) => field(f, e.target.value || null)}>
                <option value="">—</option>
                {items.map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.label}
                  </option>
                ))}
                {current && !items.find((i) => i.key === current) && <option value={current}>{current}</option>}
              </select>
            </div>
          );
        })}

        <div className="field">
          <label>Assigné</label>
          <select value={task.assignee?._id || ''} onChange={(e) => field('assignee', e.target.value || null)}>
            <option value="">Non assigné</option>
            {user && (
              <option value={user.id}>Moi ({user.displayName})</option>
            )}
            {(users || [])
              .filter((u) => u.id !== user?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
          </select>
        </div>

        <div className="field">
          <label>Points</label>
          <input
            type="number"
            min={0}
            value={complexity}
            onChange={(e) => setComplexity(e.target.value)}
            onBlur={() => Number(complexity) !== task.complexity && field('complexity', Number(complexity) || 0)}
          />
        </div>
        <div className="field">
          <label>Durée</label>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onBlur={() => duration !== (task.duration || '') && field('duration', duration)}
            placeholder="4 h"
          />
        </div>
      </div>

      <div className="m-row">
        {task.reporter && (
          <span className="tag">
            Rapporteur : {typeof task.reporter === 'object' ? task.reporter.displayName : task.reporter}
          </span>
        )}
        {task.assignee && (
          <span className="tag">
            <Avatar name={task.assignee.displayName} color={task.assignee.color} size="sm" /> {task.assignee.displayName}
          </span>
        )}
      </div>

      <div className="m-sec">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h4 style={{ margin: 0 }}>Description &amp; contenu</h4>
          {!editingText ? (
            <button className="btn ghost small" onClick={() => setEditingText(true)}>
              Modifier
            </button>
          ) : (
            <div className="row">
              <button className="btn ghost small" onClick={() => setEditingText(false)}>
                Annuler
              </button>
              <button className="btn primary small" onClick={saveText} disabled={!dirty}>
                Enregistrer
              </button>
            </div>
          )}
        </div>

        {editingText ? (
          <div className="stack" style={{ marginTop: 8 }}>
            <div className="field">
              <label>Description</label>
              <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field">
              <label>Instructions (une par ligne)</label>
              <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
            </div>
            <div className="field">
              <label>Critères d'acceptation (un par ligne)</label>
              <textarea rows={3} value={acceptance} onChange={(e) => setAcceptance(e.target.value)} />
            </div>
          </div>
        ) : (
          <>
            {task.description && <p>{task.description}</p>}
            {task.instructions.length > 0 && (
              <>
                <h4>Instructions</h4>
                <ul>
                  {task.instructions.map((i, idx) => (
                    <li key={idx}>{i}</li>
                  ))}
                </ul>
              </>
            )}
            {task.acceptance.length > 0 && (
              <>
                <h4>Critères d'acceptation</h4>
                <ul>
                  {task.acceptance.map((a, idx) => (
                    <li key={idx}>{a}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      <div className="m-sec">
        <h4>Commentaires</h4>
        <CommentList projectKey={projectKey} task={task} />
      </div>

      <div className="m-sec">
        <h4>Historique</h4>
        <HistoryList history={task.history} taxonomies={taxonomies} />
      </div>

      <div className="m-sec">
        <button className="btn danger small" onClick={handleDelete}>
          Supprimer la tâche
        </button>
      </div>
    </div>
  );
}
