import type { EventFeature, EventStatus, TaxonomyItem } from '../../types';

// Resolve an event type key to its taxonomy row (label/color/icon/features).
export function eventTypeMeta(taxonomies: TaxonomyItem[] | undefined, typeKey: string) {
  const found = (taxonomies || []).find((t) => t.kind === 'eventType' && t.key === typeKey);
  const meta = (found?.meta || {}) as { icon?: string; features?: EventFeature[] };
  return {
    key: typeKey,
    label: found?.label || typeKey,
    color: found?.color || '#6b78ea',
    icon: meta.icon || '📌',
    // Sensible fallback so custom types without configured features still work.
    features: meta.features && meta.features.length ? meta.features : (['participants', 'backlog', 'agenda'] as EventFeature[]),
  };
}

export function hasFeature(features: EventFeature[], f: EventFeature): boolean {
  return features.includes(f);
}

export const EVENT_STATUS_META: Record<EventStatus, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: '#6b7280' },
  scheduled: { label: 'Planifié', color: '#9db4dd' },
  done: { label: 'Terminé', color: '#2f8f57' },
  cancelled: { label: 'Annulé', color: '#e85d70' },
};
