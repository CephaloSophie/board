import { useEffect, useMemo, useState } from 'react';
import type { ProjectEvent } from '../../types';
import { usePoker } from '../../api/usePoker';
import { useGroups } from '../../api/groups';
import { useUsers } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import { isManager } from '../../utils/roles';
import Avatar from '../common/Avatar';

const DEFAULT_DECK = ['0.5', '1', '2', '3', '5', '8', '13', '?'];

function useCountdown(startedAt?: number, durationSec?: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt || !durationSec) return null;
  const remaining = Math.round((startedAt + durationSec * 1000 - Date.now()) / 1000);
  return remaining;
}

export default function PokerPanel({ projectKey, event }: { projectKey: string; event: ProjectEvent }) {
  const { user } = useAuth();
  const canLaunch = isManager(user?.role);
  const { status, members, session, startVote, vote, unvote, reveal, cancel, setEstimate } = usePoker(event._id);
  const { data: groups } = useGroups(projectKey);
  const { data: users } = useUsers();

  const remaining = useCountdown(session.startedAt, session.durationSec);

  if (!event._id) return null;

  return (
    <div className="event-card-section poker">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h4 style={{ margin: 0 }}>🃏 Planning Poker <span className="text-muted" style={{ fontWeight: 400 }}>· temps réel</span></h4>
        <span className={`poker-status poker-status--${status}`}>
          {status === 'open' ? 'connecté' : status === 'connecting' ? 'connexion…' : 'déconnecté'}
        </span>
      </div>

      <div className="poker-presence">
        {members.map((m) => (
          <span key={m.id} className="poker-presence__item" title={m.displayName}>
            <Avatar name={m.displayName} color={m.color} size="sm" />
          </span>
        ))}
        <span className="text-muted" style={{ fontSize: 11 }}>{members.length} en ligne</span>
      </div>

      {!session.active ? (
        canLaunch ? (
          <LaunchForm event={event} groups={groups} users={users} onStart={startVote} />
        ) : (
          <div className="text-muted" style={{ fontSize: 12.5 }}>
            Aucun vote en cours. Un Scrum Master ou PO peut en lancer un.
          </div>
        )
      ) : (
        <ActiveVote
          session={session}
          remaining={remaining}
          isLauncher={session.launcherId === user?.id}
          canControl={canLaunch}
          onVote={vote}
          onUnvote={unvote}
          onReveal={reveal}
          onCancel={cancel}
          onEstimate={setEstimate}
        />
      )}
    </div>
  );
}

function LaunchForm({
  event,
  groups,
  users,
  onStart,
}: {
  event: ProjectEvent;
  groups: ReturnType<typeof useGroups>['data'];
  users: ReturnType<typeof useUsers>['data'];
  onStart: (a: { taskId?: string | null; taskTitle?: string; deck: string[]; durationSec: number; allow: { mode: 'all' | 'group' | 'tag' | 'users'; ids: string[] } }) => void;
}) {
  const linked = event.tasks
    .map((l) => (typeof l.task === 'object' ? l.task : null))
    .filter(Boolean) as { _id: string; taskId: string; title: string }[];
  const [taskId, setTaskId] = useState(linked[0]?.taskId || '');
  const [deckStr, setDeckStr] = useState(DEFAULT_DECK.join(', '));
  const [duration, setDuration] = useState(60);
  const [mode, setMode] = useState<'all' | 'group' | 'tag' | 'users'>('all');
  const [ids, setIds] = useState<string[]>([]);

  const deck = useMemo(() => deckStr.split(',').map((s) => s.trim()).filter(Boolean), [deckStr]);
  const groupOptions = (groups || []).filter((g) => (mode === 'tag' ? g.kind === 'tag' : g.kind === 'group'));

  function start() {
    const task = linked.find((t) => t.taskId === taskId);
    onStart({
      taskId: taskId || null,
      taskTitle: task?.title || '',
      deck,
      durationSec: duration,
      allow: { mode, ids },
    });
  }

  return (
    <div className="poker-launch">
      <div className="field-grid">
        <div className="field">
          <label>Tâche à estimer</label>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">— (aucune tâche liée) —</option>
            {linked.map((t) => (
              <option key={t._id} value={t.taskId}>
                {t.taskId} — {t.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Durée (secondes)</label>
          <input type="number" min={5} max={3600} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 60)} />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Deck (valeurs séparées par des virgules)</label>
          <input value={deckStr} onChange={(e) => setDeckStr(e.target.value)} />
        </div>
        <div className="field">
          <label>Qui peut voter ?</label>
          <select value={mode} onChange={(e) => { setMode(e.target.value as any); setIds([]); }}>
            <option value="all">Tous les connectés</option>
            <option value="group">Un groupe</option>
            <option value="tag">Un tag</option>
            <option value="users">Une sélection de personnes</option>
          </select>
        </div>
        {(mode === 'group' || mode === 'tag') && (
          <div className="field">
            <label>{mode === 'tag' ? 'Tag(s)' : 'Groupe(s)'}</label>
            <div className="multi-select-chips">
              {groupOptions.map((g) => (
                <span
                  key={g._id}
                  className={`pick-chip ${ids.includes(g._id) ? 'active' : ''}`}
                  onClick={() => setIds((p) => (p.includes(g._id) ? p.filter((x) => x !== g._id) : [...p, g._id]))}
                >
                  {g.name}
                </span>
              ))}
              {groupOptions.length === 0 && <span className="text-muted" style={{ fontSize: 11 }}>Aucun {mode === 'tag' ? 'tag' : 'groupe'} — créez-en dans Administration.</span>}
            </div>
          </div>
        )}
        {mode === 'users' && (
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Personnes autorisées</label>
            <div className="multi-select-chips">
              {(users || []).map((u) => (
                <span
                  key={u.id}
                  className={`pick-chip ${ids.includes(u.id) ? 'active' : ''}`}
                  onClick={() => setIds((p) => (p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id]))}
                >
                  <Avatar name={u.displayName} color={u.color} size="sm" /> {u.displayName}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      <button className="btn primary" style={{ marginTop: 10 }} disabled={!deck.length} onClick={start}>
        ▶ Lancer le vote
      </button>
    </div>
  );
}

function ActiveVote({
  session,
  remaining,
  isLauncher,
  canControl,
  onVote,
  onUnvote,
  onReveal,
  onCancel,
  onEstimate,
}: {
  session: import('../../api/usePoker').PokerSession;
  remaining: number | null;
  isLauncher: boolean;
  canControl: boolean;
  onVote: (v: string) => void;
  onUnvote: () => void;
  onReveal: () => void;
  onCancel: () => void;
  onEstimate: (taskId: string, value: number) => void;
}) {
  const { user } = useAuth();
  const allowed =
    !session.allowedUserIds || (user && session.allowedUserIds.includes(user.id));
  const voters = new Set(session.voters || []);
  const [finalEstimate, setFinalEstimate] = useState<string>('');

  useEffect(() => {
    if (session.revealed && session.suggestion != null) setFinalEstimate(String(session.suggestion));
  }, [session.revealed, session.suggestion]);

  const over = remaining != null && remaining <= 0;

  return (
    <div className="poker-active">
      <div className="poker-task">
        <span className="poker-task__label">Estimation en cours</span>
        <span className="poker-task__title">{session.taskId ? `${session.taskId} — ` : ''}{session.taskTitle || 'Tâche'}</span>
        <span className="text-muted" style={{ fontSize: 11 }}>lancé par {session.launcherName}</span>
      </div>

      {/* Countdown */}
      <div className={`poker-timer${over && !session.revealed ? ' poker-timer--over' : ''}`}>
        {session.revealed ? (
          <span className="poker-timer__done">✓ Votes révélés</span>
        ) : over ? (
          <span>⏳ Temps écoulé — en attente de révélation par le lanceur</span>
        ) : (
          <span className="poker-timer__num">{Math.max(0, remaining ?? 0)}s</span>
        )}
      </div>

      {/* Deck (voting) */}
      {!session.revealed && (
        <div className="poker-deck">
          {(session.deck || []).map((v) => (
            <button
              key={v}
              className={`poker-card${session.myVote === v ? ' selected' : ''}`}
              disabled={!allowed}
              title={allowed ? '' : "Vous n'êtes pas autorisé à voter"}
              onClick={() => (session.myVote === v ? onUnvote() : onVote(v))}
            >
              {v}
            </button>
          ))}
          {!allowed && <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>Vous n'êtes pas dans la liste des votants autorisés.</div>}
        </div>
      )}

      {/* Voters progress (values hidden until reveal) */}
      <div className="poker-voters">
        {(session.allowedUserIds
          ? session.allowedUserIds.map((id) => ({ id, name: session.voterNames?.[id] || id }))
          : (session.voters || []).map((id) => ({ id, name: session.voterNames?.[id] || id }))
        ).map((v) => (
          <span key={v.id} className={`poker-voter${voters.has(v.id) ? ' voted' : ''}`}>
            {voters.has(v.id) ? '✓' : '…'} {session.voterNames?.[v.id] || 'a voté'}
          </span>
        ))}
        <span className="text-muted" style={{ fontSize: 11 }}>{voters.size} vote(s)</span>
      </div>

      {/* Revealed results */}
      {session.revealed && session.votes && (
        <div className="poker-results">
          <div className="poker-results__cards">
            {Object.entries(session.votes).map(([uid, val]) => (
              <div className="poker-result" key={uid}>
                <div className="poker-result__val">{val}</div>
                <div className="poker-result__name">{session.voterNames?.[uid] || 'Anonyme'}</div>
              </div>
            ))}
          </div>
          <div className="poker-summary">
            {session.agreement ? (
              <span className="poker-consensus">✅ Consensus</span>
            ) : (
              <span className="text-muted">Suggestion (médiane) : <b>{session.suggestion ?? '—'}</b></span>
            )}
          </div>
        </div>
      )}

      {/* Launcher / manager controls */}
      {(isLauncher || canControl) && (
        <div className="poker-controls">
          {!session.revealed ? (
            <>
              <button className="btn primary" onClick={onReveal}>👁 Révéler les votes</button>
              <button className="btn danger small" onClick={onCancel}>Annuler</button>
            </>
          ) : (
            <>
              <div className="field" style={{ maxWidth: 130 }}>
                <label>Estimation finale</label>
                <input value={finalEstimate} onChange={(e) => setFinalEstimate(e.target.value)} />
              </div>
              <button
                className="btn primary"
                disabled={!session.taskId || !Number.isFinite(parseFloat(finalEstimate))}
                onClick={() => session.taskId && onEstimate(session.taskId, parseFloat(finalEstimate))}
              >
                ✓ Appliquer l'estimation
              </button>
              <button className="btn small" onClick={onCancel}>Clore sans appliquer</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
