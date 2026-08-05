import type { HistoryEntry, TaxonomyItem } from '../../types';
import { fmtDate, metaOf } from '../../utils/format';

function labelForValue(field: string, value: unknown, taxonomies: TaxonomyItem[] | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'status') return metaOf(taxonomies, 'status', String(value)).label;
  if (field === 'priority') return metaOf(taxonomies, 'priority', String(value)).label;
  if (field === 'sprint') return metaOf(taxonomies, 'sprint', String(value)).label;
  if (field === 'version') return `v${value}`;
  return String(value);
}

const FIELD_LABELS: Record<string, string> = {
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
  created: 'Création',
};

export default function HistoryList({
  history,
  taxonomies,
}: {
  history: HistoryEntry[];
  taxonomies: TaxonomyItem[] | undefined;
}) {
  const sorted = [...history].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  if (!sorted.length) return <div className="text-muted" style={{ fontSize: 12 }}>Aucun historique.</div>;
  return (
    <>
      {sorted.map((h) => {
        const by = typeof h.by === 'object' && h.by ? h.by.displayName : h.byLabel || 'système';
        const label = FIELD_LABELS[h.field] || h.field;
        return (
          <div className="hist" key={h._id}>
            {fmtDate(h.at)} · <b>{label}</b>
            {h.field !== 'created' && (
              <>
                {' '}
                : {labelForValue(h.field, h.from, taxonomies)} → {labelForValue(h.field, h.to, taxonomies)}
              </>
            )}
            {' '}({by}){h.note ? ` — ${h.note}` : ''}
          </div>
        );
      })}
    </>
  );
}
