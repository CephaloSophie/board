import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_FILTERS,
  type MultiFilterField,
  type PublicUser,
  type SprintMeta,
  type StatusCategory,
  type TaskFilters,
  type TaxonomyItem,
  type TaxonomyKind,
} from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { SPRINT_STATUS_META } from '../Admin/TaxonomyAdmin';
import { countActiveFilters } from '../../utils/boardUrlState';
import { STATUS_CATEGORY_META } from '../../utils/status';

interface FilterOption {
  value: string;
  label: string;
  color?: string;
  hint?: string;
}

const DIMENSIONS: { field: MultiFilterField; kind: TaxonomyKind; label: string }[] = [
  { field: 'sprint', kind: 'sprint', label: 'Sprint' },
  { field: 'status', kind: 'status', label: 'Statut' },
  { field: 'priority', kind: 'priority', label: 'Priorité' },
  { field: 'type', kind: 'type', label: 'Type' },
  { field: 'version', kind: 'version', label: 'Version' },
  { field: 'category', kind: 'category', label: 'Catégorie' },
  { field: 'techno', kind: 'techno', label: 'Techno' },
  { field: 'area', kind: 'area', label: 'Domaine' },
];

/**
 * Compact Jira-like filter bar: free-text search plus one multi-select
 * dropdown per dimension (searchable when long). Selections are shown on the
 * dropdown button itself so the board keeps its vertical space.
 */
// Dynamic values resolved server-side at query time (a saved filter keeps following them).
const TOKENS: Partial<Record<MultiFilterField, FilterOption[]>> = {
  sprint: [
    { value: '@current', label: 'Sprint courant', hint: 'dynamique', color: '#e6c46a' },
    { value: '@open', label: 'Sprints non terminés', hint: 'dynamique', color: '#9db4dd' },
    { value: '@none', label: 'Backlog (sans sprint)', hint: 'dynamique', color: '#6b7280' },
  ],
  version: [
    { value: '@current', label: 'Version courante', hint: 'dynamique', color: '#e6c46a' },
    { value: '@unreleased', label: 'Versions non publiées', hint: 'dynamique', color: '#9db4dd' },
  ],
};

export default function Filters({
  taxonomies,
  users,
  labels,
  filters,
  onChange,
}: {
  taxonomies: TaxonomyItem[] | undefined;
  users: PublicUser[] | undefined;
  labels?: string[];
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
}) {
  const set = (field: MultiFilterField, values: string[]) => onChange({ ...filters, [field]: values });

  const optionsFor = (kind: TaxonomyKind): FilterOption[] =>
    taxonomiesByKind(taxonomies, kind).map((item) => {
      const sprintStatus = kind === 'sprint' ? (item.meta as SprintMeta | undefined)?.status : undefined;
      return {
        value: item.key,
        label: item.label,
        color: item.color,
        hint: sprintStatus ? SPRINT_STATUS_META[sprintStatus]?.label : undefined,
      };
    });

  const userOptions: FilterOption[] = [
    { value: '@me', label: 'Moi', hint: 'dynamique', color: '#e6c46a' },
    ...(users || []).map((u) => ({ value: u.id, label: u.displayName, color: u.color })),
    { value: 'unassigned', label: 'Non assigné', color: '#6b7280' },
  ];
  const progressOptions: FilterOption[] = (Object.keys(STATUS_CATEGORY_META) as StatusCategory[]).map((c) => ({
    value: c,
    label: STATUS_CATEGORY_META[c].label,
    color: STATUS_CATEGORY_META[c].color,
  }));
  const labelOptions: FilterOption[] = (labels || []).map((l) => ({ value: l, label: l, color: '#b39ddb' }));

  return (
    <div className="controls filterbar">
      <input
        type="search"
        className="filterbar__search"
        placeholder="Rechercher : id, titre, mots-clés…"
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
      />
      <FilterDropdown
        label="Avancement"
        options={progressOptions}
        selected={filters.statusCategory}
        onChange={(values) => set('statusCategory', values)}
      />
      {DIMENSIONS.map(({ field, kind, label }) => {
        const options = [...(TOKENS[field] || []), ...optionsFor(kind)];
        if (!options.length && !filters[field].length) return null;
        return (
          <FilterDropdown
            key={field}
            label={label}
            options={options}
            selected={filters[field]}
            onChange={(values) => set(field, values)}
          />
        );
      })}
      <FilterDropdown
        label="Assigné"
        options={userOptions}
        selected={filters.assignee}
        onChange={(values) => set('assignee', values)}
      />
      {(labelOptions.length > 0 || filters.labels.length > 0) && (
        <FilterDropdown label="Étiquettes" options={labelOptions} selected={filters.labels} onChange={(values) => set('labels', values)} />
      )}
      {countActiveFilters(filters) > 0 && (
        <button className="btn small ghost" onClick={() => onChange({ ...EMPTY_FILTERS })}>
          ✕ Effacer les filtres
        </button>
      )}
    </div>
  );
}

function FilterDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Selected values without a matching option (archived/unknown) stay visible and removable.
  const all = useMemo<FilterOption[]>(() => {
    const known = new Set(options.map((o) => o.value));
    return [...options, ...selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
  }, [options, selected]);

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? all.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle))
    : all;
  const selectedLabels = all.filter((o) => selected.includes(o.value)).map((o) => o.label);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  return (
    <div className="filter-dd" ref={rootRef}>
      <button
        type="button"
        className={`filter-dd__btn${selected.length ? ' active' : ''}${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="filter-dd__label">{label}</span>
        {selected.length > 0 && (
          <span className="filter-dd__value">
            {selectedLabels[0] ?? selected[0]}
            {selected.length > 1 ? ` +${selected.length - 1}` : ''}
          </span>
        )}
        <span className="filter-dd__caret">▾</span>
      </button>
      {open && (
        <div className="filter-dd__panel">
          {all.length > 7 && (
            <input
              type="search"
              autoFocus
              className="filter-dd__search"
              placeholder={`Filtrer ${label.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="filter-dd__actions">
            <button type="button" onClick={() => onChange(Array.from(new Set([...selected, ...visible.map((o) => o.value)])))}>
              Tout
            </button>
            <button type="button" onClick={() => onChange([])} disabled={!selected.length}>
              Aucun
            </button>
            <span>
              {selected.length} / {all.length}
            </span>
          </div>
          <div className="filter-dd__list">
            {visible.map((o) => (
              <label key={o.value} className={`filter-dd__option${selected.includes(o.value) ? ' on' : ''}`}>
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                {o.color && <span className="dot" style={{ background: o.color }} />}
                <span className="filter-dd__option-label">{o.label}</span>
                {o.hint && <span className="filter-dd__hint">{o.hint}</span>}
              </label>
            ))}
            {visible.length === 0 && <div className="empty">Aucune valeur.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
