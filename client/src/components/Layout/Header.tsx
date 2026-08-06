import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useProjects } from '../../api/projects';
import Avatar from '../common/Avatar';
import type { Theme } from '../../types';

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Sombre',
  light: 'Claire',
  ubuntu: 'Ubuntu',
  mac: 'Mac',
};

export default function Header() {
  const { user, logout } = useAuth();
  const { theme, setTheme, themes } = useTheme();
  const { projectKey } = useParams();
  const { data: projects } = useProjects();
  const navigate = useNavigate();

  return (
    <header className="app-header">
      <Link to="/projects" className="brand">
        <b>Kýdos</b> Board
      </Link>

      {projects && projects.length > 0 && (
        <div className="project-switcher ctrl">
          <select
            value={projectKey || ''}
            onChange={(e) => e.target.value && navigate(`/projects/${e.target.value}/board`)}
          >
            <option value="" disabled>
              Choisir un projet…
            </option>
            {projects.map((p) => (
              <option key={p._id} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {projectKey && (
        <>
          <Link className="btn ghost small" to={`/projects/${projectKey}/board`}>
            Board
          </Link>
          <Link className="btn ghost small" to={`/projects/${projectKey}/events`}>
            Rituels
          </Link>
          <Link className="btn ghost small" to={`/projects/${projectKey}/admin`}>
            Administration
          </Link>
        </>
      )}

      <div className="header-spacer" />

      <div className="header-actions">
        <div className="theme-switcher">
          {themes.map((t) => (
            <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>

        {user && (
          <div className="user-chip">
            <Avatar name={user.displayName} color={user.color} size="sm" />
            <span>{user.displayName}</span>
            <span className="badge-role">{user.role === 'superadmin' ? 'super admin' : 'dev'}</span>
            <button className="btn ghost small" onClick={logout}>
              Déconnexion
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
