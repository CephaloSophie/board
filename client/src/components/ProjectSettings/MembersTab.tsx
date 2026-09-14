import { useMemo, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useMemberMutations, useMembers } from '../../api/members';
import { useUpdateProject } from '../../api/projects';
import { useUsers } from '../../api/users';
import { useProjectRole } from '../../hooks/useProjectRole';
import { PROJECT_ROLE_META } from '../../utils/status';
import type { MemberRow, ProjectAccess, ProjectRole } from '../../types';
import Avatar from '../common/Avatar';

const ROLES: ProjectRole[] = ['admin', 'member', 'viewer'];

export default function MembersTab({ projectKey }: { projectKey: string }) {
  const { project, isAdmin } = useProjectRole(projectKey);
  const { data } = useMembers(projectKey);
  const { data: users } = useUsers();
  const mm = useMemberMutations(projectKey);
  const updateProject = useUpdateProject(projectKey);
  const [selected, setSelected] = useState<string[]>([]);
  const [addRole, setAddRole] = useState<ProjectRole>('member');
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [unassign, setUnassign] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const members = data?.members || [];
  const listedIds = useMemo(() => new Set((project?.members || []).map((m) => String(m.user))), [project?.members]);
  const candidates = (users || []).filter((u) => !listedIds.has(u.id) && u.role !== 'superadmin');
  const needle = search.trim().toLowerCase();
  const visible = needle
    ? members.filter((m) => `${m.user.displayName} ${m.user.username}`.toLowerCase().includes(needle))
    : members;

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

  function setAccess(access: ProjectAccess) {
    run(() => updateProject.mutateAsync({ access }), access === 'members' ? 'Accès restreint aux membres listés.' : 'Projet ouvert à tous les utilisateurs actifs.');
  }

  return (
    <div>
      <h2 className="mt-0">Accès au projet</h2>
      <div className="access-options">
        <label className={`access-option${data?.access === 'open' ? ' on' : ''}`}>
          <input type="radio" checked={data?.access === 'open'} disabled={!isAdmin} onChange={() => setAccess('open')} />
          <div>
            <b>Ouvert</b>
            <div className="text-muted small-text">Tout utilisateur actif voit le projet et y travaille comme membre.</div>
          </div>
        </label>
        <label className={`access-option${data?.access === 'members' ? ' on' : ''}`}>
          <input type="radio" checked={data?.access === 'members'} disabled={!isAdmin} onChange={() => setAccess('members')} />
          <div>
            <b>Restreint</b>
            <div className="text-muted small-text">Seuls les membres listés (et les super admins) voient le projet.</div>
          </div>
        </label>
      </div>

      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-ok">{notice}</div>}

      <div className="section-head" style={{ marginTop: 22 }}>
        <h2>Membres ({members.length})</h2>
        <input type="search" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isAdmin && candidates.length > 0 && (
        <div className="add-members">
          <select multiple value={selected} onChange={(e) => setSelected(Array.from(e.target.selectedOptions).map((o) => o.value))} size={Math.min(5, candidates.length)}>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} ({u.username})
              </option>
            ))}
          </select>
          <div className="stack" style={{ gap: 6 }}>
            <select value={addRole} onChange={(e) => setAddRole(e.target.value as ProjectRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {PROJECT_ROLE_META[r].label}
                </option>
              ))}
            </select>
            <button
              className="btn primary small"
              disabled={!selected.length || mm.add.isPending}
              onClick={() =>
                run(
                  () => mm.add.mutateAsync({ userIds: selected, role: addRole }).then(() => setSelected([])),
                  `${selected.length} membre(s) ajouté(s).`
                )
              }
            >
              + Ajouter {selected.length ? `(${selected.length})` : ''}
            </button>
            <span className="hint">Ctrl/⌘ + clic pour sélectionner plusieurs personnes.</span>
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th />
              <th>Nom</th>
              <th>Rôle projet</th>
              <th>Origine</th>
              <th>Tâches ouvertes</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((m) => {
              const fixed = m.isSuperadmin || m.isOwner;
              return (
                <tr key={m.user.id}>
                  <td>
                    <Avatar name={m.user.displayName} color={m.user.color} size="sm" />
                  </td>
                  <td>
                    <b>{m.user.displayName}</b> <span className="mono text-muted">{m.user.username}</span>
                  </td>
                  <td>
                    {isAdmin && !fixed ? (
                      <select value={m.role} onChange={(e) => run(() => mm.setRole.mutateAsync({ userId: m.user.id, role: e.target.value as ProjectRole }))}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {PROJECT_ROLE_META[r].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span title={PROJECT_ROLE_META[m.role].hint}>{PROJECT_ROLE_META[m.role].label}</span>
                    )}
                  </td>
                  <td className="small-text">
                    {m.isSuperadmin && <span className="tag">super admin</span>} {m.isOwner && <span className="tag pts">responsable</span>}{' '}
                    {m.listed ? <span className="tag">membre listé</span> : !m.isSuperadmin && !m.isOwner && <span className="text-muted">accès ouvert</span>}
                  </td>
                  <td>{m.openTaskCount}</td>
                  {isAdmin && (
                    <td>
                      {m.listed && !m.isOwner && (
                        <button
                          className="btn small danger"
                          onClick={() => {
                            setUnassign(false);
                            setRemoving(m);
                          }}
                        >
                          Retirer
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="role-legend">
        {ROLES.map((r) => (
          <div key={r}>
            <b>{PROJECT_ROLE_META[r].label}</b> — {PROJECT_ROLE_META[r].hint}
          </div>
        ))}
      </div>

      {removing && (
        <div className="backdrop" onClick={(e) => e.target === e.currentTarget && setRemoving(null)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head">
              <h3>Retirer {removing.user.displayName}</h3>
              <button className="close-btn" onClick={() => setRemoving(null)}>
                Fermer ✕
              </button>
            </div>
            <div className="stack">
              <p className="text-muted">
                {data?.access === 'open'
                  ? 'Le projet est ouvert : cette personne gardera un accès « membre ».'
                  : 'Cette personne n’aura plus accès au projet.'}
              </p>
              {removing.openTaskCount > 0 && (
                <label className="row radio">
                  <input type="checkbox" checked={unassign} onChange={(e) => setUnassign(e.target.checked)} />
                  Désassigner ses {removing.openTaskCount} tâche(s) ouverte(s)
                </label>
              )}
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={() => setRemoving(null)}>
                  Annuler
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    const target = removing;
                    setRemoving(null);
                    run(() => mm.remove.mutateAsync({ userId: target.user.id, unassignOpenTasks: unassign }), `${target.user.displayName} retiré.`);
                  }}
                >
                  Retirer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
