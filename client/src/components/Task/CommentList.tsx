import { useState } from 'react';
import type { Task } from '../../types';
import { useAddComment, useDeleteComment } from '../../api/tasks';
import { useAuth } from '../../context/AuthContext';
import { fmtDate } from '../../utils/format';
import Avatar from '../common/Avatar';
import { useProjectRole } from '../../hooks/useProjectRole';

export default function CommentList({ projectKey, task, readOnly }: { projectKey: string; task: Task; readOnly?: boolean }) {
  const { user } = useAuth();
  const { isAdmin } = useProjectRole(projectKey);
  const addComment = useAddComment(projectKey);
  const deleteComment = useDeleteComment(projectKey);
  const [text, setText] = useState('');

  function submit() {
    if (!text.trim()) return;
    addComment.mutate({ taskId: task.taskId, text }, { onSuccess: () => setText('') });
  }

  return (
    <div>
      {task.comments.map((c) => {
        const author = typeof c.author === 'object' ? c.author : null;
        const canDelete = !readOnly && (author?._id === user?.id || isAdmin);
        return (
          <div className="comment" key={c._id}>
            <Avatar name={author?.displayName || c.authorLabel || '?'} color={author?.color || '#6b7280'} size="sm" />
            <div className="comment__body">
              <div className="comment__meta">
                <b>{author?.displayName || c.authorLabel || 'Utilisateur'}</b>
                {!author && c.authorLabel && <span className="tag">Jira</span>}
                <span>{fmtDate(c.createdAt)}</span>
                {c.editedAt && <span>(modifié)</span>}
                {canDelete && (
                  <button
                    className="btn ghost small"
                    style={{ marginLeft: 'auto', padding: '2px 6px' }}
                    onClick={() => deleteComment.mutate({ taskId: task.taskId, commentId: c._id })}
                  >
                    Supprimer
                  </button>
                )}
              </div>
              <div>{c.text}</div>
            </div>
          </div>
        );
      })}
      {task.comments.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>Aucun commentaire.</div>}

      {!readOnly && <div className="comment-form">
        <textarea
          placeholder="Ajouter un commentaire…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <button className="btn primary" onClick={submit} disabled={!text.trim() || addComment.isPending}>
          Envoyer
        </button>
      </div>}
    </div>
  );
}
