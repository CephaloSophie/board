import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useMembers } from '../../api/members';
import { useDeleteProject, useProjectAction } from '../../api/projects';
import { useAuth } from '../../context/AuthContext';
import { useProjectRole } from '../../hooks/useProjectRole';

export default function DangerZoneTab({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const { project, isAdmin } = useProjectRole(projectKey);
  const { data } = useMembers(projectKey);
  const action = useProjectAction(projectKey);
  const remove = useDeleteProject(projectKey);
  const navigate = useNavigate();
  const [owner, setOwner] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!project) return <div className="loadbox">Chargement…</div>;
  const candidates = (data?.members || []).filter((m) => m.role !== 'viewer' && String(m.user.id) !== String(project.owner));

  async function run(fn: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="danger-zone">
      <h2 className="mt-0">Zone dangereuse</h2>
      {error && <div className="form-error">{error}</div>}
      {notice && <div className="form-ok">{notice}</div>}

      <div className="danger-row">
        <div>
          <b>Transférer la responsabilité</b>
          <div className="text-muted small-text">Le nouveau responsable devient administrateur du projet.</div>
        </div>
        <div className="row">
          <select value={owner} disabled={!isAdmin} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Choisir…</option>
            {candidates.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.displayName}
              </option>
            ))}
          </select>
          <button
            className="btn small"
            disabled={!isAdmin || !owner}
            onClick={() => confirm('Transférer la responsabilité du projet ?') && run(() => action.mutateAsync({ action: 'transfer', data: { userId: owner } }), 'Responsabilité transférée.')}
          >
            Transférer
          </button>
        </div>
      </div>

      <div className="danger-row">
        <div>
          <b>{project.archived ? 'Désarchiver le projet' : 'Archiver le projet'}</b>
          <div className="text-muted small-text">
            {project.archived
              ? 'Le projet redevient modifiable et réapparaît dans la liste.'
              : 'Le projet passe en lecture seule et disparaît de la liste (accessible via « Projets archivés »).'}
          </div>
        </div>
        <button
          className={`btn small${project.archived ? '' : ' danger'}`}
          disabled={!isAdmin}
          onClick={() =>
            confirm(project.archived ? 'Désarchiver ce projet ?' : 'Archiver ce projet ?') &&
            run(
              () => action.mutateAsync({ action: project.archived ? 'unarchive' : 'archive' }),
              project.archived ? 'Projet désarchivé.' : 'Projet archivé.'
            )
          }
        >
          {project.archived ? 'Désarchiver' : 'Archiver'}
        </button>
      </div>

      <div className="danger-row">
        <div>
          <b>Supprimer définitivement</b>
          <div className="text-muted small-text">
            Réservé aux super admins, sur un projet archivé. Supprime tâches, taxonomies, rituels, filtres, dashboards et imports. Irréversible.
          </div>
        </div>
        <div className="row">
          <input
            type="text"
            placeholder={`Tapez ${project.key}`}
            value={confirmKey}
            disabled={user?.role !== 'superadmin' || !project.archived}
            onChange={(e) => setConfirmKey(e.target.value.toUpperCase())}
            style={{ minWidth: 120, width: 140 }}
          />
          <button
            className="btn small danger"
            disabled={user?.role !== 'superadmin' || !project.archived || confirmKey !== project.key || remove.isPending}
            onClick={async () => {
              setError(null);
              try {
                await remove.mutateAsync(confirmKey);
                navigate('/projects');
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}
