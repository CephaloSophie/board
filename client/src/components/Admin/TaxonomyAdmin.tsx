import { useMemo, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useTasks } from '../../api/tasks';
import { useCreateTaxonomy, useReorderTaxonomies, useTaxonomies, useUpdateTaxonomy } from '../../api/taxonomies';
import { useProjectRole } from '../../hooks/useProjectRole';
import { slugKey } from '../../utils/versions';
import type { EventFeature, Task, TaxonomyItem, TaxonomyKind } from '../../types';
import ReplaceValueDialog from '../ProjectSettings/ReplaceValueDialog';

export { SPRINT_STATUS_META } from '../../utils/status';

// Statuses, sprints and versions have dedicated tabs (Workflow, Sprints & versions).
const KINDS: { value: TaxonomyKind; label: string; hint: string }[] = [
  { value: 'priority', label: 'Priorités', hint: "L'ordre va de la plus urgente à la moins urgente." },
  { value: 'type', label: 'Types', hint: 'Cochez « bug » pour les types comptés dans les indicateurs de bugs.' },
  { value: 'category', label: 'Catégories', hint: 'Regroupement métier libre (IHM, serveur, documentation…).' },
  { value: 'techno', label: 'Technos', hint: 'Technologies ou composants techniques.' },
  { value: 'area', label: 'Domaines', hint: "Zones fonctionnelles de l'application." },
  { value: 'eventType', label: "Types d'événement", hint: 'Rituels proposés dans « Rituels » et les sections affichées pour chacun.' },
];

const ALL_FEATURES: { key: EventFeature; label: string }[] = [
  { key: 'participants', label: 'Participants' },
  { key: 'backlog', label: 'Tâches liées' },
  { key: 'estimation', label: 'Estimation' },
  { key: 'agenda', label: 'Ordre du jour' },
  { key: 'decisions', label: 'Décisions' },
  { key: 'actions', label: 'Actions à suivre' },
  { key: 'adr', label: 'Décision archi (ADR)' },
  { key: 'demo', label: 'Ordre de démo' },
  { key: 'notes', label: 'Notes libres' },
];

export default function TaxonomyAdmin({ projectKey }: { projectKey: string }) {
  const { isAdmin } = useProjectRole(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey, { includeArchived: true });
  const { data: tasks } = useTasks(projectKey, {}, { summary: true });
  const create = useCreateTaxonomy(projectKey);
  const reorder = useReorderTaxonomies(projectKey);
  const [kind, setKind] = useState<TaxonomyKind>('priority');
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [color, setColor] = useState('#6b78ea');
  const [icon, setIcon] = useState('📌');
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<TaxonomyItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = useMemo(
    () => (taxonomies || []).filter((t) => t.kind === kind).sort((a, b) => a.order - b.order),
    [taxonomies, kind]
  );
  const items = all.filter((t) => showArchived || !t.archived);
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    const field = kind as keyof Task;
    for (const t of tasks || []) {
      const v = t[field];
      if (typeof v === 'string') map.set(v, (map.get(v) || 0) + 1);
    }
    return map;
  }, [tasks, kind]);
  const meta = KINDS.find((k) => k.value === kind)!;

  function move(item: TaxonomyItem, delta: number) {
    const keys = all.map((t) => t.key);
    const index = keys.indexOf(item.key);
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    reorder.mutate({ kind, keys });
  }

  async function add() {
    setError(null);
    try {
      await create.mutateAsync({
        kind,
        key: key.trim() || slugKey(label) || `${kind}-${Date.now()}`,
        label: label.trim(),
        color,
        meta: kind === 'eventType' ? { icon: icon || '📌', features: ['participants', 'backlog', 'agenda'] } : {},
      });
      setLabel('');
      setKey('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <h2 className="mt-0">Taxonomies du projet</h2>
      <div className="tabs">
        {KINDS.map((k) => (
          <button key={k.value} className={kind === k.value ? 'active' : ''} onClick={() => setKind(k.value)}>
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-muted section-intro">
        {meta.hint} Les éléments archivés restent liés aux tâches existantes mais ne sont plus proposés.
      </p>
      <label className="row radio" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
        Afficher les éléments archivés
      </label>
      {error && <div className="form-error">{error}</div>}

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {isAdmin && <th>Ordre</th>}
              {kind === 'eventType' && <th>Icône</th>}
              <th>Couleur</th>
              <th>Libellé</th>
              <th>Clé</th>
              {kind === 'type' && <th>Bug</th>}
              {kind === 'eventType' ? <th>Sections</th> : <th>Tâches</th>}
              <th>État</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <TaxonomyRow
                key={item._id}
                projectKey={projectKey}
                item={item}
                isAdmin={isAdmin}
                usage={usage.get(item.key) || 0}
                onUp={() => move(item, -1)}
                onDown={() => move(item, 1)}
                onDelete={() => setDeleting(item)}
                onError={setError}
              />
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="empty">
                  Aucun élément.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="form-row">
          {kind === 'eventType' && (
            <input type="text" value={icon} onChange={(e) => setIcon(e.target.value)} style={{ width: 56, minWidth: 0, textAlign: 'center' }} title="Emoji" />
          )}
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, padding: 2 }} />
          <input type="text" placeholder="Libellé" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input type="text" placeholder={`clé (${slugKey(label) || 'auto'})`} value={key} onChange={(e) => setKey(e.target.value)} style={{ minWidth: 140, width: 160 }} />
          <button className="btn primary small" onClick={add} disabled={!label.trim() || create.isPending}>
            + Ajouter
          </button>
        </div>
      )}

      {deleting && (
        <ReplaceValueDialog
          projectKey={projectKey}
          item={deleting}
          usage={kind === 'eventType' ? 1 : usage.get(deleting.key) || 0}
          candidates={all.filter((t) => t.key !== deleting.key && !t.archived)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function TaxonomyRow({
  projectKey,
  item,
  isAdmin,
  usage,
  onUp,
  onDown,
  onDelete,
  onError,
}: {
  projectKey: string;
  item: TaxonomyItem;
  isAdmin: boolean;
  usage: number;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
  onError: (msg: string | null) => void;
}) {
  const update = useUpdateTaxonomy(projectKey);
  const meta = (item.meta || {}) as { icon?: string; features?: EventFeature[]; isBug?: boolean };
  const [label, setLabel] = useState(item.label);
  const [icon, setIcon] = useState(meta.icon || '📌');

  async function save(data: Partial<TaxonomyItem>) {
    onError(null);
    try {
      await update.mutateAsync({ id: item._id, data });
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  function toggleFeature(f: EventFeature) {
    const features = meta.features || [];
    save({ meta: { features: features.includes(f) ? features.filter((x) => x !== f) : [...features, f] } });
  }

  return (
    <tr style={item.archived ? { opacity: 0.5 } : undefined}>
      {isAdmin && (
        <td className="nowrap">
          <button className="icon-btn" onClick={onUp} title="Monter">
            ▲
          </button>
          <button className="icon-btn" onClick={onDown} title="Descendre">
            ▼
          </button>
        </td>
      )}
      {item.kind === 'eventType' && (
        <td>
          {isAdmin ? (
            <input type="text" value={icon} onChange={(e) => setIcon(e.target.value)} onBlur={() => icon !== meta.icon && save({ meta: { icon } })} style={{ width: 48, minWidth: 0, textAlign: 'center' }} />
          ) : (
            meta.icon
          )}
        </td>
      )}
      <td>
        <input type="color" value={item.color || '#6b7280'} disabled={!isAdmin} onChange={(e) => save({ color: e.target.value })} style={{ width: 40, padding: 2 }} />
      </td>
      <td>
        {isAdmin ? (
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() && label !== item.label && save({ label: label.trim() })} />
        ) : (
          item.label
        )}
      </td>
      <td className="mono text-muted">{item.key}</td>
      {item.kind === 'type' && (
        <td>
          <input type="checkbox" checked={!!meta.isBug} disabled={!isAdmin} onChange={(e) => save({ meta: { isBug: e.target.checked } })} />
        </td>
      )}
      {item.kind === 'eventType' ? (
        <td>
          <div className="chips" style={{ maxWidth: 360 }}>
            {ALL_FEATURES.map((f) => (
              <button
                type="button"
                key={f.key}
                disabled={!isAdmin}
                className={`chip${(meta.features || []).includes(f.key) ? ' active' : ''}`}
                onClick={() => toggleFeature(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </td>
      ) : (
        <td>{usage}</td>
      )}
      <td>{item.archived ? 'Archivé' : 'Actif'}</td>
      {isAdmin && (
        <td className="nowrap">
          <button className="btn small ghost" onClick={() => save({ archived: !item.archived })}>
            {item.archived ? 'Réactiver' : 'Archiver'}
          </button>
          <button className="btn small danger" onClick={onDelete}>
            Supprimer…
          </button>
        </td>
      )}
    </tr>
  );
}
