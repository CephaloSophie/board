import { useState } from 'react';
import type { PublicUser, Role } from '../../types';
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers } from '../../api/users';
import { ROLE_LABELS, ROLE_ORDER } from '../../utils/roles';
import Avatar from '../common/Avatar';

export default function UsersAdmin() {
  const { data: users } = useUsers();
  const createUser = useCreateUser();
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="mt-0">Utilisateurs</h2>
        <button className="btn primary small" onClick={() => setCreating(true)}>
          + Nouvel utilisateur
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 12.5 }}>
        Le super admin crée les comptes des développeurs et gère les rôles.
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            <th></th>
            <th>Nom</th>
            <th>Identifiant</th>
            <th>Email</th>
            <th>Rôle</th>
            <th>Statut</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users?.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </tbody>
      </table>

      {creating && (
        <NewUserForm
          onClose={() => setCreating(false)}
          onSubmit={async (data) => {
            await createUser.mutateAsync(data);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function UserRow({ user }: { user: PublicUser }) {
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const [role, setRole] = useState(user.role);

  return (
    <tr>
      <td>
        <Avatar name={user.displayName} color={user.color} size="sm" />
      </td>
      <td>{user.displayName}</td>
      <td style={{ fontFamily: 'var(--mono)' }}>{user.username}</td>
      <td className="text-muted">{user.email || '—'}</td>
      <td>
        <select
          value={role}
          onChange={(e) => {
            const next = e.target.value as Role;
            setRole(next);
            updateUser.mutate({ id: user.id, data: { role: next } });
          }}
        >
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td>{user.active ? 'Actif' : 'Désactivé'}</td>
      <td>
        <button
          className="btn danger small"
          onClick={() => {
            if (confirm(`Désactiver ${user.displayName} ?`)) deleteUser.mutate(user.id);
          }}
        >
          Désactiver
        </button>
      </td>
    </tr>
  );
}

function NewUserForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: { username: string; displayName: string; password: string; role: string; email?: string; color?: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('developer');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    try {
      await onSubmit({ username: username.trim().toLowerCase(), displayName: displayName.trim(), email, password, role });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur.');
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-head">
          <h3>Nouvel utilisateur</h3>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>
        <div className="stack">
          <div className="field">
            <label>Nom affiché</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label>Identifiant</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Mot de passe</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>Rôle</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          {err && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</div>}
          <button className="btn primary" disabled={!username || !displayName || !password} onClick={submit}>
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}
