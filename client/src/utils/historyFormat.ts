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
  { key: 'planning', label: 'Sprint & version', fields: ['sprint', 'version', 'dueDate', 'parent'] },
  { key: 'estimation', label: 'Points & temps', fields: ['complexity', 'estimate', 'duration'] },
  { key: 'content', label: 'Contenu', fields: ['title', 'description', 'instructions', 'acceptance', 'labels', 'type', 'priority', 'category', 'techno', 'area'] },
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
