import type { PublicUser, TaskFilters, TaxonomyItem, TaxonomyKind } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';

type MultiField = Exclude<keyof TaskFilters, 'search'>;

const DIMENSIONS: { field: MultiField; kind: TaxonomyKind; label: string }[] = [
  { field: 'status', kind: 'status', label: 'Statut' },
  { field: 'priority', kind: 'priority', label: 'Priorité' },
  { field: 'type', kind: 'type', label: 'Type' },
  { field: 'category', kind: 'category', label: 'Catégorie' },
  { field: 'techno', kind: 'techno', label: 'Techno' },
  { field: 'version', kind: 'version', label: 'Version' },
  { field: 'sprint', kind: 'sprint', label: 'Sprint' },
  { field: 'area', kind: 'area', label: 'Domaine' },
];

export default function Filters({
  taxonomies,
  users,
  filters,
  onChange,
}: {
  taxonomies: TaxonomyItem[] | undefined;
  users: PublicUser[] | undefined;
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
}) {
  function toggle(field: MultiField, value: string) {
    const current = filters[field] as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    onChange({ ...filters, [field]: next });
  }

  function resetField(field: MultiField) {
    onChange({ ...filters, [field]: [] });
  }

  return (
    <div className="controls">
      <div className="ctrl">
        <label>Recherche</label>
        <input
          type="text"
          placeholder="id, titre, mots-clés…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      {DIMENSIONS.map(({ field, kind, label }) => {
        const items = taxonomiesByKind(taxonomies, kind);
        if (!items.length) return null;
        return (
          <div className="ctrl" style={{ flex: 1, minWidth: 160 }} key={field}>
            <label>Filtres {label.toLowerCase()}</label>
            <div className="chips chips-scroll">
              {items.map((item) => (
                <span
                  key={item.key}
                  className={`chip ${filters[field].includes(item.key) ? 'active' : ''}`}
                  style={
                    filters[field].includes(item.key) && item.color
                      ? { background: item.color, borderColor: item.color, color: '#10131c' }
                      : undefined
                  }
                  onClick={() => toggle(field, item.key)}
                >
                  {item.label}
                </span>
              ))}
              {filters[field].length > 0 && (
                <span className="chip reset" onClick={() => resetField(field)}>
                  ✕ tout
                </span>
              )}
            </div>
          </div>
        );
      })}

      {users && users.length > 0 && (
        <div className="ctrl" style={{ flex: 1, minWidth: 160 }}>
          <label>Filtres assigné</label>
          <div className="chips chips-scroll">
            {users.map((u) => (
              <span
                key={u.id}
                className={`chip ${filters.assignee.includes(u.id) ? 'active' : ''}`}
                onClick={() => toggle('assignee', u.id)}
              >
                {u.displayName}
              </span>
            ))}
            <span
              className={`chip ${filters.assignee.includes('unassigned') ? 'active' : ''}`}
              onClick={() => toggle('assignee', 'unassigned')}
            >
              Non assigné
            </span>
            {filters.assignee.length > 0 && (
              <span className="chip reset" onClick={() => resetField('assignee')}>
                ✕ tout
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
