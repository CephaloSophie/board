import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import { useCreateProject, useProjects } from '../api/projects';
import { PROJECT_ROLE_META } from '../utils/status';

export default function ProjectsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: projects, isLoading } = useProjects({ archived: showArchived });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <main className="board-main">
      <div className="page-toolbar" style={{ padding: '18px 0' }}>
        <h2 className="mt-0" style={{ flex: 1 }}>
          {showArchived ? 'Projets archivés' : 'Projets'}
        </h2>
        <button className="btn ghost small" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? '← Projets actifs' : 'Projets archivés'}
        </button>
        {user?.role === 'superadmin' && !showArchived && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Nouveau projet
          </button>
        )}
      </div>

      {isLoading && <div className="loadbox">Chargement des projets…</div>}

      <div className="project-grid">
        {projects?.map((p) => (
          <div key={p._id} className="card project-card" onClick={() => navigate(`/projects/${p.key}/board`)}>
            <div className="card__top">
              <span className="tag">{p.key}</span>
              <span className="tag">v{p.currentVersion}</span>
              {p.access === 'members' && <span className="tag" title="Accès restreint aux membres">🔒 restreint</span>}
              {p.myRole && <span className="tag pts" style={{ marginLeft: 'auto' }}>{PROJECT_ROLE_META[p.myRole].label}</span>}
            </div>
            <div className="card__title" style={{ fontSize: 15 }}>
              {p.name}
            </div>
            {p.description && <p className="project-card__desc">{p.description}</p>}
          </div>
        ))}
      </div>

      {!isLoading && projects?.length === 0 && (
        <div className="empty">{showArchived ? 'Aucun projet archivé.' : 'Aucun projet pour le moment.'}</div>
      )}

      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </main>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const createProject = useCreateProject();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [currentVersion, setCurrentVersion] = useState('0.1.0');
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit() {
    setErr(null);
    try {
      const { project } = await createProject.mutateAsync({ key, name, vendor, description, currentVersion });
      onClose();
      navigate(`/projects/${project.key}/settings/general`);
    } catch (e) {
      setErr(errorMessage(e, 'Erreur lors de la création.'));
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>Nouveau projet</h3>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>
        <div className="stack">
          <div className="field">
            <label>Clé (préfixe des tâches, 2 à 10 caractères)</label>
            <input type="text" value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="KB" maxLength={10} />
          </div>
          <div className="field">
            <label>Nom</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon projet" />
          </div>
          <div className="field">
            <label>Éditeur / vendor</label>
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div className="field">
            <label>Version actuelle</label>
            <input type="text" value={currentVersion} onChange={(e) => setCurrentVersion(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <p className="text-muted small-text">
            Le projet est créé avec un workflow, des priorités, des types et des rituels par défaut, modifiables ensuite. Vous pourrez aussi
            importer un export Jira depuis Paramètres → Import / Export.
          </p>
          {err && <div className="form-error">{err}</div>}
          <button className="btn primary" disabled={key.length < 2 || !name || createProject.isPending} onClick={submit}>
            {createProject.isPending ? 'Création…' : 'Créer le projet'}
          </button>
        </div>
      </div>
    </div>
  );
}
