import { useEffect, useMemo, useState } from 'react';
import { useRetro, type RetroState } from '../../api/useRetro';
import { useUsers } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import { get } from '../../api/client';
import Avatar from '../common/Avatar';

const COLUMN_META = {
  start: { label: 'À commencer', color: '#7ecb98', emoji: '🚀' },
  stop: { label: 'À arrêter', color: '#e85d70', emoji: '🛑' },
  continue: { label: 'À continuer', color: '#6b78ea', emoji: '🔁' },
} as const;

const PHASE_LABELS: Record<string, string> = {
  lobby: 'Préparation',
  rating: 'Note du sprint',
  ssc: 'Start / Stop / Continue',
  voting: 'Vote des propositions',
  actions: 'Objectifs',
  closing: 'Clôture',
  done: 'Terminée',
};

function useCountdown(endsAt?: string | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  return Math.round((new Date(endsAt).getTime() - Date.now()) / 1000);
}

export default function RetroBoard({ projectKey, retroId, onClose }: { projectKey: string; retroId: string; onClose: () => void }) {
  const { user } = useAuth();
  const { data: users } = useUsers();
  const { status, state, send } = useRetro(retroId);

  const nameOf = useMemo(() => {
    const m = new Map<string, { name: string; color?: string }>();
    (users || []).forEach((u) => m.set(u.id, { name: u.displayName, color: u.color }));
    (state.invited || []).forEach((u) => m.set(u._id, { name: u.displayName, color: u.color }));
    return (id?: string) => (id && m.get(id)) || { name: 'Anonyme', color: undefined };
  }, [users, state.invited]);

  const isFacilitator = !!user && (state.facilitator === user.id || ['superadmin', 'project_manager', 'scrum_master', 'product_owner', 'team_lead'].includes(user.role));
  const online = new Set(state.online || []);

  return (
    <div className="retro-shell">
      <header className="retro-top">
        <div>
          <div className="retro-top__eyebrow">Rétrospective · {PHASE_LABELS[state.phase || 'lobby']}</div>
          <div className="retro-top__title">{state.title || `Rétro ${state.sprint || ''}`}{state.team ? ` · ${state.team.name}` : ''}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className={`poker-status poker-status--${status}`}>{status === 'open' ? 'connecté' : status === 'connecting' ? 'connexion…' : 'hors ligne'}</span>
          <span className="retro-online">{(state.online || []).length} en ligne</span>
          <button className="close-btn" onClick={onClose}>Fermer ✕</button>
        </div>
      </header>

      {/* Facilitator phase stepper */}
      {isFacilitator && (
        <div className="retro-stepper">
          {(['lobby', 'rating', 'ssc', 'voting', 'actions', 'closing', 'done'] as const).map((p) => (
            <button
              key={p}
              className={`retro-step${state.phase === p ? ' active' : ''}`}
              onClick={() => send({ type: 'setPhase', phase: p })}
            >
              {PHASE_LABELS[p]}
            </button>
          ))}
        </div>
      )}

      <div className="retro-body">
        {!state.phase && (
          <div className="loadbox">
            {status === 'open' ? 'Chargement de la rétrospective…' : 'Connexion à la rétrospective en temps réel…'}
          </div>
        )}
        {state.phase === 'lobby' && <Lobby projectKey={projectKey} state={state} nameOf={nameOf} online={online} isFacilitator={isFacilitator} send={send} users={users} />}
        {state.phase === 'rating' && <RatingPhase state={state} nameOf={nameOf} isFacilitator={isFacilitator} send={send} label="Comment s'est passé le sprint ?" action="rate" reveal="revealRatings" ratedKey="ratedBy" avgKey="ratingAvg" myKey="myRating" revealedKey="ratingRevealed" ratingsKey="ratings" />}
        {state.phase === 'ssc' && <SscPhase state={state} nameOf={nameOf} isFacilitator={isFacilitator} me={user?.id} send={send} />}
        {state.phase === 'voting' && <VotingPhase state={state} nameOf={nameOf} isFacilitator={isFacilitator} me={user?.id} send={send} />}
        {state.phase === 'actions' && <ActionsPhase state={state} nameOf={nameOf} isFacilitator={isFacilitator} send={send} />}
        {state.phase === 'closing' && <ClosingPhase state={state} isFacilitator={isFacilitator} send={send} />}
        {state.phase === 'done' && <DonePhase state={state} nameOf={nameOf} />}
      </div>
    </div>
  );
}

/* ---------------- Lobby ---------------- */
function Lobby({ projectKey, state, nameOf, online, isFacilitator, send, users }: any) {
  const [prevGoals, setPrevGoals] = useState<any[]>([]);
  useEffect(() => {
    if (!state.sprint) return;
    const q = state.team ? `?team=${state.team._id}` : '';
    get<{ retro: any }>(`/projects/${projectKey}/retros/previous/${state.sprint}${q}`)
      .then((r) => setPrevGoals(r.retro?.actionItems || []))
      .catch(() => {});
  }, [projectKey, state.sprint, state.team?._id]);

  const absent = new Set(state.absent || []);
  return (
    <div className="retro-cols">
      <div className="dash-card">
        <h3>Participants invités</h3>
        <div className="sub">L'animateur peut déclarer les absents.</div>
        {(state.invited || []).map((u: any) => (
          <div className="retro-member" key={u._id}>
            <span className={`online-dot${online.has(u._id) ? ' on' : ''}`} />
            <Avatar name={u.displayName} color={u.color} size="sm" />
            <span style={{ flex: 1 }}>{u.displayName}{absent.has(u._id) ? ' — absent' : ''}</span>
            {isFacilitator && (
              <button className="btn small" onClick={() => send({ type: 'toggleAbsent', userId: u._id })}>
                {absent.has(u._id) ? 'Présent' : 'Absent'}
              </button>
            )}
          </div>
        ))}
        {isFacilitator && (
          <div className="field" style={{ marginTop: 12, maxWidth: 260 }}>
            <label>Déléguer l'animation</label>
            <select value={state.facilitator || ''} onChange={(e) => send({ type: 'delegate', userId: e.target.value })}>
              {(users || []).map((u: any) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="dash-card">
        <h3>Objectifs de la rétro précédente</h3>
        <div className="sub">À revoir : ont-ils été appliqués durant le sprint ?</div>
        {prevGoals.length === 0 && <div className="empty">Aucun objectif précédent.</div>}
        {prevGoals.map((a) => (
          <div className="retro-goal" key={a.stickyId}>
            🎯 {a.text} <span className="tag">{a.score} pts</span>
          </div>
        ))}
        {isFacilitator && <button className="btn primary" style={{ marginTop: 14 }} onClick={() => send({ type: 'setPhase', phase: 'rating' })}>Commencer la rétro →</button>}
      </div>
    </div>
  );
}

/* ---------------- Rating (generic) ---------------- */
function RatingPhase({ state, nameOf, isFacilitator, send, label }: any) {
  const revealed = state.ratingRevealed;
  const rated = new Set(state.ratedBy || []);
  return (
    <div className="dash-card" style={{ maxWidth: 640, margin: '0 auto' }}>
      <h3>{label}</h3>
      <div className="sub">Note de 1 (mauvais) à 5 (excellent). Les notes restent cachées jusqu'à la révélation.</div>
      <div className="retro-rating-scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`retro-mood${state.myRating === n ? ' selected' : ''}`} disabled={revealed} onClick={() => send({ type: 'rate', value: n })}>
            {['😞', '🙁', '😐', '🙂', '😀'][n - 1]}
            <span>{n}</span>
          </button>
        ))}
      </div>
      {!revealed ? (
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <span className="text-muted">{rated.size} personne(s) ont noté</span>
          {isFacilitator && <button className="btn primary" onClick={() => send({ type: 'revealRatings' })}>👁 Révéler les notes</button>}
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div className="retro-avg">Moyenne : <b>{state.ratingAvg ?? '—'}</b> / 5</div>
          <div className="retro-rating-list">
            {(state.ratings || []).map((r: any) => (
              <span className="tag" key={r.user}>{nameOf(r.user).name} : {r.value}</span>
            ))}
          </div>
          {isFacilitator && <button className="btn primary" style={{ marginTop: 12 }} onClick={() => send({ type: 'setPhase', phase: 'ssc' })}>Passer au Start/Stop/Continue →</button>}
        </div>
      )}
    </div>
  );
}

/* ---------------- SSC ---------------- */
function SscPhase({ state, nameOf, isFacilitator, me, send }: any) {
  const remaining = useCountdown(state.timerEndsAt);
  const revealed = state.sscRevealed;
  const [drafts, setDrafts] = useState<Record<string, string>>({ start: '', stop: '', continue: '' });
  const [minutes, setMinutes] = useState(5);

  const stickies: any[] = state.stickies || [];
  const currentSpeaker = (state.speakerOrder || [])[state.speakerIndex || 0];

  if (!revealed) {
    return (
      <div>
        {isFacilitator && (
          <div className="retro-timerbar">
            <div className="field" style={{ maxWidth: 140 }}>
              <label>Minuteur (min)</label>
              <input type="number" min={0} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 0)} />
            </div>
            <button className="btn" onClick={() => send({ type: 'setTimer', minutes })}>Lancer le minuteur</button>
            {remaining != null && <span className={`retro-remaining${remaining <= 0 ? ' over' : ''}`}>{remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'temps écoulé'}</span>}
            <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => send({ type: 'revealSsc' })}>Terminer l'écriture & révéler →</button>
          </div>
        )}
        {!isFacilitator && remaining != null && (
          <div className="retro-remaining-center">{remaining > 0 ? `⏱ ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : '⏱ temps écoulé — en attente de l\'animateur'}</div>
        )}
        <div className="ssc-cols">
          {(['start', 'stop', 'continue'] as const).map((col) => {
            const meta = COLUMN_META[col];
            const mine = stickies.filter((s) => s.column === col);
            return (
              <div className="ssc-col" key={col} style={{ borderTopColor: meta.color }}>
                <div className="ssc-col__head">{meta.emoji} {meta.label}</div>
                {mine.map((s) => (
                  <div className="sticky" key={s.id} style={{ borderLeftColor: meta.color }}>
                    <textarea
                      defaultValue={s.text}
                      onBlur={(e) => e.target.value !== s.text && send({ type: 'editSticky', id: s.id, text: e.target.value })}
                    />
                    <button className="icon-btn" onClick={() => send({ type: 'deleteSticky', id: s.id })}>✕</button>
                  </div>
                ))}
                <div className="sticky-add">
                  <textarea
                    placeholder="Ajouter une note…"
                    value={drafts[col]}
                    onChange={(e) => setDrafts((d) => ({ ...d, [col]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && drafts[col].trim()) {
                        e.preventDefault();
                        send({ type: 'addSticky', column: col, text: drafts[col].trim() });
                        setDrafts((d) => ({ ...d, [col]: '' }));
                      }
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>Vos notes sont privées jusqu'à la révélation par l'animateur.</div>
      </div>
    );
  }

  // Revealed: grouped by author, speaker rotation.
  const byAuthor = new Map<string, any[]>();
  for (const s of stickies) {
    if (!byAuthor.has(String(s.author))) byAuthor.set(String(s.author), []);
    byAuthor.get(String(s.author))!.push(s);
  }
  const order: string[] = (state.speakerOrder && state.speakerOrder.length ? state.speakerOrder : Array.from(byAuthor.keys())) as string[];
  const isCurrentSpeaker = currentSpeaker === me;
  const canPass = isFacilitator || isCurrentSpeaker;
  const isLast = (state.speakerIndex || 0) >= order.length - 1;

  return (
    <div>
      <div className="retro-speaker-bar">
        <span>🎤 Au tour de <b>{nameOf(currentSpeaker).name}</b></span>
        <span className="text-muted">{(state.speakerIndex || 0) + 1} / {order.length}</span>
        {canPass && !isLast && <button className="btn primary small" onClick={() => send({ type: 'nextSpeaker' })}>Passer au suivant →</button>}
        {isFacilitator && isLast && <button className="btn primary small" onClick={() => send({ type: 'setPhase', phase: 'voting' })}>Passer au vote →</button>}
      </div>
      <div className="retro-speaker-list">
        {order.map((uid) => {
          const items = byAuthor.get(uid) || [];
          const focused = uid === currentSpeaker;
          return (
            <div className={`retro-author${focused ? ' focused' : ''}`} key={uid}>
              <div className="retro-author__head">
                <Avatar name={nameOf(uid).name} color={nameOf(uid).color} size="sm" /> {nameOf(uid).name}
              </div>
              <div className="retro-author__cards">
                {items.map((s) => (
                  <div className="sticky-view" key={s.id} style={{ borderLeftColor: COLUMN_META[s.column as 'start'].color }}>
                    <span className="sticky-view__col">{COLUMN_META[s.column as 'start'].emoji}</span> {s.text}
                  </div>
                ))}
                {items.length === 0 && <span className="text-muted" style={{ fontSize: 11 }}>—</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Voting ---------------- */
function VotingPhase({ state, nameOf, isFacilitator, me, send }: any) {
  const cfg = state.votesConfig || { perPerson: 4, minPer: 1, maxPer: 2 };
  const proposals = (state.stickies || []).filter((s: any) => s.column === 'start');
  const myVotes = new Map<string, number>((state.myVotes || []).map((v: any) => [v.stickyId, v.points]));
  const used = Array.from(myVotes.values()).reduce((a, b) => a + b, 0);
  const remaining = cfg.perPerson - used;
  const revealed = state.votesRevealed;
  const scores = state.voteScores || {};

  const [cfgDraft, setCfgDraft] = useState(cfg);

  const setVote = (stickyId: string, points: number) => send({ type: 'vote', stickyId, points });

  const sorted = revealed ? [...proposals].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0)) : proposals;

  return (
    <div>
      {isFacilitator && !revealed && (
        <div className="retro-timerbar">
          <div className="field" style={{ maxWidth: 110 }}><label>Points / pers.</label><input type="number" min={1} value={cfgDraft.perPerson} onChange={(e) => setCfgDraft({ ...cfgDraft, perPerson: Number(e.target.value) || 1 })} /></div>
          <div className="field" style={{ maxWidth: 90 }}><label>Min / prop.</label><input type="number" min={1} value={cfgDraft.minPer} onChange={(e) => setCfgDraft({ ...cfgDraft, minPer: Number(e.target.value) || 1 })} /></div>
          <div className="field" style={{ maxWidth: 90 }}><label>Max / prop.</label><input type="number" min={1} value={cfgDraft.maxPer} onChange={(e) => setCfgDraft({ ...cfgDraft, maxPer: Number(e.target.value) || 1 })} /></div>
          <button className="btn" onClick={() => send({ type: 'setVotesConfig', ...cfgDraft })}>Appliquer</button>
          <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={() => send({ type: 'revealVotes' })}>👁 Révéler les votes →</button>
        </div>
      )}
      {!revealed && (
        <div className="retro-budget">Votre budget : <b>{remaining}</b> / {cfg.perPerson} points · min {cfg.minPer}, max {cfg.maxPer} par proposition</div>
      )}
      <div className="retro-proposals">
        {sorted.map((s: any) => {
          const mine = myVotes.get(s.id) || 0;
          return (
            <div className="retro-proposal" key={s.id}>
              <div className="retro-proposal__text">🚀 {s.text}<span className="text-muted" style={{ fontSize: 10.5, marginLeft: 6 }}>— {nameOf(String(s.author)).name}</span></div>
              {revealed ? (
                <span className="retro-proposal__score">{scores[s.id] || 0} pts</span>
              ) : (
                <div className="retro-vote-ctl">
                  <button className="btn small" disabled={mine <= 0} onClick={() => setVote(s.id, mine - 1)}>−</button>
                  <span className="retro-vote-num">{mine}</span>
                  <button className="btn small" disabled={mine >= cfg.maxPer || remaining <= 0} onClick={() => setVote(s.id, Math.max(cfg.minPer, mine + 1))}>+</button>
                </div>
              )}
            </div>
          );
        })}
        {proposals.length === 0 && <div className="empty">Aucune proposition « à commencer ».</div>}
      </div>
      {revealed && isFacilitator && (
        <button className="btn primary" style={{ marginTop: 12 }} onClick={() => send({ type: 'setPhase', phase: 'actions' })}>Choisir les objectifs →</button>
      )}
    </div>
  );
}

/* ---------------- Actions ---------------- */
function ActionsPhase({ state, nameOf, isFacilitator, send }: any) {
  const proposals = (state.stickies || []).filter((s: any) => s.column === 'start');
  const scores = state.voteScores || {};
  const sorted = [...proposals].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
  const already = new Set((state.actionItems || []).map((a: any) => a.stickyId));
  const [selected, setSelected] = useState<Set<string>>(() => (already.size ? new Set(already) : new Set(sorted.slice(0, 3).map((s) => s.id))));

  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div className="dash-card" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h3>Objectifs pour le prochain sprint</h3>
      <div className="sub">Sélectionnez les propositions à retenir (par défaut les 3 mieux votées). Elles deviendront des objectifs revus à la prochaine rétro.</div>
      {sorted.map((s: any, i: number) => (
        <label className={`retro-action-pick${selected.has(s.id) ? ' on' : ''}`} key={s.id}>
          {isFacilitator ? (
            <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
          ) : (
            <span className="rank">#{i + 1}</span>
          )}
          <span style={{ flex: 1 }}>{s.text}</span>
          <span className="tag">{scores[s.id] || 0} pts · {nameOf(String(s.author)).name}</span>
        </label>
      ))}
      {isFacilitator && (
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <button className="btn primary" onClick={() => send({ type: 'selectActions', stickyIds: Array.from(selected) })}>✓ Valider les objectifs</button>
          <button className="btn" onClick={() => send({ type: 'setPhase', phase: 'closing' })}>Passer à la clôture →</button>
        </div>
      )}
      {(state.actionItems || []).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <h4>Objectifs retenus</h4>
          {(state.actionItems || []).map((a: any) => (
            <div className="retro-goal" key={a.stickyId}>🎯 {a.text} <span className="tag">{a.score} pts</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Closing ---------------- */
function ClosingPhase({ state, isFacilitator, send }: any) {
  const revealed = state.retroRatingRevealed;
  return (
    <div className="dash-card" style={{ maxWidth: 560, margin: '0 auto' }}>
      <h3>Notez cette rétrospective</h3>
      <div className="sub">Votre retour sur la cérémonie elle-même.</div>
      <div className="retro-rating-scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`retro-mood${state.myRetroRating === n ? ' selected' : ''}`} disabled={revealed} onClick={() => send({ type: 'rateRetro', value: n })}>
            {['😞', '🙁', '😐', '🙂', '😀'][n - 1]}<span>{n}</span>
          </button>
        ))}
      </div>
      {revealed && <div className="retro-avg" style={{ marginTop: 12 }}>Moyenne : <b>{state.retroRatingAvg ?? '—'}</b> / 5</div>}
      {isFacilitator && (
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          {!revealed && <button className="btn" onClick={() => send({ type: 'revealRetroRating' })}>Révéler</button>}
          <button className="btn primary" onClick={() => send({ type: 'setPhase', phase: 'done' })}>Terminer la rétrospective</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Done ---------------- */
function DonePhase({ state, nameOf }: { state: RetroState; nameOf: (id?: string) => { name: string; color?: string } }) {
  return (
    <div className="dash-card" style={{ maxWidth: 680, margin: '0 auto' }}>
      <h3>Rétrospective terminée ✅</h3>
      <div className="retro-avg">Note du sprint : <b>{state.ratingAvg ?? '—'}</b> / 5 · Note de la rétro : <b>{state.retroRatingAvg ?? '—'}</b> / 5</div>
      <h4 style={{ marginTop: 16 }}>Objectifs pour le prochain sprint</h4>
      {(state.actionItems || []).length === 0 && <div className="empty">Aucun objectif retenu.</div>}
      {(state.actionItems || []).map((a) => (
        <div className="retro-goal" key={a.stickyId}>🎯 {a.text} <span className="tag">{a.score} pts · {nameOf(a.fromUser as string).name}</span></div>
      ))}
    </div>
  );
}
