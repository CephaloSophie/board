import { useProjectMembers, useSetProjectRole, useClearProjectRole } from '../../api/projectMembers';
import { useUsers } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import { isManager, ROLE_LABELS, ROLE_ORDER } from '../../utils/roles';
import type { Role } from '../../types';
import Avatar from '../common/Avatar';

// Per-project role overrides: give a person a different role on THIS project
// than their global account role (e.g. a global developer who is Scrum Master
// here). Empty = inherit the global role.
export default function MembersAdmin({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const canEdit = isManager(user?.role);
  const { data } = useProjectMembers(projectKey);
  const { data: users } = useUsers();
  const setRole = useSetProjectRole(projectKey);
  const clearRole = useClearProjectRole(projectKey);

  const overrides = new Map((data?.members || []).map((m) => [m.user._id, m.role]));

  return (
    <div>
      <h2 className="mt-0">Membres &amp; rôles du projet</h2>
      <p className="text-muted" style={{ fontSize: 12.5 }}>
        Attribuez à chaque personne un rôle <b>spécifique à ce projet</b>. Il prime sur le rôle global
        du compte (sauf super admin). Laissez « — hérité — » pour conserver le rôle global.
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th></th>
            <th>Nom</th>
            <th>Rôle global</th>
            <th>Rôle sur ce projet</th>
          </tr>
        </thead>
        <tbody>
          {(users || []).map((u) => {
            const projectRole = overrides.get(u.id);
            return (
              <tr key={u.id}>
                <td><Avatar name={u.displayName} color={u.color} size="sm" /></td>
                <td>{u.displayName}</td>
                <td className="text-muted">{ROLE_LABELS[u.role]}</td>
                <td>
                  <select
                    value={projectRole || ''}
                    disabled={!canEdit}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) clearRole.mutate(u.id);
                      else setRole.mutate({ userId: u.id, role: v as Role });
                    }}
                  >
                    <option value="">— hérité ({ROLE_LABELS[u.role]}) —</option>
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
