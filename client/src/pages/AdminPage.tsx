import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TaxonomyAdmin from '../components/Admin/TaxonomyAdmin';
import UsersAdmin from '../components/Admin/UsersAdmin';
import ProjectSettings from '../components/Admin/ProjectSettings';

type Tab = 'taxonomies' | 'users' | 'project';

export default function AdminPage() {
  const { projectKey } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('taxonomies');
  if (!projectKey) return null;

  return (
    <div className="admin-layout">
      <nav className="admin-nav">
        <button className={tab === 'taxonomies' ? 'active' : ''} onClick={() => setTab('taxonomies')}>
          Taxonomies
        </button>
        {user?.role === 'superadmin' && (
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
            Utilisateurs
          </button>
        )}
        <button className={tab === 'project' ? 'active' : ''} onClick={() => setTab('project')}>
          Projet
        </button>
      </nav>
      <div className="admin-panel">
        {tab === 'taxonomies' && <TaxonomyAdmin projectKey={projectKey} />}
        {tab === 'users' && user?.role === 'superadmin' && <UsersAdmin />}
        {tab === 'project' && <ProjectSettings projectKey={projectKey} />}
      </div>
    </div>
  );
}
