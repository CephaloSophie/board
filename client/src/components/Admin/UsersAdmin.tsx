import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { errorMessage, get } from '../../api/client';
import { useCreateUser, useDeleteUser, useUpdateUser } from '../../api/users';
import { useAuth } from '../../context/AuthContext';
import type { PublicUser, Role } from '../../types';
import Avatar from '../common/Avatar';

// Global account administration (superadmin): create, edit, reset password,
// deactivate / reactivate.
export default function UsersAdmin() {
  const { user: me } = useAuth();
  const { data: users } = useQuery({
    queryKey: ['users', 'all'],
    queryFn: () => get<{ users: PublicUser[] }>('/users?includeInactive=1').then((r) => r.users),
  });
  const createUser = useCreateUser();
  const [creating, setCreating] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = (users || []).filter((u) => showInactive || u.active);

  return (
    <div>
      <div className="section-head">
        <h2 className="mt-0">Utilisateurs</h2>
        <button className="btn primary small" onClick={() => setCreating(true)}>
          + Nouvel utilisateur
        </button>
      </div>
      <p className="text-muted section-intro">
        Comptes globaux de l'application. Les droits sur chaque projet se règlent dans Paramètres du projet → Membres & rôles.
      </p>
      <label className="row radio" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Afficher les comptes désactivés
      </label>
      {error && <div className="form-error">{error}</div>}

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th />
              <th>Nom affiché</th>
              <th>Identifiant</th>
              <th>Email</th>
              <th>Rôle global</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === me?.id} onError={setError} />
            ))}
          </tbody>
        </table>
      </div>

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

function UserRow({ user, isSelf, onError }: { user: PublicUser; isSelf: boolean; onError: (m: string | null) => void }) {
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email || '');

  async function save(data: Partial<PublicUser> & { password?: string }) {
    onError(null);
    try {
      await updateUser.mutateAsync({ id: user.id, data });
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <tr style={user.active ? undefined : { opacity: 0.55 }}>
      <td>
        <label title="Couleur">
          <Avatar name={user.displayName} color={user.color} size="sm" />
          <input type="color" value={user.color} onChange={(e) => save({ color: e.target.value })} style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }} />
        </label>
      </td>
      <td>
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} onBlur={() => displayName.trim() && displayName !== user.displayName && save({ displayName: displayName.trim() })} />
      </td>
      <td className="mono">{user.username}</td>
      <td>
        <input type="text" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => email !== (user.email || '') && save({ email })} />
      </td>
      <td>
        <select value={user.role} disabled={isSelf} onChange={(e) => save({ role: e.target.value as Role })}>
          <option value="developer">développeur</option>
          <option value="superadmin">super admin</option>
        </select>
      </td>
      <td>{user.active ? 'Actif' : 'Désactivé'}</td>
      <td className="nowrap">
        <button
          className="btn small ghost"
          onClick={() => {
            const password = prompt(`Nouveau mot de passe pour ${user.displayName} (8 caractères minimum) :`);
            if (password && password.length >= 8) save({ password });
            else if (password) onError('Mot de passe trop court (8 caractères minimum).');
          }}
        >
          Mot de passe…
        </button>
        {user.active ? (
          <button
            className="btn small danger"
            disabled={isSelf}
            onClick={() => confirm(`Désactiver ${user.displayName} ?`) && deleteUser.mutate(user.id)}
          >
            Désactiver
          </button>
        ) : (
          <button className="btn small" onClick={() => save({ active: true })}>
            Réactiver
          </button>
        )}
      </td>
    </tr>
  );
}

function NewUserForm({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (data: { username: string; displayName: string; password: string; role: string; email?: string }) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('developer');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (password.length < 8) {
      setErr('Mot de passe trop court (8 caractères minimum).');
      return;
    }
    try {
      await onSubmit({ username: username.trim().toLowerCase(), displayName: displayName.trim(), email, password, role });
    } catch (e) {
      setErr(errorMessage(e));
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
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label>Identifiant</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Mot de passe</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="field">
            <label>Rôle global</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="developer">développeur</option>
              <option value="superadmin">super admin</option>
            </select>
          </div>
          {err && <div className="form-error">{err}</div>}
          <button className="btn primary" disabled={!username || !displayName || !password} onClick={submit}>
            Créer
          </button>
        </div>
      </div>
    </div>
  );
}
