import { useState } from 'react';
import type { Team, TeamMember, TeamRole } from '../../types';
import { useTeams, useCreateTeam, useUpdateTeam, useDeleteTeam } from '../../api/teams';
import { useUsers } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import { isManager, TEAM_ROLE_LABELS, TEAM_ROLE_ORDER } from '../../utils/roles';
import Avatar from '../common/Avatar';
import { TextField } from '../common/Field';

function idOf(u: TeamMember['user']): string {
  return typeof u === 'object' ? u._id : u;
}

export default function TeamsAdmin({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const canEdit = isManager(user?.role);
  const { data: teams } = useTeams(projectKey);
  const { data: users } = useUsers();
  const createTeam = useCreateTeam(projectKey);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#e6c46a');

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="mt-0">Équipes</h2>
      </div>
      <p className="text-muted" style={{ fontSize: 12.5 }}>
        Constituez les équipes du projet : membres, rôle dans l'équipe (Lead, PO, SM, Dev, QA…) et
        capacité par sprint (points). La capacité alimente le tableau de bord Scrum.
      </p>

      {canEdit && (
        <div className="form-row">
          <div style={{ width: 240 }}>
            <TextField label="Nom de l'équipe" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44 }} />
          <button
            className="btn primary small"
            disabled={!name.trim() || createTeam.isPending}
            onClick={() =>
              createTeam.mutate(
                { name: name.trim(), color },
                { onSuccess: () => setName('') }
              )
            }
          >
            + Créer une équipe
          </button>
        </div>
      )}

      <div className="team-cards">
        {teams?.map((t) => (
          <TeamCard key={t._id} projectKey={projectKey} team={t} canEdit={canEdit} users={users} />
        ))}
        {teams?.length === 0 && <div className="empty">Aucune équipe pour le moment.</div>}
      </div>
    </div>
  );
}

function TeamCard({
  projectKey,
  team,
  canEdit,
  users,
}: {
  projectKey: string;
  team: Team;
  canEdit: boolean;
  users: ReturnType<typeof useUsers>['data'];
}) {
  const updateTeam = useUpdateTeam(projectKey);
  const deleteTeam = useDeleteTeam(projectKey);
  const [addUser, setAddUser] = useState('');

  const memberIds = new Set(team.members.map((m) => idOf(m.user)));
  const available = (users || []).filter((u) => !memberIds.has(u.id));
  const membersCapacity = team.members.reduce((a, m) => a + (m.capacityPoints || 0), 0);
  const effectiveCapacity = team.capacityPoints || membersCapacity;

  function setMembers(members: TeamMember[]) {
    updateTeam.mutate({ id: team._id, data: { members } });
  }

  function addMember() {
    if (!addUser) return;
    setMembers([...team.members, { user: addUser, teamRole: 'developer', capacityPoints: 0 }]);
    setAddUser('');
  }

  return (
    <div className="team-card" style={{ borderTopColor: team.color }}>
      <div className="team-card__head">
        <span className="team-card__dot" style={{ background: team.color }} />
        {canEdit ? (
          <input
            className="team-card__name-input"
            defaultValue={team.name}
            onBlur={(e) => e.target.value !== team.name && updateTeam.mutate({ id: team._id, data: { name: e.target.value } })}
          />
        ) : (
          <span className="team-card__name">{team.name}</span>
        )}
        {canEdit && (
          <button
            className="btn danger small"
            style={{ marginLeft: 'auto' }}
            onClick={() => confirm(`Supprimer l'équipe "${team.name}" ?`) && deleteTeam.mutate(team._id)}
          >
            Suppr.
          </button>
        )}
      </div>

      <div className="team-card__cap">
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Capacité équipe / sprint (pts)</label>
          <input
            type="number"
            min={0}
            defaultValue={team.capacityPoints}
            disabled={!canEdit}
            onBlur={(e) => Number(e.target.value) !== team.capacityPoints && updateTeam.mutate({ id: team._id, data: { capacityPoints: Number(e.target.value) || 0 } })}
          />
          <span className="text-muted" style={{ fontSize: 10.5 }}>
            Effective : <b>{effectiveCapacity} pts</b> {team.capacityPoints ? '(équipe)' : `(somme membres : ${membersCapacity})`}
          </span>
        </div>
      </div>

      <div className="team-members">
        {team.members.map((m, i) => {
          const u = typeof m.user === 'object' ? m.user : null;
          return (
            <div className="team-member" key={idOf(m.user)}>
              <Avatar name={u?.displayName || '?'} color={u?.color} size="sm" />
              <span className="team-member__name">{u?.displayName || idOf(m.user)}</span>
              {canEdit ? (
                <>
                  <select
                    value={m.teamRole}
                    onChange={(e) => {
                      const next = [...team.members];
                      next[i] = { ...m, teamRole: e.target.value as TeamRole };
                      setMembers(next);
                    }}
                  >
                    {TEAM_ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {TEAM_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    title="Capacité (pts)"
                    style={{ width: 64 }}
                    defaultValue={m.capacityPoints}
                    onBlur={(e) => {
                      const val = Number(e.target.value) || 0;
                      if (val === m.capacityPoints) return;
                      const next = [...team.members];
                      next[i] = { ...m, capacityPoints: val };
                      setMembers(next);
                    }}
                  />
                  <button
                    className="icon-btn"
                    title="Retirer"
                    onClick={() => setMembers(team.members.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <>
                  <span className="tag">{TEAM_ROLE_LABELS[m.teamRole]}</span>
                  <span className="tag pts">{m.capacityPoints} pts</span>
                </>
              )}
            </div>
          );
        })}
        {team.members.length === 0 && <div className="text-muted" style={{ fontSize: 12 }}>Aucun membre.</div>}
      </div>

      {canEdit && available.length > 0 && (
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <select value={addUser} onChange={(e) => setAddUser(e.target.value)} style={{ flex: 1 }}>
            <option value="">+ Ajouter un membre…</option>
            {available.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={!addUser} onClick={addMember}>
            Ajouter
          </button>
        </div>
      )}
    </div>
  );
}
