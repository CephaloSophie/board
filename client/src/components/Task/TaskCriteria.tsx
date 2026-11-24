import { useState } from 'react';
import type { Criterion, CriterionComment, Task } from '../../types';
import { useCriteriaActions } from '../../api/tasks';
import { errorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useProjectRole } from '../../hooks/useProjectRole';
import { useProjectPeople } from '../../hooks/useProjectPeople';
import { fmtDate } from '../../utils/format';
import { fmtRelative } from '../../utils/dates';
import Avatar from '../common/Avatar';
import RichText from '../common/RichText';
import RichTextEditor from '../common/RichTextEditor';
import AcceptanceEditor, { type CriterionItem } from './AcceptanceEditor';

const userOf = (v: Criterion['doneBy'] | CriterionComment['author']) => (typeof v === 'object' && v ? v : null);

// Server-backed acceptance criteria of an existing task (each action is saved and traced at once).
export default function TaskCriteria({ projectKey, task, readOnly }: { projectKey: string; task: Task; readOnly?: boolean }) {
  const actions = useCriteriaActions(projectKey);
  const [error, setError] = useState<string | null>(null);
  const criteria = task.criteria || [];
  const taskId = task.taskId;

  const run = <T,>(p: Promise<T>) => {
    setError(null);
    return p.catch((e) => {
      setError(errorMessage(e));
      throw e;
    });
  };

  const items: CriterionItem[] = criteria.map((c) => ({
    id: c._id,
    text: c.text,
    done: c.done,
    doneAt: c.doneAt,
    doneLabel: userOf(c.doneBy)?.displayName || null,
    commentCount: c.comments?.length || 0,
  }));
  const busy = actions.add.isPending || actions.update.isPending || actions.remove.isPending || actions.reorder.isPending;

  return (
    <AcceptanceEditor
      projectKey={projectKey}
      taskId={taskId}
      items={items}
      readOnly={readOnly}
      busy={busy}
      error={error}
      onAdd={(list, position) => run(actions.add.mutateAsync({ taskId, items: list, position }))}
      onUpdate={(criterionId, patch) => run(actions.update.mutateAsync({ taskId, criterionId, ...patch }))}
      onDelete={(criterionId) => run(actions.remove.mutateAsync({ taskId, criterionId })).catch(() => undefined)}
      onReorder={(ids) => run(actions.reorder.mutateAsync({ taskId, ids })).catch(() => undefined)}
      renderComments={(item) => {
        const criterion = criteria.find((c) => c._id === item.id);
        return criterion ? <CriterionThread projectKey={projectKey} taskId={taskId} criterion={criterion} readOnly={readOnly} /> : null;
      }}
    />
  );
}

function CriterionThread({ projectKey, taskId, criterion, readOnly }: { projectKey: string; taskId: string; criterion: Criterion; readOnly?: boolean }) {
  const { addComment } = useCriteriaActions(projectKey);
  const people = useProjectPeople(projectKey);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!text.trim()) return;
    setError(null);
    addComment.mutate({ taskId, criterionId: criterion._id, text }, { onSuccess: () => setText(''), onError: (e) => setError(errorMessage(e)) });
  }

  return (
    <div className="criterion-thread">
      {criterion.comments.length === 0 && <div className="text-muted small-text">Aucun commentaire sur ce critère : notez le résultat du test, une capture, un lien…</div>}
      {criterion.comments.map((c) => (
        <CriterionCommentItem key={c._id} projectKey={projectKey} taskId={taskId} criterionId={criterion._id} comment={c} readOnly={readOnly} mentionLabel={people.mentionLabel} />
      ))}
      {!readOnly && (
        <div className="stack" style={{ gap: 6 }}>
          <RichTextEditor
            value={text}
            onChange={setText}
            projectKey={projectKey}
            taskId={taskId}
            rows={2}
            showHint={false}
            placeholder="Commenter ce critère… (images, liens, @mentions)"
            onSubmit={submit}
          />
          {error && <div className="form-error">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn primary small" disabled={!text.trim() || addComment.isPending} onClick={submit}>
              Commenter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CriterionCommentItem({
  projectKey,
  taskId,
  criterionId,
  comment,
  readOnly,
  mentionLabel,
}: {
  projectKey: string;
  taskId: string;
  criterionId: string;
  comment: CriterionComment;
  readOnly?: boolean;
  mentionLabel: (username: string) => string | undefined;
}) {
  const { user } = useAuth();
  const { isAdmin } = useProjectRole(projectKey);
  const { editComment, removeComment } = useCriteriaActions(projectKey);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [error, setError] = useState<string | null>(null);
  const author = userOf(comment.author);
  const canModify = !readOnly && ((!!author && author._id === user?.id) || isAdmin);
  const onError = (e: unknown) => setError(errorMessage(e));

  function save() {
    if (!draft.trim()) return;
    editComment.mutate({ taskId, criterionId, commentId: comment._id, text: draft }, { onSuccess: () => setEditing(false), onError });
  }

  return (
    <div className="comment criterion-comment">
      <Avatar name={author?.displayName || '?'} color={author?.color || '#6b7280'} size="sm" />
      <div className="comment__main">
        <div className="comment__body">
          <div className="comment__meta">
            <b>{author?.displayName || 'Utilisateur'}</b>
            <span title={fmtDate(comment.createdAt)}>{fmtRelative(comment.createdAt)}</span>
            {comment.editedAt && <span title={fmtDate(comment.editedAt)}>(modifié)</span>}
          </div>
          {editing ? (
            <div className="stack" style={{ gap: 6 }}>
              <RichTextEditor value={draft} onChange={setDraft} projectKey={projectKey} taskId={taskId} rows={2} autoFocus showHint={false} onSubmit={save} onCancel={() => setEditing(false)} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button type="button" className="btn ghost small" onClick={() => setEditing(false)}>
                  Annuler
                </button>
                <button type="button" className="btn primary small" disabled={!draft.trim() || editComment.isPending} onClick={save}>
                  Enregistrer
                </button>
              </div>
            </div>
          ) : (
            <RichText text={comment.text} projectKey={projectKey} mentionLabel={mentionLabel} />
          )}
        </div>
        {canModify && !editing && (
          <div className="comment__actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setDraft(comment.text);
                setEditing(true);
              }}
            >
              Modifier
            </button>
            <button
              type="button"
              className="link-btn danger"
              onClick={() => confirm('Supprimer ce commentaire ?') && removeComment.mutate({ taskId, criterionId, commentId: comment._id }, { onError })}
            >
              Supprimer
            </button>
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
      </div>
    </div>
  );
}
