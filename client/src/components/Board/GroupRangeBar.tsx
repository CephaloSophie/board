import type { SprintMeta, TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';
import { SPRINT_STATUS_META } from '../../utils/status';
import {
  CURRENT_REF,
  DEFAULT_GROUP_RANGE,
  ORDERED_DIMENSIONS,
  RANGE_LIMIT_MAX,
  hasCurrentRef,
  isGroupRangeActive,
  isOrderedDimension,
  orderDimensionValues,
  type GroupRange,
  type GroupRangeKeepSide,
  type GroupRangeMode,
} from '../../utils/groupRange';
import { FilterDropdown, type FilterOption } from './Filters';
import { GROUP_OPTIONS, type GroupByKey } from './groupUtils';

const MODES: { value: GroupRangeMode; label: string }[] = [
  { value: 'all', label: 'Tous les groupes' },
  { value: 'from', label: 'Référence et suivants' },
  { value: 'until', label: 'Référence et précédents' },
  { value: 'around', label: 'Autour de la référence' },
];

const KEEP_SIDES: { value: GroupRangeKeepSide; label: string }[] = [
  { value: 'before', label: 'précédents' },
  { value: 'after', label: 'suivants' },
  { value: 'both', label: 'précédents et suivants' },
];

const NONE_LABELS: Partial<Record<GroupByKey, string>> = {
  sprint: 'Backlog (sans sprint)',
  version: 'Sans version',
  assignee: 'Non assigné',
  parent: 'Sans tâche parente',
};

const groupLabel = (g: GroupByKey) => GROUP_OPTIONS.find((o) => o.value === g)?.label || g;

export interface RangeSummary {
  hiddenGroups: number;
  hiddenTasks: number;
  refMissing: boolean;
  outOfRange: number;
}

/**
 * "Plage de groupes": restricts the board / list groups of an ordered grouping
 * dimension (sprint, version, priority, status) around a reference group, with
 * status exceptions for out-of-range groups. State lives in the URL (BoardState.range).
 */
export default function GroupRangeBar({
  groupBy,
  taxonomies,
  range,
  onChange,
  summary,
  currentSprint,
  currentVersion,
}: {
  groupBy: GroupByKey;
  taxonomies: TaxonomyItem[] | undefined;
  range: GroupRange;
  onChange: (next: GroupRange) => void;
  summary?: RangeSummary;
  currentSprint?: string | null;
  currentVersion?: string | null;
}) {
  if (groupBy === 'none') return null;
  const ordered = isOrderedDimension(groupBy);
  const set = (patch: Partial<GroupRange>) => onChange({ ...range, ...patch });
  const values = ordered ? orderDimensionValues(groupBy, taxonomies || []) : [];
  const currentKey = groupBy === 'sprint' ? currentSprint : groupBy === 'version' ? currentVersion : null;
  const currentLabel = currentKey ? values.find((v) => v.key === currentKey)?.label || currentKey : null;
  const statusOptions: FilterOption[] = taxonomiesByKind(taxonomies, 'status').map((s) => ({ value: s.key, label: s.label, color: s.color }));
  const knownRef = range.ref === CURRENT_REF || values.some((v) => v.key === range.ref);
  const orderedNames = ORDERED_DIMENSIONS.map((d) => groupLabel(d)).join(', ');

  const limitInput = (field: 'before' | 'after', label: string, title: string) => (
    <label className="range-bar__field" title={title}>
      {label}
      <input
        type="number"
        min={0}
        max={RANGE_LIMIT_MAX}
        placeholder="∞"
        value={range[field] ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          set({ [field]: v === '' ? null : Math.max(0, Math.min(RANGE_LIMIT_MAX, Math.floor(Number(v)) || 0)) });
        }}
      />
    </label>
  );

  return (
    <div className="range-bar">
      <span className="range-bar__title" title="Restreindre les groupes affichés autour d'un groupe de référence">
        Plage de groupes
      </span>
      {ordered ? (
        <>
          <select
            value={range.mode}
            aria-label="Plage de groupes"
            onChange={(e) => {
              const mode = e.target.value as GroupRangeMode;
              // Priority / status have no "current" value: start from the first one.
              const ref = !hasCurrentRef(groupBy) && range.ref === CURRENT_REF && values.length ? values[0].key : range.ref;
              set({ mode, ref });
            }}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          {range.mode !== 'all' && (
            <>
              <label className="range-bar__field">
                Référence
                <select value={range.ref} onChange={(e) => set({ ref: e.target.value })}>
                  {hasCurrentRef(groupBy) && (
                    <option value={CURRENT_REF}>
                      {groupBy === 'sprint' ? 'Sprint actuel' : 'Version actuelle'}
                      {currentLabel ? ` (${currentLabel})` : ' (aucun)'}
                    </option>
                  )}
                  {!hasCurrentRef(groupBy) && range.ref === CURRENT_REF && <option value={CURRENT_REF}>— Choisir —</option>}
                  {!knownRef && <option value={range.ref}>{range.ref} (introuvable)</option>}
                  {values.map((v) => {
                    const st = groupBy === 'sprint' ? (v.meta as SprintMeta | undefined)?.status : undefined;
                    return (
                      <option key={v.key} value={v.key}>
                        {v.label}
                        {st ? ` · ${SPRINT_STATUS_META[st]?.label ?? st}` : ''}
                        {v.archived ? ' · archivé' : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
              {range.mode !== 'from' &&
                limitInput('before', 'Max. précédents', 'Nombre maximum de groupes avant la référence (vide = illimité)')}
              {range.mode !== 'until' &&
                limitInput('after', 'Max. suivants', 'Nombre maximum de groupes après la référence (vide = illimité)')}
              <span title="Les groupes hors plage restent affichés s'ils contiennent des tâches dans ces statuts : seules ces tâches y sont montrées (badge « hors plage »).">
                <FilterDropdown label="Sauf statuts" options={statusOptions} selected={range.keep} onChange={(keep) => set({ keep })} />
              </span>
              {range.keep.length > 0 && (
                <label className="range-bar__field" title="Groupes hors plage auxquels s'appliquent les exceptions de statut">
                  dans les groupes
                  <select value={range.keepSide} onChange={(e) => set({ keepSide: e.target.value as GroupRangeKeepSide })}>
                    {KEEP_SIDES.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </>
      ) : (
        <span className="hint">
          Indisponible pour « {groupLabel(groupBy)} » (pas d'ordre naturel) — regrouper par {orderedNames}.
        </span>
      )}
      <label className="range-bar__check" title="Afficher le groupe des tâches sans valeur pour ce regroupement">
        <input type="checkbox" checked={range.showNone} onChange={(e) => set({ showNone: e.target.checked })} />
        {NONE_LABELS[groupBy] || 'Sans valeur'}
      </label>
      {summary?.refMissing && ordered && range.mode !== 'all' && (
        <span className="range-bar__warn">Référence introuvable : plage ignorée.</span>
      )}
      {summary && (summary.hiddenGroups > 0 || summary.hiddenTasks > 0 || summary.outOfRange > 0) && (
        <span className="range-bar__summary">
          {summary.hiddenGroups} groupe{summary.hiddenGroups > 1 ? 's' : ''} masqué{summary.hiddenGroups > 1 ? 's' : ''} ·{' '}
          {summary.hiddenTasks} tâche{summary.hiddenTasks > 1 ? 's' : ''} hors vue
          {summary.outOfRange > 0 ? ` · ${summary.outOfRange} hors plage conservé${summary.outOfRange > 1 ? 's' : ''}` : ''}
        </span>
      )}
      {isGroupRangeActive(range) && (
        <button className="btn small ghost" onClick={() => onChange({ ...DEFAULT_GROUP_RANGE })}>
          ✕ Réinitialiser la plage
        </button>
      )}
    </div>
  );
}
