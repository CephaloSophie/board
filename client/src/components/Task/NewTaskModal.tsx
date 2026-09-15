import { useState } from 'react';
import type { Project, TaxonomyItem, TaxonomyKind } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useCreateTask } from '../../api/tasks';
import { useAssignableUsers } from '../../api/members';
import { useProjectLabels } from '../../api/projects';
import { errorMessage } from '../../api/client';
import { statusCategoryOf } from '../../utils/status';
import LabelsInput from '../common/LabelsInput';

const DIMENSIONS: { field: string; kind: TaxonomyKind; label: string; required?: boolean }[] = [
  { field: 'status', kind: 'status', label: 'Statut', required: true },
  { field: 'priority', kind: 'priority', label: 'Priorité' },
  { field: 'type', kind: 'type', label: 'Type' },
  { field: 'category', kind: 'category', label: 'Catégorie' },
  { field: 'techno', kind: 'techno', label: 'Techno' },
  { field: 'area', kind: 'area', label: 'Domaine' },
  { field: 'version', kind: 'version', label: 'Version' },
  { field: 'sprint', kind: 'sprint', label: 'Sprint' },
];

export default function NewTaskModal({
  projectKey,
  taxonomies,
  project,
  defaultSprint,
  defaultVersion,
  onClose,
  onCreated,
}: {
  projectKey: string;
  taxonomies: TaxonomyItem[] | undefined;
  project?: Project;
  defaultSprint?: string | null;
  defaultVersion?: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}) {
  const createTask = useCreateTask(projectKey);
  const { data: users } = useAssignableUsers(projectKey);
  const { data: labelOptions } = useProjectLabels(projectKey);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const firstTodo = taxonomiesByKind(taxonomies, 'status').find((s) => statusCategoryOf(s) === 'todo');
    const init: Record<string, string> = {
      status: project?.defaults?.status || firstTodo?.key || 'pending',
      priority: project?.defaults?.priority || 'P2',
    };
    if (project?.defaults?.type) init.type = project.defaults.type;
    if (defaultSprint) init.sprint = defaultSprint;
    if (defaultVersion) init.version = defaultVersion;
    return init;
  });
  const scale = project?.estimation?.scale?.length ? project.estimation.scale : [1, 2, 3, 5, 8, 13];
  const [complexity, setComplexity] = useState(String(scale.includes(3) ? 3 : scale[0] ?? 0));
  const [assignee, setAssignee] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !values.status) {
      setErr('Le titre et le statut sont requis.');
      return;
    }
    setErr(null);
    try {
      const { task } = await createTask.mutateAsync({
        title: title.trim(),
        description,
        complexity: Number(complexity) || 0,
        assignee: (assignee || null) as never,
        labels,
        dueDate: dueDate || null,
        ...values,
      });
      onCreated(task.taskId);
    } catch (e) {
      setErr(errorMessage(e, 'Erreur lors de la création.'));
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h3>Nouvelle tâche</h3>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>

        <div className="field">
          <label>Titre</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
            autoFocus
          />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>Description</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="field-grid">
          {DIMENSIONS.map(({ field, kind, label, required }) => {
            const items = taxonomiesByKind(taxonomies, kind);
            if (!items.length && !required) return null;
            return (
              <div className="field" key={field}>
                <label>
                  {label} {required && '*'}
                </label>
                <select value={values[field] || ''} onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}>
                  <option value="">{field === 'sprint' ? 'Backlog (sans sprint)' : '—'}</option>
                  {items.map((i) => (
                    <option key={i.key} value={i.key}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="field">
            <label>Assigné</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Non assigné</option>
              {(users || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Échéance</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>{project?.estimation?.unit === 'hours' ? 'Estimation (heures)' : 'Points'}</label>
          <div className="row wrap">
            {scale.map((n) => (
              <button type="button" key={n} className={`chip${Number(complexity) === n ? ' active' : ''}`} onClick={() => setComplexity(String(n))}>
                {n}
              </button>
            ))}
            <input type="number" min={0} step="0.5" value={complexity} onChange={(e) => setComplexity(e.target.value)} style={{ width: 90 }} />
          </div>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label>Étiquettes</label>
          <LabelsInput value={labels} onChange={setLabels} suggestions={(labelOptions || []).map((l) => l.value)} />
        </div>

        {err && <div className="form-error">{err}</div>}

        <button className="btn primary" style={{ marginTop: 14 }} onClick={submit} disabled={createTask.isPending}>
          {createTask.isPending ? 'Création…' : 'Créer la tâche'}
        </button>
      </div>
    </div>
  );
}
