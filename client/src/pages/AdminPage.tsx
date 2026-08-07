import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSuperadmin } from '../utils/roles';
import TaxonomyAdmin from '../components/Admin/TaxonomyAdmin';
import UsersAdmin from '../components/Admin/UsersAdmin';
import TeamsAdmin from '../components/Admin/TeamsAdmin';
import GroupsAdmin from '../components/Admin/GroupsAdmin';
import ProjectSettings from '../components/Admin/ProjectSettings';

type Tab = 'taxonomies' | 'teams' | 'groups' | 'users' | 'project';

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
        <button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>
          Équipes
        </button>
        <button className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
          Groupes &amp; tags
        </button>
        {isSuperadmin(user?.role) && (
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
        {tab === 'teams' && <TeamsAdmin projectKey={projectKey} />}
        {tab === 'groups' && <GroupsAdmin projectKey={projectKey} />}
        {tab === 'users' && isSuperadmin(user?.role) && <UsersAdmin />}
        {tab === 'project' && <ProjectSettings projectKey={projectKey} />}
      </div>
    </div>
  );
}
