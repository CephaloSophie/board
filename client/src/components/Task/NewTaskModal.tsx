import { useState } from 'react';
import type { TaxonomyItem, TaxonomyKind } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useCreateTask } from '../../api/tasks';

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
  defaultSprint,
  defaultVersion,
  onClose,
  onCreated,
}: {
  projectKey: string;
  taxonomies: TaxonomyItem[] | undefined;
  defaultSprint?: string | null;
  defaultVersion?: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}) {
  const createTask = useCreateTask(projectKey);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = { status: 'pending', priority: 'P2' };
    if (defaultSprint) init.sprint = defaultSprint;
    if (defaultVersion) init.version = defaultVersion;
    return init;
  });
  const [complexity, setComplexity] = useState('3');
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
        ...values,
      });
      onCreated(task.taskId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors de la création.');
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>Description</label>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="field-grid">
          {DIMENSIONS.map(({ field, kind, label, required }) => {
            const items = taxonomiesByKind(taxonomies, kind);
            return (
              <div className="field" key={field}>
                <label>
                  {label} {required && '*'}
                </label>
                <select
                  value={values[field] || ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                >
                  <option value="">—</option>
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
            <label>Points</label>
            <input type="number" min={0} value={complexity} onChange={(e) => setComplexity(e.target.value)} />
          </div>
        </div>

        {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{err}</div>}

        <button className="btn primary" style={{ marginTop: 14 }} onClick={submit} disabled={createTask.isPending}>
          {createTask.isPending ? 'Création…' : 'Créer la tâche'}
        </button>
      </div>
    </div>
  );
}
