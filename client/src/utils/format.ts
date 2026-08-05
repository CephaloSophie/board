import type { TaxonomyItem, TaxonomyKind } from '../types';

export function esc(s: unknown): string {
  return String(s ?? '');
}

export function metaOf(items: TaxonomyItem[] | undefined, kind: TaxonomyKind, key: string | undefined) {
  const found = (items || []).find((i) => i.kind === kind && i.key === key);
  return found || { key: key || '', label: key || '—', color: '#888', order: 0 } as TaxonomyItem;
}

export function hoursOf(duration: string | undefined): number {
  if (!duration) return 0;
  const m = /([\d.]+)\s*(h|j)/.exec(duration);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  return m[2] === 'j' ? v * 8 : v;
}

export function fmtDur(hours: number): string {
  if (hours < 8) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 8) * 10) / 10} j`;
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('fr-FR');
}
