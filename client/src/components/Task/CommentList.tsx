import { useEffect, useMemo, useRef, useState } from 'react';
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
  onQuote: (comment: Comment) => void;
}

type CommentFilter = 'all' | 'pinned' | 'open' | 'mine';
type CommentOrder = 'asc' | 'desc';

const ORDER_KEY = 'kydos.comments.order';
const draftKey = (projectKey: string, taskId: string) => `kydos.commentDraft.${projectKey}.${taskId}`;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* per-browser convenience only */
  }
}

// "> " quote of a comment (first lines), followed by a mention of its author.
function quoteOf(comment: Comment): string {
  const author = authorOf(comment);
  const lines = comment.text.split('\n').filter((l) => l.trim()).slice(0, 6);
  const who = author ? `@${author.username}` : comment.authorLabel || '';
  return `${lines.map((l) => `> ${l}`).join('\n')}\n\n${who ? `${who} ` : ''}`;
}

export default function CommentList({ projectKey, task, readOnly }: { projectKey: string; task: Task; readOnly?: boolean }) {
  const { user } = useAuth();
  const { isAdmin } = useProjectRole(projectKey);
  const people = useProjectPeople(projectKey);
  const addComment = useAddComment(projectKey);
  const location = useLocation();
  const [text, setText] = useState(() => readStorage(draftKey(projectKey, task.taskId)) || '');
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommentFilter>('all');
  const [order, setOrder] = useState<CommentOrder>(() => (readStorage(ORDER_KEY) === 'desc' ? 'desc' : 'asc'));
  const composeRef = useRef<HTMLDivElement>(null);

  // The composer survives closing the popup (per task, this browser only).
  useEffect(() => {
    const id = setTimeout(() => writeStorage(draftKey(projectKey, task.taskId), text.trim() ? text : null), 300);
    return () => clearTimeout(id);
  }, [text, projectKey, task.taskId]);
  useEffect(() => writeStorage(ORDER_KEY, order), [order]);

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
    addComment.mutate(
      { taskId: task.taskId, text },
      {
        onSuccess: () => {
          setText('');
          writeStorage(draftKey(projectKey, task.taskId), null);
        },
        onError: (e) => setError(errorMessage(e)),
      }
    );
  }

  function quote(comment: Comment) {
    setText((t) => `${t.trim() ? `${t.trimEnd()}\n\n` : ''}${quoteOf(comment)}`);
    composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => composeRef.current?.querySelector('textarea')?.focus(), 250);
  }

  const shared: Shared = { projectKey, task, readOnly, isAdmin, userId: user?.id, mentionLabel: people.mentionLabel, highlight, onQuote: quote };
  const me = (user?.username || '').toLowerCase();
  const mentionsMe = (c: Comment) => !!me && new RegExp(`(^|[^\\w@./-])@${me.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i').test(c.text);
  const threadMatches = (c: Comment) => {
    const thread = [c, ...(replies.get(c._id) || [])];
    if (filter === 'pinned') return thread.some((x) => x.pinned);
    if (filter === 'open') return !c.resolved;
    if (filter === 'mine') return thread.some((x) => mentionsMe(x) || authorOf(x)?._id === user?.id);
    return true;
  };
  const time = (c: Comment) => new Date(c.createdAt).getTime();
  const sorted = roots.filter(threadMatches).sort((a, b) => (order === 'asc' ? time(a) - time(b) : time(b) - time(a)));
  const pinned = sorted.filter((c) => c.pinned);
  const others = sorted.filter((c) => !c.pinned);
  const counts = {
    all: roots.length,
    pinned: roots.filter((c) => c.pinned || (replies.get(c._id) || []).some((r) => r.pinned)).length,
    open: roots.filter((c) => !c.resolved).length,
    mine: roots.filter((c) => [c, ...(replies.get(c._id) || [])].some((x) => mentionsMe(x) || authorOf(x)?._id === user?.id)).length,
  };

  const composer = !readOnly && (
    <div className="comment-compose" ref={composeRef}>
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
            {text.trim() && (
              <button className="btn ghost small" onClick={() => setText('')}>
                Effacer
              </button>
            )}
            <button className="btn primary" onClick={submit} disabled={!text.trim() || addComment.isPending}>
              {addComment.isPending ? 'Envoi…' : 'Commenter'}
            </button>
          </div>
    </div>
  );

  return (
    <div className="comments">
      {roots.length > 0 && (
        <div className="comments__toolbar">
          <div className="filter-chips">
            {(
              [
                ['all', 'Tous'],
                ['pinned', 'Épinglés'],
                ['open', 'Non résolus'],
                ['mine', 'Me concernant'],
              ] as const
            ).map(([key, label]) =>
              key === 'all' || counts[key] ? (
                <button key={key} className={`filter-chip${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>
                  {label} <span>{counts[key]}</span>
                </button>
              ) : null
            )}
          </div>
          <button className="btn ghost small" onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} title="Ordre d'affichage">
            {order === 'asc' ? '↓ Plus anciens d’abord' : '↑ Plus récents d’abord'}
          </button>
        </div>
      )}
      {order === 'desc' && composer}
      {pinned.length > 0 && (
        <div className="comments__pinned">
          <div className="comments__label">📌 Épinglés</div>
          {pinned.map((c) => (
            <CommentItem key={c._id} {...shared} comment={c} replies={replies.get(c._id) || []} />
          ))}
        </div>
      )}
      {others.map((c) => (
        <CommentItem key={c._id} {...shared} comment={c} replies={replies.get(c._id) || []} />
      ))}
      {task.comments.length === 0 && <div className="text-muted small-text">Aucun commentaire. Lancez la discussion : question, décision, capture…</div>}
      {task.comments.length > 0 && sorted.length === 0 && <div className="text-muted small-text">Aucune discussion pour ce filtre.</div>}
      {order === 'asc' && composer}
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
  const { projectKey, task, readOnly, isAdmin, userId, mentionLabel, highlight, onQuote } = shared;
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
  const [expanded, setExpanded] = useState(false);
  const [showAllReplies, setShowAllReplies] = useState(false);
  const [copied, setCopied] = useState(false);

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

  function setFlag(data: { pinned?: boolean; resolved?: boolean }) {
    editComment.mutate({ taskId: task.taskId, commentId: comment._id, ...data }, { onError });
  }

  function copyLink() {
    const url = `${window.location.origin}/projects/${projectKey}/tasks/${task.taskId}#comment-${comment._id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function toggleReaction(emoji: string) {
    setPicker(false);
    react.mutate({ taskId: task.taskId, commentId: comment._id, emoji }, { onError });
  }

  // A resolved thread is folded to one line until someone opens it again.
  const folded = !isReply && comment.resolved && !expanded && highlight !== comment._id;
  if (folded) {
    return (
      <div id={`comment-${comment._id}`} className="comment comment--folded">
        <button className="comment__fold" onClick={() => setExpanded(true)} title="Afficher la discussion">
          ✓ Discussion résolue · <b>{author?.displayName || comment.authorLabel || 'Utilisateur'}</b> : {comment.text.replace(/\s+/g, ' ').slice(0, 90)}
          {replies.length > 0 && <span className="text-muted"> · {replies.length} réponse(s)</span>}
        </button>
      </div>
    );
  }
  const visibleReplies = showAllReplies || replies.length <= 3 ? replies : replies.slice(-2);

  return (
    <div
      id={`comment-${comment._id}`}
      className={`comment${isReply ? ' reply' : ''}${highlight === comment._id ? ' highlight' : ''}${comment.pinned ? ' pinned' : ''}${comment.resolved ? ' resolved' : ''}`}
    >
      <Avatar name={author?.displayName || comment.authorLabel || '?'} color={author?.color || '#6b7280'} size="sm" />
      <div className="comment__main">
        <div className="comment__body">
          <div className="comment__meta">
            <b>{author?.displayName || comment.authorLabel || 'Utilisateur'}</b>
            {!author && comment.authorLabel && <span className="tag">Jira</span>}
            <span title={fmtDate(comment.createdAt)}>{fmtRelative(comment.createdAt)}</span>
            {comment.editedAt && <span title={fmtDate(comment.editedAt)}>(modifié)</span>}
            {comment.pinned && <span className="comment__flag">📌 épinglé</span>}
            {comment.resolved && <span className="comment__flag ok">✓ résolu</span>}
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
          {!readOnly && !editing && (
            <button className="link-btn" onClick={() => onQuote(comment)} title="Citer dans un nouveau commentaire">
              Citer
            </button>
          )}
          {!readOnly && (
            <button className="link-btn" onClick={() => setFlag({ pinned: !comment.pinned })} title="Afficher en tête de la discussion">
              {comment.pinned ? 'Désépingler' : 'Épingler'}
            </button>
          )}
          {!readOnly && !isReply && (
            <button className="link-btn" onClick={() => {
              setFlag({ resolved: !comment.resolved });
              setExpanded(false);
            }}>
              {comment.resolved ? 'Rouvrir' : 'Résoudre'}
            </button>
          )}
          <button className="link-btn" onClick={copyLink} title="Copier le lien direct vers ce commentaire">
            {copied ? '✓ Lien copié' : 'Lien'}
          </button>
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
            {visibleReplies.length < replies.length && (
              <button className="link-btn comment__more" onClick={() => setShowAllReplies(true)}>
                Afficher les {replies.length - visibleReplies.length} réponse(s) précédente(s)
              </button>
            )}
            {visibleReplies.map((r) => (
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
