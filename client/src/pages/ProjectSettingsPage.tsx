import { Navigate, NavLink, useParams } from 'react-router-dom';
import { useProjectRole } from '../hooks/useProjectRole';
import { PROJECT_ROLE_META } from '../utils/status';
import GeneralTab from '../components/ProjectSettings/GeneralTab';
import SprintsTab from '../components/ProjectSettings/SprintsTab';
import MembersTab from '../components/ProjectSettings/MembersTab';
import WorkflowTab from '../components/ProjectSettings/WorkflowTab';
import ImportExportTab from '../components/ProjectSettings/ImportExportTab';
import DangerZoneTab from '../components/ProjectSettings/DangerZoneTab';
import TaxonomyAdmin from '../components/Admin/TaxonomyAdmin';

const TABS = [
  { key: 'general', label: 'Général' },
  { key: 'sprints', label: 'Sprints & versions' },
  { key: 'members', label: 'Membres & rôles' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'taxonomies', label: 'Taxonomies' },
  { key: 'import', label: 'Import / Export' },
  { key: 'danger', label: '⚠ Zone dangereuse' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function ProjectSettingsPage() {
  const { projectKey, tab } = useParams();
  const { project, role, isAdmin } = useProjectRole(projectKey);
  if (!projectKey) return null;
  if (!tab || !TABS.some((t) => t.key === tab)) return <Navigate to={`/projects/${projectKey}/settings/general`} replace />;
  const current = tab as TabKey;

  return (
    <div className="settings-page">
      <div className="settings-head">
        <div>
          <div className="settings-head__eyebrow">Paramètres du projet</div>
          <h2>
            {project?.name || projectKey} <span className="tag">{projectKey}</span>
            {project?.archived && <span className="tag danger-tag">archivé</span>}
          </h2>
        </div>
        {role && (
          <span className="badge-role" title={PROJECT_ROLE_META[role].hint}>
            votre rôle : {PROJECT_ROLE_META[role].label}
          </span>
        )}
      </div>

      {role && !isAdmin && (
        <div className="notice">Lecture seule : seuls les administrateurs du projet peuvent modifier ces paramètres.</div>
      )}

      <nav className="settings-tabs">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={`/projects/${projectKey}/settings/${t.key}`}
            className={({ isActive }) => `settings-tab${isActive ? ' active' : ''}${t.key === 'danger' ? ' danger' : ''}`}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <div className="admin-panel settings-panel">
        {current === 'general' && <GeneralTab projectKey={projectKey} />}
        {current === 'sprints' && <SprintsTab projectKey={projectKey} />}
        {current === 'members' && <MembersTab projectKey={projectKey} />}
        {current === 'workflow' && <WorkflowTab projectKey={projectKey} />}
        {current === 'taxonomies' && <TaxonomyAdmin projectKey={projectKey} />}
        {current === 'import' && <ImportExportTab projectKey={projectKey} />}
        {current === 'danger' && <DangerZoneTab projectKey={projectKey} />}
      </div>
    </div>
  );
}
