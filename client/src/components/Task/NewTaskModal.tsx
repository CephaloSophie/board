import { useEffect, useMemo, useRef, useState } from 'react';
import type { MergeRequestState, Project, TaxonomyItem, TaxonomyKind } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useCreateTask, type TaskCreate } from '../../api/tasks';
import { useAssignableUsers } from '../../api/members';
import { useProjectLabels } from '../../api/projects';
import { errorMessage } from '../../api/client';
import { statusCategoryOf } from '../../utils/status';
import type { ParsedCriterion } from '../../utils/acceptance';
import LabelsInput from '../common/LabelsInput';
import RichTextEditor from '../common/RichTextEditor';
import TaskPicker from '../common/TaskPicker';
import AcceptanceEditor, { type CriterionItem } from './AcceptanceEditor';
import { MergeRequestEditor, type MergeRequestDraft } from './MergeRequestList';

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

// Description skeletons (and starter criteria) — a click fills the editor.
const TEMPLATES: { key: string; label: string; description: string; criteria: string[] }[] = [
  {
    key: 'story',
    label: 'User story',
    description: '**En tant que** …\n**je veux** …\n**afin de** …\n\n## Contexte\n\n## Maquettes / liens\n',
    criteria: [],
  },
  {
    key: 'bug',
    label: 'Bug',
    description: "## Étapes pour reproduire\n1. \n2. \n\n## Résultat obtenu\n\n## Résultat attendu\n\n## Environnement\n- Version : \n- Navigateur / appareil : \n",
    criteria: ["Le scénario de reproduction ne produit plus l'anomalie", 'Un test de non-régression couvre le cas'],
  },
  {
    key: 'tech',
    label: 'Technique',
    description: '## Objectif\n\n## Approche proposée\n\n## Impacts\n- \n\n## Risques / points ouverts\n',
    criteria: ['Revue de code validée', 'Tests automatisés à jour'],
  },
  {
    key: 'module',
    label: 'Module / package',
    description: '## Périmètre\n\n## Découpage prévu\n- \n\n## Dépendances\n- \n\n## Définition de terminé\n',
    criteria: ['Toutes les sous-tâches sont terminées', 'Documentation du module à jour', 'Package publié / déployé'],
  },
];

interface Draft {
  title: string;
  description: string;
  criteria: ParsedCriterion[];
  values: Record<string, string>;
  complexity: string;
  assignee: string;
  labels: string[];
  dueDate: string;
  parent: string;
  mergeRequests: { url: string; title?: string; state: MergeRequestState }[];
}

const draftKey = (projectKey: string) => `kydos.newTaskDraft.${projectKey}`;

function readDraft(projectKey: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(projectKey));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(projectKey: string, draft: Draft | null) {
  try {
    if (draft) localStorage.setItem(draftKey(projectKey), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(projectKey));
  } catch {
    /* storage unavailable: drafts are a convenience only */
  }
}

let tempId = 0;
const nextId = () => `new-${++tempId}`;

export default function NewTaskModal({
  projectKey,
  taxonomies,
  project,
  defaultSprint,
  defaultVersion,
  defaultParent,
  onClose,
  onCreated,
}: {
  projectKey: string;
  taxonomies: TaxonomyItem[] | undefined;
  project?: Project;
  defaultSprint?: string | null;
  defaultVersion?: string;
  defaultParent?: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}) {
  const createTask = useCreateTask(projectKey);
  const { data: users } = useAssignableUsers(projectKey);
  const { data: labelOptions } = useProjectLabels(projectKey);
  const scale = project?.estimation?.scale?.length ? project.estimation.scale : [1, 2, 3, 5, 8, 13];

  const initialValues = useMemo(() => {
    const firstTodo = taxonomiesByKind(taxonomies, 'status').find((s) => statusCategoryOf(s) === 'todo');
    const init: Record<string, string> = {
      status: project?.defaults?.status || firstTodo?.key || 'pending',
      priority: project?.defaults?.priority || 'P2',
    };
    if (project?.defaults?.type) init.type = project.defaults.type;
    if (defaultSprint) init.sprint = defaultSprint;
    if (defaultVersion) init.version = defaultVersion;
    return init;
    // Computed once per popup: later taxonomy refreshes must not reset the user's choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const blank = (): Draft => ({
    title: '',
    description: '',
    criteria: [],
    values: initialValues,
    complexity: String(scale.includes(3) ? 3 : scale[0] ?? 0),
    assignee: '',
    labels: [],
    dueDate: '',
    parent: defaultParent || '',
    mergeRequests: [],
  });

  const restored = useRef(readDraft(projectKey));
  const [draft, setDraft] = useState<Draft>(() => (restored.current ? { ...blank(), ...restored.current, parent: defaultParent || restored.current.parent } : blank()));
  const [showRestored, setShowRestored] = useState(!!restored.current);
  const [criteriaIds, setCriteriaIds] = useState<string[]>(() => draft.criteria.map(() => nextId()));
  const [mrIds, setMrIds] = useState<string[]>(() => draft.mergeRequests.map(() => nextId()));
  const [another, setAnother] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = !!(draft.title.trim() || draft.description.trim() || draft.criteria.length || draft.mergeRequests.length);

  // Autosave (per project, this browser only) so an accidental close never loses the text.
  useEffect(() => {
    const id = setTimeout(() => writeDraft(projectKey, dirty ? draft : null), 400);
    return () => clearTimeout(id);
  }, [draft, dirty, projectKey]);

  function close() {
    if (dirty && !confirm('Fermer la création ? Le brouillon reste enregistré dans ce navigateur.')) return;
    onClose();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(TEXTAREA|SELECT)$/.test(target.tagName)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function discardDraft() {
    writeDraft(projectKey, null);
    setDraft(blank());
    setCriteriaIds([]);
    setMrIds([]);
    setShowRestored(false);
  }

  function applyTemplate(key: string) {
    const tpl = TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    if (draft.description.trim() && !confirm('Remplacer la description actuelle par le modèle ?')) return;
    const known = new Set(draft.criteria.map((c) => c.text.toLowerCase()));
    const extra = tpl.criteria.filter((c) => !known.has(c.toLowerCase())).map((text) => ({ text, done: false }));
    setDraft((d) => ({ ...d, description: tpl.description, criteria: [...d.criteria, ...extra] }));
    setCriteriaIds((ids) => [...ids, ...extra.map(() => nextId())]);
  }

  // ----- local criteria (sent with the creation) -----
  const criteriaItems: CriterionItem[] = draft.criteria.map((c, i) => ({ id: criteriaIds[i], text: c.text, done: c.done }));
  const criteriaEditor = {
    onAdd: (items: ParsedCriterion[], position: 'start' | 'end') => {
      const ids = items.map(() => nextId());
      setDraft((d) => ({ ...d, criteria: position === 'start' ? [...items, ...d.criteria] : [...d.criteria, ...items] }));
      setCriteriaIds((prev) => (position === 'start' ? [...ids, ...prev] : [...prev, ...ids]));
    },
    onUpdate: (id: string, patch: { text?: string; done?: boolean }) => {
      const i = criteriaIds.indexOf(id);
      if (i >= 0) setDraft((d) => ({ ...d, criteria: d.criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
    },
    onDelete: (id: string) => {
      const i = criteriaIds.indexOf(id);
      if (i < 0) return;
      setDraft((d) => ({ ...d, criteria: d.criteria.filter((_, j) => j !== i) }));
      setCriteriaIds((prev) => prev.filter((x) => x !== id));
    },
    onReorder: (ids: string[]) => {
      const byId = new Map(criteriaIds.map((id, i) => [id, draft.criteria[i]]));
      setDraft((d) => ({ ...d, criteria: ids.map((id) => byId.get(id)!).filter(Boolean) }));
      setCriteriaIds(ids);
    },
  };

  const mrItems: MergeRequestDraft[] = draft.mergeRequests.map((m, i) => ({ ...m, _id: mrIds[i] }));

  async function submit() {
    if (!draft.title.trim() || !draft.values.status) {
      setErr('Le titre et le statut sont requis.');
      titleRef.current?.focus();
      return;
    }
    setErr(null);
    try {
      const { task } = await createTask.mutateAsync({
        title: draft.title.trim(),
        description: draft.description,
        complexity: Number(draft.complexity) || 0,
        assignee: draft.assignee || null,
        labels: draft.labels,
        dueDate: draft.dueDate || null,
        parent: draft.parent || null,
        criteria: draft.criteria,
        mergeRequests: draft.mergeRequests,
        ...(draft.values as Pick<TaskCreate, 'status' | 'priority' | 'type' | 'category' | 'techno' | 'area' | 'version'>),
        sprint: draft.values.sprint || null,
      });
      writeDraft(projectKey, null);
      if (another) {
        // Keep the planning context (sprint, version, parent…), clear the content.
        setCreated((c) => [...c, task.taskId]);
        setDraft((d) => ({ ...blank(), values: d.values, parent: d.parent, assignee: d.assignee, labels: d.labels }));
        setCriteriaIds([]);
        setMrIds([]);
        setShowRestored(false);
        titleRef.current?.focus();
      } else {
        onCreated(task.taskId);
      }
    } catch (e) {
      setErr(errorMessage(e, 'Erreur lors de la création.'));
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div
        className="modal wide new-task"
        role="dialog"
        aria-modal="true"
        aria-label="Nouvelle tâche"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="modal-head">
          <div>
            <h3>Nouvelle tâche</h3>
            {created.length > 0 && <div className="hint">Créées : {created.join(', ')}</div>}
          </div>
          <button className="close-btn" onClick={close}>
            Fermer ✕
          </button>
        </div>

        {showRestored && (
          <div className="draft-banner">
            Brouillon restauré.
            <button type="button" className="link-btn" onClick={discardDraft}>
              Repartir de zéro
            </button>
          </div>
        )}

        <div className="new-task__layout">
          <div className="new-task__main">
            <div className="field">
              <label>Titre *</label>
              <input
                ref={titleRef}
                type="text"
                className="new-task__title"
                value={draft.title}
                maxLength={500}
                placeholder="Ex. Module de paiement : intégration Stripe"
                onChange={(e) => set('title', e.target.value)}
                autoFocus
              />
            </div>

            <div className="field">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <label>Description</label>
                <span className="row wrap" style={{ gap: 4 }}>
                  <span className="hint">Modèles :</span>
                  {TEMPLATES.map((t) => (
                    <button type="button" key={t.key} className="chip" onClick={() => applyTemplate(t.key)}>
                      {t.label}
                    </button>
                  ))}
                </span>
              </div>
              <RichTextEditor
                value={draft.description}
                onChange={(v) => set('description', v)}
                projectKey={projectKey}
                rows={8}
                placeholder="Contexte, captures d'écran, liens, @mentions… Collez directement depuis Word, Google Docs ou une page web."
                onSubmit={submit}
              />
            </div>

            <div className="field">
              <label>Critères d'acceptation</label>
              <AcceptanceEditor
                projectKey={projectKey}
                items={criteriaItems}
                {...criteriaEditor}
                emptyHint="Ajoutez les cas de test un par un, ou collez une liste : elle sera découpée automatiquement."
              />
              <span className="hint">Les commentaires par critère sont disponibles une fois la tâche créée.</span>
            </div>

            <div className="field">
              <label>Merge requests</label>
              <MergeRequestEditor
                compact
                items={mrItems}
                onAdd={async (mr) => {
                  setDraft((d) => ({ ...d, mergeRequests: [...d.mergeRequests, mr] }));
                  setMrIds((ids) => [...ids, nextId()]);
                }}
                onUpdate={(id, patch) => {
                  const i = mrIds.indexOf(id);
                  setDraft((d) => ({ ...d, mergeRequests: d.mergeRequests.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
                }}
                onRemove={(id) => {
                  const i = mrIds.indexOf(id);
                  setDraft((d) => ({ ...d, mergeRequests: d.mergeRequests.filter((_, j) => j !== i) }));
                  setMrIds((ids) => ids.filter((x) => x !== id));
                }}
              />
            </div>
          </div>

          <aside className="new-task__side task-side">
            {DIMENSIONS.map(({ field, kind, label, required }) => {
              const items = taxonomiesByKind(taxonomies, kind);
              if (!items.length && !required) return null;
              return (
                <div className="field" key={field}>
                  <label>
                    {label} {required && '*'}
                  </label>
                  <select value={draft.values[field] || ''} onChange={(e) => set('values', { ...draft.values, [field]: e.target.value })}>
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
              <select value={draft.assignee} onChange={(e) => set('assignee', e.target.value)}>
                <option value="">Non assigné</option>
                {(users || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Tâche parente</label>
              <TaskPicker
                projectKey={projectKey}
                taxonomies={taxonomies}
                value={draft.parent ? { taskId: draft.parent } : null}
                placeholder="Module, package, epic…"
                onPick={(t) => set('parent', t ? t.taskId : '')}
              />
            </div>
            <div className="field">
              <label>Échéance</label>
              <input type="date" value={draft.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
            </div>
            <div className="field">
              <label>{project?.estimation?.unit === 'hours' ? 'Estimation (heures)' : 'Points'}</label>
              <div className="row wrap" style={{ gap: 4 }}>
                {scale.map((n) => (
                  <button type="button" key={n} className={`chip${Number(draft.complexity) === n ? ' active' : ''}`} onClick={() => set('complexity', String(n))}>
                    {n}
                  </button>
                ))}
                <input type="number" min={0} step="0.5" value={draft.complexity} onChange={(e) => set('complexity', e.target.value)} style={{ width: 70 }} />
              </div>
            </div>
            <div className="field">
              <label>Étiquettes</label>
              <LabelsInput value={draft.labels} onChange={(l) => set('labels', l)} suggestions={(labelOptions || []).map((l) => l.value)} />
            </div>
          </aside>
        </div>

        {err && <div className="form-error">{err}</div>}

        <div className="new-task__foot">
          <label className="board-toggles" title="Garder la popup ouverte pour enchaîner les créations (même sprint, version, parent)">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Créer et en ajouter une autre
          </label>
          <span className="hint">Ctrl+Entrée pour créer</span>
          <div className="header-spacer" />
          <button className="btn ghost" onClick={close}>
            Annuler
          </button>
          <button className="btn primary" onClick={submit} disabled={createTask.isPending}>
            {createTask.isPending ? 'Création…' : 'Créer la tâche'}
          </button>
        </div>
      </div>
    </div>
  );
}
