import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { ActivityQuery } from '../api/activity';
import { taxonomiesByKind, useTaxonomies } from '../api/taxonomies';
import { useAuth } from '../context/AuthContext';
import { useProjectPeople } from '../hooks/useProjectPeople';
import { useDebounced } from '../utils/useDebounced';
import { todayInput } from '../utils/dates';
import ActivityFeed from '../components/Activity/ActivityFeed';
import TaskModal from '../components/Task/TaskModal';

const SCOPES = [
  { value: 'task', label: 'Tâches' },
  { value: 'comment', label: 'Commentaires & réactions' },
  { value: 'sprint', label: 'Sprints' },
  { value: 'version', label: 'Versions' },
  { value: 'import', label: 'Imports' },
];

const FIELDS = [
  { value: 'status', label: 'Changements de statut' },
  { value: 'assignee', label: 'Réassignations' },
  { value: 'sprint', label: 'Décalages de sprint' },
  { value: 'version', label: 'Changements de version' },
  { value: 'complexity', label: 'Points' },
  { value: 'estimate,duration', label: 'Estimation / durée' },
  { value: 'priority', label: 'Priorité' },
  { value: 'title,description,instructions,acceptance', label: 'Contenu' },
  { value: 'comment', label: 'Commentaires' },
  { value: 'dueDate', label: 'Échéance' },
];

const PARAMS = ['user', 'scope', 'field', 'sprint', 'version', 'from', 'to', 'q', 'taskId'] as const;

// Project audit log: who changed what and when, filterable and shareable by URL.
export default function ActivityPage() {
  const { projectKey = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const { data: taxonomies } = useTaxonomies(projectKey);
  const people = useProjectPeople(projectKey);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('q') || '');
  const [taskId, setTaskId] = useState(params.get('taskId') || '');
  const debouncedSearch = useDebounced(search, 300);
  const debouncedTask = useDebounced(taskId, 300);

  function set(patch: Partial<Record<(typeof PARAMS)[number], string>>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }

  useEffect(() => set({ q: debouncedSearch.trim() }), [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => set({ taskId: debouncedTask.trim().toUpperCase() }), [debouncedTask]); // eslint-disable-line react-hooks/exhaustive-deps

  const query: ActivityQuery = useMemo(() => {
    const list = (key: string) => (params.get(key) || '').split(',').filter(Boolean);
    return {
      user: list('user'),
      scope: list('scope'),
      field: list('field'),
      sprint: list('sprint'),
      version: list('version'),
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      q: params.get('q') || undefined,
      taskId: params.get('taskId') || undefined,
      limit: 60,
    };
  }, [params]);

  const active = PARAMS.filter((p) => params.get(p)).length;
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="page activity-page">
      <div className="section-head">
        <div>
          <h2>Journal d’activité</h2>
          <p className="text-muted section-intro">
            Toutes les actions du projet : statuts, réassignations, décalages de sprint ou de version, points, contenus, commentaires, cycle de vie des
            sprints et versions, imports.
          </p>
        </div>
      </div>

      <div className="activity-filters">
        <input type="search" placeholder="Rechercher (tâche, texte, auteur)…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <input type="text" placeholder="Tâche (KB-12)" value={taskId} onChange={(e) => setTaskId(e.target.value)} style={{ width: 120 }} />
        <select value={params.get('user') || ''} onChange={(e) => set({ user: e.target.value })}>
          <option value="">Tous les membres</option>
          {people.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
        <select value={params.get('scope') || ''} onChange={(e) => set({ scope: e.target.value })}>
          <option value="">Tous les types</option>
          {SCOPES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={params.get('field') || ''} onChange={(e) => set({ field: e.target.value })}>
          <option value="">Toutes les modifications</option>
          {FIELDS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select value={params.get('sprint') || ''} onChange={(e) => set({ sprint: e.target.value })}>
          <option value="">Tous les sprints</option>
          {taxonomiesByKind(taxonomies, 'sprint').map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={params.get('version') || ''} onChange={(e) => set({ version: e.target.value })}>
          <option value="">Toutes les versions</option>
          {taxonomiesByKind(taxonomies, 'version').map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="activity-filters__date">
          Du <input type="date" value={params.get('from') || ''} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label className="activity-filters__date">
          au <input type="date" value={params.get('to') || ''} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </div>
      <div className="filter-chips">
        <button className="filter-chip" onClick={() => set({ from: todayInput(), to: todayInput() })}>
          Aujourd’hui
        </button>
        <button className="filter-chip" onClick={() => set({ from: weekAgo, to: '' })}>
          7 derniers jours
        </button>
        {user && (
          <button className={`filter-chip${params.get('user') === user.id ? ' on' : ''}`} onClick={() => set({ user: user.id })}>
            Mes actions
          </button>
        )}
        <button className="filter-chip" onClick={() => set({ field: 'sprint,version', scope: '' })}>
          Décalages
        </button>
        {active > 0 && (
          <button
            className="filter-chip"
            onClick={() => {
              setSearch('');
              setTaskId('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            ✕ Réinitialiser ({active})
          </button>
        )}
      </div>

      <div className="admin-panel">
        <ActivityFeed projectKey={projectKey} query={query} taxonomies={taxonomies} onOpenTask={setOpenTaskId} />
      </div>

      {openTaskId && <TaskModal projectKey={projectKey} taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    </div>
  );
}
