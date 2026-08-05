import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { user, login, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/projects" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch {
      // error already surfaced via context
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>
          <b style={{ color: 'var(--gold)' }}>Kýdos</b> Board
        </h1>
        <div className="sub">Connexion à l'espace de gestion des tâches</div>
        <form onSubmit={handleSubmit}>
          <label htmlFor="username">Identifiant</label>
          <input
            id="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="ameur"
          />
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          {error && <div className="error">{error}</div>}
          <button type="submit" className="btn primary" disabled={busy || !username || !password}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
