import type { ProjectRole, SprintStatus, StatusCategory, TaxonomyItem } from '../types';

export const SPRINT_STATUS_META: Record<SprintStatus, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: '#6b7280' },
  ready: { label: 'Prêt', color: '#9db4dd' },
  active: { label: 'Actif', color: '#e6c46a' },
  finished: { label: 'Terminé', color: '#2f8f57' },
};

export const PROJECT_ROLE_META: Record<ProjectRole, { label: string; hint: string }> = {
  admin: { label: 'Administrateur', hint: 'Paramètres, sprints, membres, import, suppression de tâches' },
  member: { label: 'Membre', hint: 'Crée et modifie les tâches, commente, participe aux rituels' },
  viewer: { label: 'Lecteur', hint: 'Consultation uniquement' },
};

export const STATUS_CATEGORY_META: Record<StatusCategory, { label: string; color: string }> = {
  todo: { label: 'À faire', color: '#9db4dd' },
  inprogress: { label: 'En cours', color: '#e6c46a' },
  done: { label: 'Terminé', color: '#2f8f57' },
};

// Fallback for statuses not migrated yet (mirrors server utils/taxonomyMeta).
const LEGACY_IN_PROGRESS = new Set(['onprocess', 'needreview', 'needconfirmation', 'tested']);

export function statusCategoryOf(item: Pick<TaxonomyItem, 'key' | 'meta'> | undefined): StatusCategory {
  const meta = (item?.meta || {}) as { category?: StatusCategory; isDone?: boolean };
  if (meta.category && meta.category in STATUS_CATEGORY_META) return meta.category;
  if (meta.isDone) return 'done';
  if (item && LEGACY_IN_PROGRESS.has(item.key)) return 'inprogress';
  return 'todo';
}

export function statusCategoryResolver(taxonomies: TaxonomyItem[] | undefined) {
  const map = new Map((taxonomies || []).filter((t) => t.kind === 'status').map((t) => [t.key, statusCategoryOf(t)]));
  return (statusKey: string) => map.get(statusKey) ?? statusCategoryOf({ key: statusKey, meta: {} });
}
