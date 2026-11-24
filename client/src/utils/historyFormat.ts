import type { TaxonomyItem, TaxonomyKind } from '../types';
import { metaOf } from './format';

export const FIELD_LABELS: Record<string, string> = {
  created: 'Création',
  status: 'Statut',
  priority: 'Priorité',
  assignee: 'Assigné',
  sprint: 'Sprint',
  version: 'Version',
  type: 'Type',
  category: 'Catégorie',
  techno: 'Techno',
  area: 'Domaine',
  complexity: 'Points',
  title: 'Titre',
  labels: 'Étiquettes',
  parent: 'Parent',
  dueDate: 'Échéance',
  estimate: 'Estimation',
  duration: 'Durée réelle',
  description: 'Description',
  instructions: 'Instructions',
  acceptance: "Critères d'acceptation",
  comment: 'Commentaire',
  criteria: "Critères d'acceptation",
  criterionComment: 'Commentaire de critère',
  mergeRequest: 'Merge request',
  subtask: 'Sous-tâches',
  currentSprint: 'Sprint courant',
  currentVersion: 'Version courante',
};

export const FIELD_ICONS: Record<string, string> = {
  created: '✚',
  status: '◉',
  assignee: '👤',
  sprint: '🏃',
  version: '🏷',
  complexity: '◆',
  estimate: '⏱',
  duration: '⏱',
  comment: '💬',
  description: '📝',
  instructions: '📝',
  acceptance: '☑',
  criteria: '☑',
  criterionComment: '💬',
  mergeRequest: '⑂',
  subtask: '⊟',
  title: '✎',
  labels: '#',
  dueDate: '📅',
  parent: '↥',
  priority: '⚑',
  type: '▣',
  category: '▣',
  techno: '▣',
  area: '▣',
  currentSprint: '★',
  currentVersion: '★',
};

// Filter chips of the task history.
export const HISTORY_GROUPS: { key: string; label: string; fields: string[] | null }[] = [
  { key: 'all', label: 'Tout', fields: null },
  { key: 'status', label: 'Statut', fields: ['status', 'created'] },
  { key: 'people', label: 'Assignation', fields: ['assignee'] },
  { key: 'planning', label: 'Sprint & version', fields: ['sprint', 'version', 'dueDate'] },
  { key: 'hierarchy', label: 'Sous-tâches', fields: ['parent', 'subtask'] },
  { key: 'criteria', label: 'Recette', fields: ['acceptance', 'criteria', 'criterionComment'] },
  { key: 'dev', label: 'Merge requests', fields: ['mergeRequest'] },
  { key: 'estimation', label: 'Points & temps', fields: ['complexity', 'estimate', 'duration'] },
  { key: 'content', label: 'Contenu', fields: ['title', 'description', 'instructions', 'labels', 'type', 'priority', 'category', 'techno', 'area'] },
  { key: 'comment', label: 'Commentaires', fields: ['comment'] },
];

const TAXONOMY_FIELDS: Record<string, TaxonomyKind> = {
  status: 'status',
  priority: 'priority',
  sprint: 'sprint',
  currentSprint: 'sprint',
  type: 'type',
  category: 'category',
  techno: 'techno',
  area: 'area',
};

export function labelForValue(
  field: string | undefined,
  value: unknown,
  taxonomies: TaxonomyItem[] | undefined,
  userName?: (id: string) => string | undefined
): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return '—';
  const f = field || '';
  if (TAXONOMY_FIELDS[f]) return metaOf(taxonomies, TAXONOMY_FIELDS[f], String(value)).label;
  switch (f) {
    case 'version':
    case 'currentVersion':
      return `v${value}`;
    case 'assignee':
      return userName?.(String(value)) || 'un utilisateur';
    case 'dueDate':
      return new Date(String(value)).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
    case 'complexity':
      return `${value} pts`;
    default:
      return Array.isArray(value) ? value.join(' · ') : String(value);
  }
}

/*
 * "Event" entries: the note says what happened, `from` / `to` carry excerpts
 * (criterion checked, merge request linked, sub-task attached…).
 */
export const EVENT_FIELDS = new Set(['criteria', 'criterionComment', 'mergeRequest', 'subtask']);

export function eventSentence(field: string, note: string | undefined, from: unknown, to: unknown): { verb: string; quote: string | null; detail: string | null } {
  const verb = (note || FIELD_LABELS[field] || field).replace(/\.$/, '');
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
  if (field === 'criterionComment') return { verb, quote: text(to) ?? text(from), detail: to !== null && to !== undefined && from ? `sur « ${String(from)} »` : null };
  if (field === 'mergeRequest' && from && to) return { verb, quote: null, detail: `${String(from)} → ${String(to)}` };
  if (field === 'criteria' && from && to) return { verb, quote: text(to), detail: `avant : ${String(from)}` };
  if (field === 'subtask') return { verb, quote: null, detail: null };
  return { verb, quote: text(to) ?? text(from), detail: null };
}
