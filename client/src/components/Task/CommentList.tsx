import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Comment, Task } from '../../types';
import { REACTIONS, useAddComment, useDeleteComment, useEditComment, useReactToComment } from '../../api/tasks';
import { errorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useProjectRole } from '../../hooks/useProjectRole';
import { useProjectPeople } from '../../hooks/useProjectPeople';
import { fmtDate } from '../../utils/format';
import { fmtRelative } from '../../utils/dates';
import Avatar from '../common/Avatar';
import RichText from '../common/RichText';
import RichTextEditor from '../common/RichTextEditor';

const authorOf = (c: Comment) => (typeof c.author === 'object' && c.author ? c.author : null);

interface Shared {
  projectKey: string;
  task: Task;
  readOnly?: boolean;
  isAdmin: boolean;
  userId?: string;
  mentionLabel: (username: string) => string | undefined;
  highlight: string | null;
}

export default function CommentList({ projectKey, task, readOnly }: { projectKey: string; task: Task; readOnly?: boolean }) {
  const { user } = useAuth();
  const { isAdmin } = useProjectRole(projectKey);
  const people = useProjectPeople(projectKey);
  const addComment = useAddComment(projectKey);
  const location = useLocation();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  // One reply level: replies are grouped under their root comment.
  const { roots, replies } = useMemo(() => {
    const ids = new Set(task.comments.map((c) => c._id));
    const byParent = new Map<string, Comment[]>();
    const top: Comment[] = [];
    for (const c of task.comments) {
      if (c.parent && ids.has(c.parent)) {
        if (!byParent.has(c.parent)) byParent.set(c.parent, []);
        byParent.get(c.parent)!.push(c);
      } else top.push(c);
    }
    return { roots: top, replies: byParent };
  }, [task.comments]);

  // Deep links from notifications: #comment-<id>.
  useEffect(() => {
    const m = /^#comment-([a-f0-9]{24})$/.exec(location.hash);
    const el = m && document.getElementById(`comment-${m[1]}`);
    if (!m || !el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(m[1]);
    const timer = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [location.hash, task.comments.length]);

  function submit() {
    if (!text.trim()) return;
    setError(null);
    addComment.mutate({ taskId: task.taskId, text }, { onSuccess: () => setText(''), onError: (e) => setError(errorMessage(e)) });
  }

  const shared: Shared = { projectKey, task, readOnly, isAdmin, userId: user?.id, mentionLabel: people.mentionLabel, highlight };

  return (
    <div className="comments">
      {roots.map((c) => (
        <CommentItem key={c._id} {...shared} comment={c} replies={replies.get(c._id) || []} />
      ))}
      {task.comments.length === 0 && <div className="text-muted small-text">Aucun commentaire.</div>}

      {!readOnly && (
        <div className="comment-compose">
          <RichTextEditor
            value={text}
            onChange={setText}
            projectKey={projectKey}
            taskId={task.taskId}
            rows={3}
            placeholder="Ajouter un commentaire… (@ pour mentionner, images par copier-coller)"
            onSubmit={submit}
          />
          {error && <div className="form-error">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={submit} disabled={!text.trim() || addComment.isPending}>
              {addComment.isPending ? 'Envoi…' : 'Commenter'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment,
  replies = [],
  isReply,
  onReply,
  ...shared
}: Shared & { comment: Comment; replies?: Comment[]; isReply?: boolean; onReply?: (username?: string) => void }) {
  const { projectKey, task, readOnly, isAdmin, userId, mentionLabel, highlight } = shared;
  const editComment = useEditComment(projectKey);
  const deleteComment = useDeleteComment(projectKey);
  const react = useReactToComment(projectKey);
  const addComment = useAddComment(projectKey);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const author = authorOf(comment);
  const canModify = !readOnly && ((!!author && author._id === userId) || isAdmin);
  const onError = (e: unknown) => setError(errorMessage(e));

  function openReply(username?: string) {
    setReplying(true);
    if (username) setReply((r) => r || `@${username} `);
  }

  function saveEdit() {
    if (!draft.trim()) return;
    editComment.mutate({ taskId: task.taskId, commentId: comment._id, text: draft }, { onSuccess: () => setEditing(false), onError });
  }

  function remove() {
    const question = replies.length ? `Supprimer ce commentaire et ses ${replies.length} réponse(s) ?` : 'Supprimer ce commentaire ?';
    if (!confirm(question)) return;
    deleteComment.mutate({ taskId: task.taskId, commentId: comment._id }, { onError });
  }

  function sendReply() {
    if (!reply.trim()) return;
    addComment.mutate(
      { taskId: task.taskId, text: reply, parent: comment._id },
      {
        onSuccess: () => {
          setReply('');
          setReplying(false);
        },
        onError,
      }
    );
  }

  function toggleReaction(emoji: string) {
    setPicker(false);
    react.mutate({ taskId: task.taskId, commentId: comment._id, emoji }, { onError });
  }

  return (
    <div id={`comment-${comment._id}`} className={`comment${isReply ? ' reply' : ''}${highlight === comment._id ? ' highlight' : ''}`}>
      <Avatar name={author?.displayName || comment.authorLabel || '?'} color={author?.color || '#6b7280'} size="sm" />
      <div className="comment__main">
        <div className="comment__body">
          <div className="comment__meta">
            <b>{author?.displayName || comment.authorLabel || 'Utilisateur'}</b>
            {!author && comment.authorLabel && <span className="tag">Jira</span>}
            <span title={fmtDate(comment.createdAt)}>{fmtRelative(comment.createdAt)}</span>
            {comment.editedAt && <span title={fmtDate(comment.editedAt)}>(modifié)</span>}
          </div>
          {editing ? (
            <div className="stack" style={{ gap: 6 }}>
              <RichTextEditor value={draft} onChange={setDraft} projectKey={projectKey} taskId={task.taskId} rows={3} autoFocus onSubmit={saveEdit} />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  className="btn ghost small"
                  onClick={() => {
                    setEditing(false);
                    setDraft(comment.text);
                  }}
                >
                  Annuler
                </button>
                <button className="btn primary small" disabled={!draft.trim() || editComment.isPending} onClick={saveEdit}>
                  Enregistrer
                </button>
              </div>
            </div>
          ) : (
            <RichText text={comment.text} projectKey={projectKey} mentionLabel={mentionLabel} />
          )}
        </div>

        <div className="comment__actions">
          {(comment.reactions || []).map((r) => {
            const mine = r.users.some((u) => (typeof u === 'object' ? u._id : u) === userId);
            const names = r.users.map((u) => (typeof u === 'object' ? u.displayName : 'un membre'));
            return (
              <button key={r.emoji} className={`reaction${mine ? ' on' : ''}`} title={names.join(', ')} disabled={readOnly} onClick={() => toggleReaction(r.emoji)}>
                {r.emoji} {r.users.length}
              </button>
            );
          })}
          {!readOnly && (
            <span className="reaction-picker">
              <button className="reaction add" title="Ajouter une réaction" onClick={() => setPicker((p) => !p)}>
                ☺+
              </button>
              {picker && (
                <span className="reaction-picker__panel" onMouseLeave={() => setPicker(false)}>
                  {REACTIONS.map((emoji) => (
                    <button key={emoji} onClick={() => toggleReaction(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
          {!readOnly && (
            <button className="link-btn" onClick={() => (isReply ? onReply?.(author?.username) : openReply())}>
              Répondre
            </button>
          )}
          {canModify && !editing && (
            <button className="link-btn" onClick={() => setEditing(true)}>
              Modifier
            </button>
          )}
          {canModify && (
            <button className="link-btn danger" onClick={remove}>
              Supprimer
            </button>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}

        {replies.length > 0 && (
          <div className="comment__replies">
            {replies.map((r) => (
              <CommentItem key={r._id} {...shared} comment={r} isReply onReply={openReply} />
            ))}
          </div>
        )}
        {replying && (
          <div className="comment__reply-form">
            <RichTextEditor
              value={reply}
              onChange={setReply}
              projectKey={projectKey}
              taskId={task.taskId}
              rows={2}
              autoFocus
              placeholder={`Répondre à ${author?.displayName || comment.authorLabel || 'ce commentaire'}…`}
              onSubmit={sendReply}
            />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost small" onClick={() => setReplying(false)}>
                Annuler
              </button>
              <button className="btn primary small" disabled={!reply.trim() || addComment.isPending} onClick={sendReply}>
                Répondre
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
