import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useClosePreview, useSprintMutations, useSprints, type SprintInput } from '../../api/sprints';
import { useProjectRole } from '../../hooks/useProjectRole';
import { daysUntil, fmtDay, toDateInput, todayInput } from '../../utils/dates';
import { SPRINT_STATUS_META } from '../../utils/status';
import type { SprintRow } from '../../types';
import Avatar from '../common/Avatar';
import VersionsPanel from './VersionsPanel';

export default function SprintsTab({ projectKey }: { projectKey: string }) {
  const { project, isAdmin } = useProjectRole(projectKey);
  const { data, isLoading } = useSprints(projectKey);
  const m = useSprintMutations(projectKey);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SprintRow | null>(null);
  const [starting, setStarting] = useState<SprintRow | null>(null);
  const [closing, setClosing] = useState<SprintRow | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sprints = data?.sprints || [];
  const active = sprints.filter((s) => s.status === 'active');
  const upcoming = sprints.filter((s) => s.status === 'draft' || s.status === 'ready');
  const finished = sprints.filter((s) => s.status === 'finished').reverse();

  async function run(action: () => Promise<unknown>, success?: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function renderCard(sprint: SprintRow) {
    if (editing?._id === sprint._id) {
      return (
        <SprintForm
          key={sprint._id}
          initial={sprint}
          onCancel={() => setEditing(null)}
          onSubmit={(input) => run(() => m.update.mutateAsync({ key: sprint.key, data: input }).then(() => setEditing(null)), 'Sprint modifié.')}
        />
      );
    }
    return (
      <SprintCard
        key={sprint._id}
        sprint={sprint}
        isAdmin={isAdmin}
        onEdit={() => setEditing(sprint)}
        onReady={() => run(() => m.transition.mutateAsync({ key: sprint.key, action: 'ready' }))}
        onDraft={() => run(() => m.transition.mutateAsync({ key: sprint.key, action: 'draft' }))}
        onReopen={() => confirm(`Rouvrir « ${sprint.label} » ?`) && run(() => m.transition.mutateAsync({ key: sprint.key, action: 'reopen' }))}
        onStart={() => setStarting(sprint)}
        onClose={() => setClosing(sprint)}
        onDelete={() => confirm(`Supprimer « ${sprint.label} » ?`) && run(() => m.remove.mutateAsync(sprint.key), 'Sprint supprimé.')}
      />
    );
  }

  return (
    <div>
      <div className="section-head">
        <h2>Sprints</h2>
        {isAdmin && !creating && (
          <button className="btn primary small" onClick={() => setCreating(true)}>
            + Nouveau sprint
          </button>
        )}
      </div>
      <p className="text-muted section-intro">
        Cadence : {project?.sprintDurationValue} {project?.sprintDurationUnit === 'days' ? 'jour(s)' : 'semaine(s)'}. Un seul sprint actif à la
        fois : le démarrer fige l'engagement, le clôturer reporte le travail non terminé et fournit les chiffres de vélocité.
      </p>
      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-ok">{notice}</div>}
      {isLoading && <div className="loadbox">Chargement…</div>}

      {creating && (
        <SprintForm
          onCancel={() => setCreating(false)}
          onSubmit={(input) => run(() => m.create.mutateAsync(input).then(() => setCreating(false)), 'Sprint créé.')}
        />
      )}

      <div className="sprint-section">
        <div className="sprint-section__title">Actif</div>
        {active.map(renderCard)}
        {!isLoading && active.length === 0 && <div className="empty">Aucun sprint actif.</div>}
      </div>

      <div className="sprint-section">
        <div className="sprint-section__title">À venir ({upcoming.length})</div>
        {upcoming.map(renderCard)}
        {!isLoading && upcoming.length === 0 && <div className="empty">Aucun sprint planifié.</div>}
      </div>

      <div className="sprint-section">
        <button className="sprint-section__title as-button" onClick={() => setShowFinished((s) => !s)}>
          {showFinished ? '▾' : '▸'} Terminés ({finished.length})
        </button>
        {showFinished && finished.map(renderCard)}
      </div>

      {starting && (
        <StartSprintDialog
          sprint={starting}
          onCancel={() => setStarting(null)}
          onConfirm={(data) =>
            run(() => m.start.mutateAsync({ key: starting.key, data }).then(() => setStarting(null)), `« ${starting.label} » démarré.`)
          }
          busy={m.start.isPending}
        />
      )}
      {closing && (
        <CloseSprintDialog
          projectKey={projectKey}
          sprint={closing}
          onCancel={() => setClosing(null)}
          onClosed={(text) => {
            setClosing(null);
            setNotice(text);
          }}
        />
      )}

      <VersionsPanel projectKey={projectKey} />
    </div>
  );
}

function SprintCard({
  sprint,
  isAdmin,
  onEdit,
  onReady,
  onDraft,
  onReopen,
  onStart,
  onClose,
  onDelete,
}: {
  sprint: SprintRow;
  isAdmin: boolean;
  onEdit: () => void;
  onReady: () => void;
  onDraft: () => void;
  onReopen: () => void;
  onStart: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const status = SPRINT_STATUS_META[sprint.status] || SPRINT_STATUS_META.draft;
  // Sprint rows created outside the lifecycle (taxonomy admin, imports) may lack meta / stats.
  const stats = sprint.stats || { taskCount: 0, points: 0, doneCount: 0, donePoints: 0 };
  const meta = sprint.meta || {};
  const pct = stats.points ? Math.round((stats.donePoints / stats.points) * 100) : 0;
  const left = sprint.status === 'active' ? daysUntil(meta.endDate) : null;
  const report = meta.report;

  return (
    <div className={`sprint-card status-${sprint.status}`}>
      <div className="sprint-card__main">
        <div className="sprint-card__title">
          <span className="sprint-status" style={{ background: `${status.color}26`, color: status.color }}>
            {status.label}
          </span>
          <b>{sprint.label}</b>
          <span className="mono text-muted">{sprint.key}</span>
        </div>
        <div className="sprint-card__meta">
          {fmtDay(meta.startDate)} → {fmtDay(meta.endDate)}
          {left !== null && <span className={left < 0 ? 'late' : ''}>{left < 0 ? ` · en retard de ${-left} j` : ` · J-${left}`}</span>}
          {' · '}
          {stats.taskCount} tâche(s) · {stats.donePoints}/{stats.points} pts
        </div>
        {meta.goal && <div className="sprint-card__goal">🎯 {meta.goal}</div>}
        {report && (
          <div className="sprint-card__report">
            Engagé <b>{report.committedPoints}</b> pts · livré <b>{report.completedPoints}</b> pts · reporté{' '}
            <b>{report.carriedOverTaskIds.length}</b> tâche(s){report.carriedTo ? ` → ${report.carriedTo}` : report.carriedOverTaskIds.length ? ' → backlog' : ''}
          </div>
        )}
        <div className="progress" title={`${pct} % des points terminés`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {isAdmin && (
        <div className="sprint-card__actions">
          {sprint.status === 'draft' && (
            <button className="btn small" onClick={onReady}>
              Marquer prêt
            </button>
          )}
          {sprint.status === 'ready' && (
            <button className="btn small ghost" onClick={onDraft}>
              Repasser en brouillon
            </button>
          )}
          {(sprint.status === 'draft' || sprint.status === 'ready') && (
            <button className="btn small primary" onClick={onStart}>
              Démarrer…
            </button>
          )}
          {sprint.status === 'active' && (
            <button className="btn small primary" onClick={onClose}>
              Clôturer…
            </button>
          )}
          {sprint.status === 'finished' && (
            <button className="btn small ghost" onClick={onReopen}>
              Rouvrir
            </button>
          )}
          <button className="btn small ghost" onClick={onEdit}>
            Modifier
          </button>
          {sprint.status !== 'active' && stats.taskCount === 0 && (
            <button className="btn small danger" onClick={onDelete}>
              Supprimer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SprintForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: SprintRow;
  onSubmit: (input: SprintInput) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label || '');
  const [startDate, setStartDate] = useState(toDateInput(initial?.meta?.startDate));
  const [endDate, setEndDate] = useState(toDateInput(initial?.meta?.endDate));
  const [goal, setGoal] = useState(initial?.meta?.goal || '');

  return (
    <div className="sprint-form">
      <div className="field">
        <label>Nom *</label>
        <input type="text" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} placeholder="Sprint 13" />
      </div>
      <div className="field">
        <label>Début</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div className="field">
        <label>Fin</label>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div className="field grow">
        <label>Objectif</label>
        <input type="text" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Ce que l'équipe veut livrer" />
      </div>
      <div className="row">
        <button className="btn ghost small" onClick={onCancel}>
          Annuler
        </button>
        <button
          className="btn primary small"
          disabled={!label.trim()}
          onClick={() => onSubmit({ label: label.trim(), startDate: startDate || undefined, endDate: endDate || undefined, goal })}
        >
          {initial ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
      {!initial && <span className="hint">Sans dates, le sprint est enchaîné après le dernier selon la cadence du projet.</span>}
    </div>
  );
}

export function StartSprintDialog({
  sprint,
  onConfirm,
  onCancel,
  busy,
}: {
  sprint: SprintRow;
  onConfirm: (data: { startDate?: string; endDate?: string; goal?: string }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [startDate, setStartDate] = useState(toDateInput(sprint.meta?.startDate) || todayInput());
  const [endDate, setEndDate] = useState(toDateInput(sprint.meta?.endDate));
  const [goal, setGoal] = useState(sprint.meta?.goal || '');
  const invalid = !!(startDate && endDate && endDate < startDate);

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h3>Démarrer « {sprint.label} »</h3>
          <button className="close-btn" onClick={onCancel}>
            Fermer ✕
          </button>
        </div>
        <div className="stack">
          <div className="field-grid" style={{ margin: 0 }}>
            <div className="field">
              <label>Début</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Fin</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Objectif du sprint</label>
            <input type="text" value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
          <div className="notice">
            Engagement enregistré au démarrage : <b>{sprint.stats?.taskCount}</b> tâche(s) · <b>{sprint.stats?.points}</b> points.
          </div>
          {invalid && <div className="form-error">La date de fin précède la date de début.</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onCancel}>
              Annuler
            </button>
            <button
              className="btn primary"
              disabled={invalid || busy}
              onClick={() => onConfirm({ startDate: startDate || undefined, endDate: endDate || undefined, goal })}
            >
              Démarrer le sprint
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CloseSprintDialog({
  projectKey,
  sprint,
  onCancel,
  onClosed,
}: {
  projectKey: string;
  sprint: SprintRow;
  onCancel: () => void;
  onClosed: (message: string) => void;
}) {
  const { data: preview, isLoading, error } = useClosePreview(projectKey, sprint.key);
  const m = useSprintMutations(projectKey);
  const [mode, setMode] = useState<'sprint' | 'backlog' | 'newSprint'>('sprint');
  const [targetKey, setTargetKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [keep, setKeep] = useState<string[]>([]);
  const [startTarget, setStartTarget] = useState(true);
  const [createRetro, setCreateRetro] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!preview || targetKey) return;
    if (preview.targets[0]) setTargetKey(preview.targets[0].key);
    else setMode(preview.notDone.length ? 'newSprint' : 'backlog');
  }, [preview]);

  const carried = (preview?.notDone || []).filter((t) => !keep.includes(t.taskId));
  const carriedPoints = carried.reduce((a, t) => a + (t.complexity || 0), 0);
  const canSubmit = mode === 'backlog' || (mode === 'sprint' && !!targetKey) || (mode === 'newSprint' && !!newLabel.trim());

  async function submit() {
    setErr(null);
    try {
      const r = await m.close.mutateAsync({
        key: sprint.key,
        data: {
          carryOver: {
            mode,
            targetKey: mode === 'sprint' ? targetKey : undefined,
            newSprint: mode === 'newSprint' ? { label: newLabel.trim() } : undefined,
          },
          keep,
          startTarget: mode !== 'backlog' && startTarget,
          createRetro,
        },
      });
      onClosed(
        `« ${sprint.label} » clôturé : ${r.carriedOver} tâche(s) reportée(s)${r.retroEventId ? ', rétrospective créée dans Rituels' : ''}.`
      );
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal wide">
        <div className="modal-head">
          <h3>Clôturer « {sprint.label} »</h3>
          <button className="close-btn" onClick={onCancel}>
            Fermer ✕
          </button>
        </div>
        {isLoading && <div className="loadbox">Analyse du sprint…</div>}
        {error && <div className="form-error">{errorMessage(error)}</div>}
        {preview && (
          <div className="stack">
            <div className="close-summary">
              <div className="kpi">
                <div className="v" style={{ color: 'var(--success)' }}>
                  {preview.done.count} · {preview.done.points} pts
                </div>
                <div className="l">Terminées</div>
              </div>
              <div className="kpi">
                <div className="v" style={{ color: 'var(--gold)' }}>
                  {preview.notDone.length} · {preview.notDone.reduce((a, t) => a + (t.complexity || 0), 0)} pts
                </div>
                <div className="l">Non terminées</div>
              </div>
              <div className="kpi">
                <div className="v">{sprint.meta?.startSnapshot?.committedPoints ?? '—'}</div>
                <div className="l">Engagé au démarrage</div>
              </div>
            </div>

            {preview.notDone.length > 0 && (
              <div className="table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Tâche</th>
                      <th>Statut</th>
                      <th>Points</th>
                      <th>Assigné</th>
                      <th title="Laisser la tâche dans le sprint clôturé">Garder ici</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.notDone.map((t) => (
                      <tr key={t.taskId}>
                        <td>
                          <span className="mono text-muted">{t.taskId}</span> {t.title}
                        </td>
                        <td>{t.status}</td>
                        <td>{t.complexity}</td>
                        <td>{t.assignee ? <Avatar name={t.assignee.displayName} color={t.assignee.color} size="sm" /> : '—'}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={keep.includes(t.taskId)}
                            onChange={(e) => setKeep((k) => (e.target.checked ? [...k, t.taskId] : k.filter((x) => x !== t.taskId)))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="field">
              <label>
                Reporter {carried.length} tâche(s) · {carriedPoints} pts vers
              </label>
              <div className="stack" style={{ gap: 6 }}>
                <label className="row radio">
                  <input type="radio" checked={mode === 'sprint'} disabled={!preview.targets.length} onChange={() => setMode('sprint')} />
                  Sprint existant
                  <select value={targetKey} disabled={mode !== 'sprint'} onChange={(e) => setTargetKey(e.target.value)}>
                    {preview.targets.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label} ({SPRINT_STATUS_META[t.status]?.label || t.status})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row radio">
                  <input type="radio" checked={mode === 'newSprint'} onChange={() => setMode('newSprint')} />
                  Nouveau sprint
                  <input type="text" value={newLabel} disabled={mode !== 'newSprint'} placeholder="Sprint suivant" onChange={(e) => setNewLabel(e.target.value)} />
                </label>
                <label className="row radio">
                  <input type="radio" checked={mode === 'backlog'} onChange={() => setMode('backlog')} />
                  Backlog (sans sprint)
                </label>
              </div>
            </div>
            <label className="row radio">
              <input type="checkbox" checked={startTarget && mode !== 'backlog'} disabled={mode === 'backlog'} onChange={(e) => setStartTarget(e.target.checked)} />
              Démarrer immédiatement le sprint cible
            </label>
            <label className="row radio">
              <input type="checkbox" checked={createRetro} onChange={(e) => setCreateRetro(e.target.checked)} />
              Créer la rétrospective pré-remplie (rituel « Rétrospective »)
            </label>
            {err && <div className="form-error">{err}</div>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={onCancel}>
                Annuler
              </button>
              <button className="btn primary" disabled={!canSubmit || m.close.isPending} onClick={submit}>
                {m.close.isPending ? 'Clôture…' : 'Clôturer le sprint'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
