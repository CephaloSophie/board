import { useState } from 'react';
import type { Task } from '../../types';
import { useAddComment, useDeleteComment } from '../../api/tasks';
import { useAuth } from '../../context/AuthContext';
import { fmtDate } from '../../utils/format';
import Avatar from '../common/Avatar';

export default function CommentList({ projectKey, task }: { projectKey: string; task: Task }) {
  const { user } = useAuth();
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
        const canDelete = author?._id === user?.id || user?.role === 'superadmin';
        return (
          <div className="comment" key={c._id}>
            <Avatar name={author?.displayName || '?'} color={author?.color} size="sm" />
            <div className="comment__body">
              <div className="comment__meta">
                <b>{author?.displayName || 'Utilisateur'}</b>
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

      <div className="comment-form">
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
      </div>
    </div>
  );
}
