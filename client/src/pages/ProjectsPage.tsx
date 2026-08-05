import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCreateProject, useProjects } from '../api/projects';

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <main className="board-main">
      <div className="page-toolbar" style={{ padding: '18px 0' }}>
        <h2 className="mt-0" style={{ flex: 1 }}>
          Projets
        </h2>
        {user?.role === 'superadmin' && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Nouveau projet
          </button>
        )}
      </div>

      {isLoading && <div className="loadbox">Chargement des projets…</div>}

      <div className="columns">
        {projects?.map((p) => (
          <div
            key={p._id}
            className="card"
            style={{ padding: 16 }}
            onClick={() => navigate(`/projects/${p.key}/board`)}
          >
            <div className="card__top">
              <span className="tag">{p.key}</span>
              <span className="tag">v{p.currentVersion}</span>
            </div>
            <div className="card__title" style={{ fontSize: 15 }}>
              {p.name}
            </div>
            {p.description && <p style={{ fontSize: 12, color: 'var(--mute)' }}>{p.description}</p>}
          </div>
        ))}
      </div>

      {!isLoading && projects?.length === 0 && (
        <div className="empty">Aucun projet pour le moment.</div>
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
      navigate(`/projects/${project.key}/board`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors de la création.');
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
            <label>Clé (préfixe des tâches)</label>
            <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="KB" />
          </div>
          <div className="field">
            <label>Nom</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon projet" />
          </div>
          <div className="field">
            <label>Éditeur / vendor</label>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div className="field">
            <label>Version actuelle</label>
            <input value={currentVersion} onChange={(e) => setCurrentVersion(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          {err && <div className="error" style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</div>}
          <button
            className="btn primary"
            disabled={!key || !name || createProject.isPending}
            onClick={submit}
          >
            {createProject.isPending ? 'Création…' : 'Créer le projet'}
          </button>
        </div>
      </div>
    </div>
  );
}
