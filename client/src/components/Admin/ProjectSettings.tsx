import { useEffect, useState } from 'react';
import { useProject, useUpdateProject } from '../../api/projects';
import { useTaxonomies, taxonomiesByKind } from '../../api/taxonomies';
import { useAuth } from '../../context/AuthContext';

export default function ProjectSettings({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const { data: project } = useProject(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const updateProject = useUpdateProject(projectKey);
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [description, setDescription] = useState('');
  const [currentVersion, setCurrentVersion] = useState('');
  const [sprintDurationValue, setSprintDurationValue] = useState(1);
  const [sprintDurationUnit, setSprintDurationUnit] = useState<'days' | 'weeks'>('weeks');
  const [currentSprint, setCurrentSprint] = useState<string>('');

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setVendor(project.vendor || '');
    setDescription(project.description || '');
    setCurrentVersion(project.currentVersion);
    setSprintDurationValue(project.sprintDurationValue || 1);
    setSprintDurationUnit(project.sprintDurationUnit || 'weeks');
    setCurrentSprint(project.currentSprint || '');
  }, [project?._id]);

  if (!project) return <div className="loadbox">Chargement…</div>;
  const canEdit = user?.role === 'superadmin';
  const sprints = taxonomiesByKind(taxonomies, 'sprint');

  return (
    <div>
      <h2 className="mt-0">Paramètres du projet</h2>
      <div className="stack" style={{ maxWidth: 480 }}>
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
          <label>Durée d'un sprint</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="number"
              min={1}
              max={90}
              value={sprintDurationValue}
              onChange={(e) => setSprintDurationValue(Number(e.target.value) || 1)}
              disabled={!canEdit}
              style={{ width: 90 }}
            />
            <select
              value={sprintDurationUnit}
              onChange={(e) => setSprintDurationUnit(e.target.value as 'days' | 'weeks')}
              disabled={!canEdit}
            >
              <option value="weeks">semaine(s)</option>
              <option value="days">jour(s)</option>
            </select>
          </div>
          <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
            N'affecte que les <b>prochains</b> sprints : les sprints en cours et passés gardent leurs
            dates. Par défaut 1 semaine.
          </p>
        </div>

        <div className="field">
          <label>Sprint courant</label>
          <select
            value={currentSprint}
            onChange={(e) => setCurrentSprint(e.target.value)}
            disabled={!canEdit || !sprints.length}
          >
            <option value="">— aucun —</option>
            {sprints.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
                {s.meta?.status ? ` (${s.meta.status})` : ''}
              </option>
            ))}
          </select>
          <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
            Le sprint courant est celui pré-sélectionné à la création d'une nouvelle tâche et mis en
            avant dans le board.
          </p>
        </div>

        <div className="field">
          <label>Description</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
        </div>

        {canEdit && (
          <button
            className="btn primary"
            onClick={() =>
              updateProject.mutate({
                name,
                vendor,
                description,
                currentVersion,
                sprintDurationValue,
                sprintDurationUnit,
                currentSprint: currentSprint || null,
              })
            }
            disabled={updateProject.isPending}
          >
            Enregistrer
          </button>
        )}
      </div>
    </div>
  );
}
