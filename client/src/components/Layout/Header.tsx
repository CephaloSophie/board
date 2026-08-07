import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useProjects } from '../../api/projects';
import Avatar from '../common/Avatar';
import { roleLabel } from '../../utils/roles';
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
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const location = useLocation();

  // Header sits above the nested <Routes>, so useParams() can't see
  // :projectKey — derive it (and the active section) from the pathname instead.
  const match = location.pathname.match(/^\/projects\/([^/]+)(?:\/([^/]+))?/);
  const projectKey = match?.[1];
  const section = match?.[2] || 'board';

  const navItems = projectKey
    ? [
        { to: `/projects/${projectKey}/board`, label: 'Board', active: section === 'board' || section === 'tasks' },
        { to: `/projects/${projectKey}/dashboard`, label: 'Dashboard', active: section === 'dashboard' },
        { to: `/projects/${projectKey}/events`, label: 'Rituels', active: section === 'events' },
        { to: `/projects/${projectKey}/retros`, label: 'Rétros', active: section === 'retros' },
        { to: `/projects/${projectKey}/admin`, label: 'Administration', active: section === 'admin' },
      ]
    : [];

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

      {navItems.length > 0 && (
        <nav className="main-nav">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to} className={`nav-link${item.active ? ' active' : ''}`}>
              {item.label}
            </Link>
          ))}
        </nav>
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
            <span className="badge-role">{roleLabel(user.role)}</span>
            <button className="btn ghost small" onClick={logout}>
              Déconnexion
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
