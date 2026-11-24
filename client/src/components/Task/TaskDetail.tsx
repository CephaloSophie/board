import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Task, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useUpdateTask, useDeleteTask, useSubtasks, type TaskPatch } from '../../api/tasks';
import { errorMessage } from '../../api/client';
import { useAssignableUsers } from '../../api/members';
import { useProjectLabels } from '../../api/projects';
import { metaOf } from '../../utils/format';
import { fmtDay, toDateInput } from '../../utils/dates';
import { useAuth } from '../../context/AuthContext';
import { useProjectRole } from '../../hooks/useProjectRole';
import Avatar from '../common/Avatar';
import LabelsInput from '../common/LabelsInput';
import RichText from '../common/RichText';
import RichTextEditor from '../common/RichTextEditor';
import { useProjectPeople } from '../../hooks/useProjectPeople';
import CommentList from './CommentList';
import HistoryList from './HistoryList';
import AddToEventPopup from './AddToEventPopup';
import TaskCriteria from './TaskCriteria';
import TaskMergeRequests from './MergeRequestList';
import SubtaskPanel from './SubtaskPanel';
import TaskPicker from '../common/TaskPicker';

// Fields that live in the left sidebar of the detail view (Jira-style).
const SIDE_DIMENSIONS = [
  { field: 'sprint', kind: 'sprint', label: 'Sprint' },
  { field: 'status', kind: 'status', label: 'Statut' },
  { field: 'priority', kind: 'priority', label: 'Priorité' },
  { field: 'version', kind: 'version', label: 'Version' },
  { field: 'type', kind: 'type', label: 'Type' },
  { field: 'category', kind: 'category', label: 'Catégorie' },
  { field: 'techno', kind: 'techno', label: 'Techno' },
  { field: 'area', kind: 'area', label: 'Domaine' },
] as const;

export default function TaskDetail({
  projectKey,
  task,
  taxonomies,
  onClose,
  standalone,
  onOpenTask,
}: {
  projectKey: string;
  task: Task;
  taxonomies: TaxonomyItem[] | undefined;
  onClose?: () => void;
  standalone?: boolean;
  // Navigate to another task in place (parent, sub-task) instead of leaving the page.
  onOpenTask?: (taskId: string) => void;
}) {
  const { user } = useAuth();
  const { canWrite, isAdmin } = useProjectRole(projectKey);
  const { data: users } = useAssignableUsers(projectKey);
  const { data: labelOptions } = useProjectLabels(projectKey);
  const updateTask = useUpdateTask(projectKey);
  const deleteTask = useDeleteTask(projectKey);

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [instructions, setInstructions] = useState(task.instructions.join('\n'));
  const [complexity, setComplexity] = useState(String(task.complexity ?? 0));
  const [duration, setDuration] = useState(task.duration || '');
  const [estimate, setEstimate] = useState(task.estimate || '');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { data: tree } = useSubtasks(projectKey, task.taskId);
  const [editingText, setEditingText] = useState(false);
  const [addingToEvent, setAddingToEvent] = useState(false);
  const [activityTab, setActivityTab] = useState<'comments' | 'history'>('comments');
  const people = useProjectPeople(projectKey);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setInstructions(task.instructions.join('\n'));
    setComplexity(String(task.complexity ?? 0));
    setDuration(task.duration || '');
    setEstimate(task.estimate || '');
    setFieldError(null);
    setEditingText(false);
  }, [task._id]);

  function field(name: string, value: unknown) {
    if (!canWrite) return;
    setFieldError(null);
    updateTask.mutate({ taskId: task.taskId, data: { [name]: value } as TaskPatch }, { onError: (e) => setFieldError(errorMessage(e)) });
  }

  function copyLink() {
    const url = `${window.location.origin}/projects/${projectKey}/tasks/${task.taskId}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function saveText() {
    updateTask.mutate({
      taskId: task.taskId,
      data: {
        title,
        description,
        instructions: instructions.split('\n').map((s) => s.trim()).filter(Boolean),
        complexity: Number(complexity) || 0,
        duration,
        estimate,
      },
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
    Number(complexity) !== task.complexity ||
    duration !== (task.duration || '') ||
    estimate !== (task.estimate || '');

  // Ordered list of sprints — used both to render the sprint select and to
  // compute what "previous / next sprint" means for the shift buttons.
  const orderedSprints = useMemo(() => taxonomiesByKind(taxonomies, 'sprint'), [taxonomies]);
  const currentSprintIdx = orderedSprints.findIndex((s) => s.key === task.sprint);
  const prevSprint = currentSprintIdx > 0 ? orderedSprints[currentSprintIdx - 1] : null;
  const nextSprint =
    currentSprintIdx >= 0 && currentSprintIdx < orderedSprints.length - 1
      ? orderedSprints[currentSprintIdx + 1]
      : orderedSprints.length && currentSprintIdx === -1
      ? orderedSprints[0]
      : null;
  const statusMeta = metaOf(taxonomies, 'status', task.status);
  const priorityMeta = metaOf(taxonomies, 'priority', task.priority);

  return (
    <div>
      <div className="modal-head">
        <div style={{ flex: 1 }}>
          <div className="m-id">
            {task.taskId} {task.spec ? `· ${task.spec}` : ''}
            {task.external?.key && (
              <span className="tag" title="Clé d'origine (import)" style={{ marginLeft: 6 }}>
                {task.external.source || 'externe'} : {task.external.url ? <a href={task.external.url} target="_blank" rel="noreferrer">{task.external.key}</a> : task.external.key}
              </span>
            )}
          </div>
          {editingText ? (
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontSize: 17, fontWeight: 700, width: '100%' }} />
          ) : (
            <h3>{task.title}</h3>
          )}
        </div>
        <div className="row">
          {canWrite && (
            <button className="btn ghost small" onClick={() => setAddingToEvent(true)} title="Ajouter à un rituel / événement">
              ⊕ Rituel
            </button>
          )}
          <button className="btn ghost small" onClick={copyLink} title="Copier le lien de la tâche">
            {copied ? '✓ Copié' : '🔗 Lien'}
          </button>
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

      {addingToEvent && (
        <AddToEventPopup projectKey={projectKey} task={task} taxonomies={taxonomies} onClose={() => setAddingToEvent(false)} />
      )}

      <div className="task-layout">
        {/* ---------- Sidebar: metadata (like Jira) ---------- */}
        <aside className="task-side">
          <h4 style={{ marginTop: 0 }}>Détails</h4>

          <div className="field">
            <label>Assigné</label>
            <select value={task.assignee?._id || ''} disabled={!canWrite} onChange={(e) => field('assignee', e.target.value || null)}>
              <option value="">Non assigné</option>
              {task.assignee && !(users || []).some((u) => u.id === task.assignee?._id) && (
                <option value={task.assignee._id}>{task.assignee.displayName}</option>
              )}
              {(users || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === user?.id ? `Moi (${u.displayName})` : u.displayName}
                </option>
              ))}
            </select>
            {!task.assignee && task.external?.assigneeName && (
              <span className="hint">Assigné d'origine : {task.external.assigneeName}</span>
            )}
            {canWrite && user && task.assignee?._id !== user.id && (
              <button className="btn small" style={{ marginTop: 4 }} onClick={() => field('assignee', user.id)}>
                M'assigner
              </button>
            )}
          </div>

          {SIDE_DIMENSIONS.map(({ field: f, kind, label }) => {
            const items = taxonomiesByKind(taxonomies, kind);
            const current = (task as unknown as Record<string, unknown>)[f] as string | undefined;
            return (
              <div className="field" key={f}>
                <label>{label}</label>
                <select value={current || ''} disabled={!canWrite} onChange={(e) => field(f, e.target.value || null)}>
                  <option value="">{f === 'sprint' ? 'Backlog (sans sprint)' : '—'}</option>
                  {items.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.label}
                    </option>
                  ))}
                  {current && !items.find((i) => i.key === current) && <option value={current}>{metaOf(taxonomies, kind, current).label}</option>}
                </select>
                {canWrite && f === 'sprint' && (prevSprint || nextSprint) && (
                  <div className="sprint-shift">
                    <button
                      className="btn small"
                      disabled={!prevSprint}
                      onClick={() => prevSprint && field('sprint', prevSprint.key)}
                      title={prevSprint ? `Vers ${prevSprint.label}` : 'Aucun sprint précédent'}
                    >
                      ← Précédent
                    </button>
                    <button
                      className="btn small"
                      disabled={!nextSprint}
                      onClick={() => nextSprint && field('sprint', nextSprint.key)}
                      title={nextSprint ? `Vers ${nextSprint.label}` : 'Aucun sprint suivant'}
                    >
                      Suivant →
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="field">
            <label>Étiquettes</label>
            <LabelsInput
              value={task.labels || []}
              disabled={!canWrite}
              suggestions={(labelOptions || []).map((l) => l.value)}
              onChange={(labels) => field('labels', labels)}
            />
          </div>

          <div className="field">
            <label>Points</label>
            <input
              type="number"
              min={0}
              step="0.5"
              value={complexity}
              disabled={!canWrite}
              onChange={(e) => setComplexity(e.target.value)}
              onBlur={() => Number(complexity) !== task.complexity && field('complexity', Number(complexity) || 0)}
            />
          </div>
          <div className="field">
            <label>Échéance</label>
            <input type="date" value={toDateInput(task.dueDate)} disabled={!canWrite} onChange={(e) => field('dueDate', e.target.value || null)} />
          </div>
          <div className="field">
            <label>Tâche parente</label>
            <TaskPicker
              projectKey={projectKey}
              taxonomies={taxonomies}
              disabled={!canWrite}
              value={task.parent ? { taskId: task.parent, title: tree?.ancestors[0]?.taskId === task.parent ? tree.ancestors[0].title : undefined } : null}
              exclude={[task.taskId, ...(tree?.subtasks.map((s) => s.taskId) || [])]}
              placeholder="Module, package, epic…"
              onPick={(picked) => field('parent', picked ? picked.taskId : null)}
            />
            {task.parent &&
              (onOpenTask ? (
                <button className="link-btn hint" onClick={() => onOpenTask(task.parent!)}>
                  Ouvrir {task.parent} ↗
                </button>
              ) : (
                <Link className="hint" to={`/projects/${projectKey}/tasks/${task.parent}`}>
                  Ouvrir {task.parent} ↗
                </Link>
              ))}
          </div>
          <div className="field">
            <label>Estimation</label>
            <input
              type="text"
              value={estimate}
              disabled={!canWrite}
              onChange={(e) => setEstimate(e.target.value)}
              onBlur={() => estimate !== (task.estimate || '') && field('estimate', estimate)}
              placeholder="4h"
            />
          </div>
          <div className="field">
            <label>Durée réelle</label>
            <input
              type="text"
              value={duration}
              disabled={!canWrite}
              onChange={(e) => setDuration(e.target.value)}
              onBlur={() => duration !== (task.duration || '') && field('duration', duration)}
              placeholder="4 h"
            />
          </div>

          {task.reporter && (
            <div className="field">
              <label>Rapporteur</label>
              <div className="row">
                <Avatar name={task.reporter.displayName} color={task.reporter.color} size="sm" />
                <span style={{ fontSize: 12 }}>{task.reporter.displayName}</span>
              </div>
            </div>
          )}
          {fieldError && <div className="form-error">{fieldError}</div>}
          <div className="task-dates">
            <div>Créée le {fmtDay(task.createdAt)}</div>
            <div>Modifiée le {fmtDay(task.updatedAt)}</div>
            {task.resolvedAt && <div>Résolue le {fmtDay(task.resolvedAt)}</div>}
          </div>
        </aside>

        {/* ---------- Main content ---------- */}
        <div className="task-main">
          <div className="m-row">
            <span className="tag" style={{ borderColor: statusMeta.color, color: statusMeta.color }}>
              {statusMeta.label}
            </span>
            {task.priority && (
              <span className="tag" style={{ borderColor: priorityMeta.color, color: priorityMeta.color }}>
                {task.priority} · {priorityMeta.label}
              </span>
            )}
            {task.assignee && (
              <span className="tag">
                <Avatar name={task.assignee.displayName} color={task.assignee.color} size="sm" /> {task.assignee.displayName}
              </span>
            )}
            {(task.labels || []).map((l) => (
              <span key={l} className="label-chip">
                {l}
              </span>
            ))}
          </div>

          <div className="m-sec">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h4 style={{ margin: 0 }}>Description &amp; contenu</h4>
              {canWrite &&
                (!editingText ? (
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
                ))}
            </div>

            {editingText ? (
              <div className="stack" style={{ marginTop: 8 }}>
                <div className="field">
                  <label>Description</label>
                  <RichTextEditor
                    value={description}
                    onChange={setDescription}
                    projectKey={projectKey}
                    taskId={task.taskId}
                    rows={10}
                    placeholder="Contexte, captures d'écran, @mentions…"
                  />
                </div>
                <div className="field">
                  <label>Instructions (une par ligne)</label>
                  <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
                </div>
              </div>
            ) : (
              <>
                <RichText
                  text={task.description}
                  projectKey={projectKey}
                  mentionLabel={people.mentionLabel}
                  empty={<p className="text-muted">Aucune description.</p>}
                />
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
              </>
            )}
          </div>

          <section className="m-sec task-section">
            <h4>
              Critères d'acceptation
              {task.criteria && task.criteria.length > 0 && (
                <span className="task-section__count">
                  {task.criteria.filter((c) => c.done).length}/{task.criteria.length}
                </span>
              )}
            </h4>
            <TaskCriteria projectKey={projectKey} task={task} readOnly={!canWrite} />
          </section>

          <section className="m-sec task-section">
            <h4>
              Sous-tâches
              {tree && tree.rollup.total > 0 && (
                <span className="task-section__count">
                  {tree.rollup.done}/{tree.rollup.total}
                </span>
              )}
            </h4>
            <SubtaskPanel projectKey={projectKey} task={task} taxonomies={taxonomies} readOnly={!canWrite} onOpenTask={onOpenTask} />
          </section>

          <section className="m-sec task-section">
            <h4>
              Merge requests
              {(task.mergeRequests?.length || 0) > 0 && <span className="task-section__count">{task.mergeRequests!.length}</span>}
            </h4>
            <TaskMergeRequests projectKey={projectKey} task={task} readOnly={!canWrite} />
          </section>

          <div className="m-sec">
            <div className="activity-tabs">
              <h4 style={{ margin: 0 }}>Activité</h4>
              <div className="view-switcher">
                <button className={activityTab === 'comments' ? 'active' : ''} onClick={() => setActivityTab('comments')}>
                  Commentaires ({task.comments.length})
                </button>
                <button className={activityTab === 'history' ? 'active' : ''} onClick={() => setActivityTab('history')}>
                  Historique ({task.history.length})
                </button>
              </div>
            </div>
            {activityTab === 'comments' ? (
              <CommentList projectKey={projectKey} task={task} readOnly={!canWrite} />
            ) : (
              <HistoryList history={task.history} taxonomies={taxonomies} userName={people.userName} />
            )}
          </div>

          {isAdmin && (
            <div className="m-sec">
              <button className="btn danger small" onClick={handleDelete}>
                Supprimer la tâche
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
