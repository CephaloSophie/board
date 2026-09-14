import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotificationActions, useNotifications } from '../../api/notifications';
import type { AppNotification, NotificationType } from '../../types';
import { fmtDate } from '../../utils/format';
import { fmtRelative } from '../../utils/dates';
import Avatar from '../common/Avatar';

const TYPE_META: Record<NotificationType, { icon: string; verb: string }> = {
  mention: { icon: '@', verb: 'vous a mentionné dans' },
  assigned: { icon: '👤', verb: 'vous a assigné' },
  comment: { icon: '💬', verb: 'a commenté' },
  reply: { icon: '↩', verb: 'a répondu sur' },
  reaction: { icon: '☺', verb: 'a réagi sur' },
  status: { icon: '◉', verb: 'a changé le statut de' },
};

// Notifications are fetched once when the app loads (see api/notifications).
export default function NotificationBell() {
  const { data, isFetching, isError, refetch } = useNotifications();
  const { markRead, clearRead } = useNotificationActions();
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = data?.unread ?? 0;
  const list = (data?.notifications || []).filter((n) => !onlyUnread || !n.read);

  function openNotification(n: AppNotification) {
    if (!n.read) markRead.mutate([n._id]);
    setOpen(false);
    if (n.taskId) navigate(`/projects/${n.projectKey}/tasks/${n.taskId}${n.commentId ? `#comment-${n.commentId}` : ''}`);
  }

  return (
    <div className="notif" ref={ref}>
      <button className={`notif__btn${unread ? ' has-unread' : ''}`} title="Notifications" onClick={() => setOpen((o) => !o)}>
        🔔
        {unread > 0 && <span className="notif__badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif__panel">
          <div className="notif__head">
            <b>Notifications</b>
            <label className="notif__filter">
              <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> non lues
            </label>
            <span className="header-spacer" />
            <button className="link-btn" disabled={!unread} onClick={() => markRead.mutate('all')}>
              Tout marquer lu
            </button>
            <button className="link-btn" disabled={isFetching} onClick={() => refetch()}>
              {isFetching ? 'Chargement…' : 'Actualiser'}
            </button>
          </div>
          <div className="notif__list">
            {isError && <div className="empty">Notifications indisponibles.</div>}
            {list.map((n) => {
              const meta = TYPE_META[n.type] || { icon: '•', verb: 'a modifié' };
              const actor = n.actor?.displayName || n.actorLabel || 'Quelqu’un';
              return (
                <button key={n._id} className={`notif__item${n.read ? '' : ' unread'}`} onClick={() => openNotification(n)}>
                  <span className="notif__icon">{meta.icon}</span>
                  <Avatar name={actor} color={n.actor?.color || '#6b7280'} size="sm" />
                  <span className="notif__text">
                    <span>
                      <b>{actor}</b> {meta.verb} {n.taskId && <span className="mono">{n.taskId}</span>}
                    </span>
                    {n.taskTitle && <span className="notif__title">{n.taskTitle}</span>}
                    {n.excerpt && <span className="notif__excerpt">{n.excerpt}</span>}
                    <span className="notif__time" title={fmtDate(n.createdAt)}>
                      {fmtRelative(n.createdAt)} · {n.projectKey}
                    </span>
                  </span>
                </button>
              );
            })}
            {!isError && list.length === 0 && <div className="empty">{onlyUnread ? 'Aucune notification non lue.' : 'Aucune notification.'}</div>}
          </div>
          <div className="notif__foot">
            <span className="hint">Mises à jour au chargement de l’application.</span>
            <button className="link-btn" disabled={clearRead.isPending} onClick={() => clearRead.mutate()}>
              Effacer les lues
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
