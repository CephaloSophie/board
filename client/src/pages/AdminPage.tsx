import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import UsersAdmin from '../components/Admin/UsersAdmin';

// Legacy /projects/:key/admin links now point to the project settings page.
export function LegacyAdminRedirect() {
  const { projectKey } = useParams();
  return <Navigate to={`/projects/${projectKey}/settings/general`} replace />;
}

// Global user administration (/admin/users), superadmin only.
export default function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== 'superadmin') return <Navigate to="/projects" replace />;
  return (
    <main className="settings-page">
      <div className="settings-head">
        <div>
          <div className="settings-head__eyebrow">Administration globale</div>
          <h2>Utilisateurs</h2>
        </div>
      </div>
      <div className="admin-panel settings-panel">
        <UsersAdmin />
      </div>
    </main>
  );
}
