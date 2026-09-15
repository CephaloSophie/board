import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useUpdateProject } from '../../api/projects';
import { useVersionMutations, useVersions } from '../../api/versions';
import { useProjectRole } from '../../hooks/useProjectRole';
import { fmtDay, toDateInput, todayInput } from '../../utils/dates';
import type { VersionRow } from '../../types';

export default function VersionsPanel({ projectKey }: { projectKey: string }) {
  const { isAdmin } = useProjectRole(projectKey);
  const { data } = useVersions(projectKey);
  const vm = useVersionMutations(projectKey);
  const updateProject = useUpdateProject(projectKey);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VersionRow | null>(null);
  const [releasing, setReleasing] = useState<VersionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const versions = data?.versions || [];
  const current = data?.currentVersion;

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div className="section-head">
        <h2>Versions</h2>
        {isAdmin && !creating && (
          <button className="btn primary small" onClick={() => setCreating(true)}>
            + Nouvelle version
          </button>
        )}
      </div>
      {error && <div className="form-error">{error}</div>}
      {creating && (
        <VersionForm
          onCancel={() => setCreating(false)}
          onSubmit={(input) => run(() => vm.create.mutateAsync(input).then(() => setCreating(false)))}
        />
      )}
      {editing && (
        <VersionForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSubmit={(input) => run(() => vm.update.mutateAsync({ key: editing.key, data: input }).then(() => setEditing(null)))}
        />
      )}
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Statut</th>
              <th>Début</th>
              <th>Sortie prévue</th>
              <th>Avancement</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const pct = v.stats.taskCount ? Math.round((v.stats.doneCount / v.stats.taskCount) * 100) : 0;
              return (
                <tr key={v._id}>
                  <td>
                    <b>{v.label}</b> {v.key === current && <span className="tag pts">★ courante</span>}
                    {v.meta?.description && <div className="text-muted small-text">{v.meta?.description}</div>}
                  </td>
                  <td>
                    {v.status === 'released' ? (
                      <span className="tag type">publiée le {fmtDay(v.meta?.releasedAt)}</span>
                    ) : (
                      <span className="tag">non publiée</span>
                    )}
                  </td>
                  <td>{fmtDay(v.meta?.startDate)}</td>
                  <td>{fmtDay(v.meta?.releaseDate)}</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="small-text">
                      {v.stats.doneCount}/{v.stats.taskCount} tâches · {v.stats.points} pts
                    </div>
                    <div className="progress">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="row wrap">
                        {v.key !== current && (
                          <button className="btn small ghost" onClick={() => run(() => updateProject.mutateAsync({ currentVersion: v.key }))}>
                            Définir courante
                          </button>
                        )}
                        {v.status === 'unreleased' ? (
                          <button className="btn small primary" onClick={() => setReleasing(v)}>
                            Publier…
                          </button>
                        ) : (
                          <button className="btn small ghost" onClick={() => run(() => vm.unrelease.mutateAsync(v.key))}>
                            Dépublier
                          </button>
                        )}
                        <button className="btn small ghost" onClick={() => setEditing(v)}>
                          Modifier
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {versions.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Aucune version.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {releasing && (
        <ReleaseDialog
          version={releasing}
          versions={versions}
          onCancel={() => setReleasing(null)}
          busy={vm.release.isPending}
          onConfirm={(input) => run(() => vm.release.mutateAsync({ key: releasing.key, data: input }).then(() => setReleasing(null)))}
        />
      )}
    </div>
  );
}

function VersionForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: VersionRow;
  onSubmit: (input: { key?: string; label?: string; startDate?: string; releaseDate?: string; description?: string }) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(initial?.key || '');
  const [label, setLabel] = useState(initial?.label || '');
  const [startDate, setStartDate] = useState(toDateInput(initial?.meta?.startDate));
  const [releaseDate, setReleaseDate] = useState(toDateInput(initial?.meta?.releaseDate));
  const [description, setDescription] = useState(initial?.meta?.description || '');

  return (
    <div className="sprint-form">
      <div className="field">
        <label>Numéro *</label>
        <input type="text" value={key} disabled={!!initial} autoFocus onChange={(e) => setKey(e.target.value)} placeholder="12.5.0" />
      </div>
      <div className="field">
        <label>Libellé</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={key || 'identique au numéro'} />
      </div>
      <div className="field">
        <label>Début</label>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div className="field">
        <label>Sortie prévue</label>
        <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} />
      </div>
      <div className="field grow">
        <label>Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn ghost small" onClick={onCancel}>
          Annuler
        </button>
        <button
          className="btn primary small"
          disabled={!key.trim()}
          onClick={() =>
            onSubmit({
              ...(initial ? {} : { key: key.trim() }),
              label: label.trim() || key.trim(),
              startDate: startDate || undefined,
              releaseDate: releaseDate || undefined,
              description,
            })
          }
        >
          {initial ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </div>
  );
}

function ReleaseDialog({
  version,
  versions,
  onConfirm,
  onCancel,
  busy,
}: {
  version: VersionRow;
  versions: VersionRow[];
  onConfirm: (input: { releasedAt?: string; moveOpenTo?: string; setCurrent?: string }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const others = versions.filter((v) => v.key !== version.key && v.status === 'unreleased');
  const openCount = version.stats.taskCount - version.stats.doneCount;
  const [releasedAt, setReleasedAt] = useState(todayInput());
  const [moveOpenTo, setMoveOpenTo] = useState(others[0]?.key || '');
  const [setCurrent, setSetCurrent] = useState(others[0]?.key || '');

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-head">
          <h3>Publier la version {version.label}</h3>
          <button className="close-btn" onClick={onCancel}>
            Fermer ✕
          </button>
        </div>
        <div className="stack">
          <div className="field">
            <label>Date de publication</label>
            <input type="date" value={releasedAt} onChange={(e) => setReleasedAt(e.target.value)} />
          </div>
          <div className="field">
            <label>{openCount} tâche(s) non terminée(s)</label>
            <select value={moveOpenTo} onChange={(e) => setMoveOpenTo(e.target.value)} disabled={openCount === 0}>
              <option value="">Les laisser sur {version.label}</option>
              {others.map((v) => (
                <option key={v.key} value={v.key}>
                  Déplacer vers {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Nouvelle version courante</label>
            <select value={setCurrent} onChange={(e) => setSetCurrent(e.target.value)}>
              <option value="">Ne pas changer</option>
              {others.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onCancel}>
              Annuler
            </button>
            <button
              className="btn primary"
              disabled={busy}
              onClick={() =>
                onConfirm({
                  releasedAt: releasedAt || undefined,
                  moveOpenTo: openCount && moveOpenTo ? moveOpenTo : undefined,
                  setCurrent: setCurrent || undefined,
                })
              }
            >
              Publier
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
