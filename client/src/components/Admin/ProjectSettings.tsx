import { useEffect, useState } from 'react';
import { useProject, useUpdateProject } from '../../api/projects';
import { useAuth } from '../../context/AuthContext';

export default function ProjectSettings({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const { data: project } = useProject(projectKey);
  const updateProject = useUpdateProject(projectKey);
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setVendor(project.vendor || '');
    setDescription(project.description || '');
    setCurrentVersion(project.currentVersion);
  }, [project?._id]);

  if (!project) return <div className="loadbox">Chargement…</div>;
  const canEdit = user?.role === 'superadmin';

  return (
    <div>
      <h2 className="mt-0">Paramètres du projet</h2>
      <div className="stack" style={{ maxWidth: 460 }}>
        <div className="field">
          <label>Clé</label>
          <input value={project.key} disabled />
        </div>
        <div className="field">
          <label>Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="field">
          <label>Éditeur</label>
          <input value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="field">
          <label>Version actuelle</label>
          <input value={currentVersion} onChange={(e) => setCurrentVersion(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
        </div>
        {canEdit && (
          <button
            className="btn primary"
            onClick={() => updateProject.mutate({ name, vendor, description, currentVersion })}
            disabled={updateProject.isPending}
          >
            Enregistrer
          </button>
        )}
      </div>
    </div>
  );
}
