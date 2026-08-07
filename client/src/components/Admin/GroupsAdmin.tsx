import { useState } from 'react';
import type { GroupKind, UserGroup } from '../../types';
import { useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup } from '../../api/groups';
import { useUsers } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import { isManager } from '../../utils/roles';
import UserMultiSelect from '../common/UserMultiSelect';

export default function GroupsAdmin({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const canEdit = isManager(user?.role);
  const { data: groups } = useGroups(projectKey);
  const { data: users } = useUsers();
  const createGroup = useCreateGroup(projectKey);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<GroupKind>('group');
  const [color, setColor] = useState('#6b78ea');
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    if (!name.trim()) return;
    try {
      await createGroup.mutateAsync({ name: name.trim(), kind, color });
      setName('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur.');
    }
  }

  return (
    <div>
      <h2 className="mt-0">Groupes &amp; tags</h2>
      <p className="text-muted" style={{ fontSize: 12.5 }}>
        Regroupez les personnes par <b>groupe</b> ou par <b>tag</b>, puis réutilisez-les — par exemple
        pour restreindre qui peut voter dans un Planning Poker.
      </p>

      {canEdit && (
        <div className="form-row">
          <select value={kind} onChange={(e) => setKind(e.target.value as GroupKind)}>
            <option value="group">Groupe</option>
            <option value="tag">Tag</option>
          </select>
          <input placeholder="Nom" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44 }} />
          <button className="btn primary small" disabled={createGroup.isPending} onClick={add}>
            + Créer
          </button>
          {err && <span style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</span>}
        </div>
      )}

      <div className="team-cards">
        {groups?.map((g) => (
          <GroupCard key={g._id} projectKey={projectKey} group={g} canEdit={canEdit} users={users} />
        ))}
        {groups?.length === 0 && <div className="empty">Aucun groupe ni tag.</div>}
      </div>
    </div>
  );
}

function GroupCard({
  projectKey,
  group,
  canEdit,
  users,
}: {
  projectKey: string;
  group: UserGroup;
  canEdit: boolean;
  users: ReturnType<typeof useUsers>['data'];
}) {
  const updateGroup = useUpdateGroup(projectKey);
  const deleteGroup = useDeleteGroup(projectKey);
  const selected = group.members.map((m) => m._id);

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    updateGroup.mutate({ id: group._id, data: { members: next as unknown as UserGroup['members'] } });
  }

  return (
    <div className="team-card" style={{ borderTopColor: group.color }}>
      <div className="team-card__head">
        <span className="team-card__dot" style={{ background: group.color }} />
        <span className="team-card__name">{group.name}</span>
        <span className="tag" style={{ marginLeft: 4 }}>{group.kind === 'tag' ? '# tag' : 'groupe'}</span>
        {canEdit && (
          <button
            className="btn danger small"
            style={{ marginLeft: 'auto' }}
            onClick={() => confirm(`Supprimer "${group.name}" ?`) && deleteGroup.mutate(group._id)}
          >
            Suppr.
          </button>
        )}
      </div>
      <div className="text-muted" style={{ fontSize: 11, marginBottom: 8 }}>
        {group.members.length} membre(s)
      </div>
      {canEdit ? (
        <UserMultiSelect users={users} selectedIds={selected} onToggle={toggle} />
      ) : (
        <div className="multi-select-chips">
          {group.members.map((m) => (
            <span key={m._id} className="pick-chip">
              {m.displayName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
