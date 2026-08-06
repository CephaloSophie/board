import { useState } from 'react';
import type { EventFeature, SprintMeta, SprintStatus, TaxonomyItem, TaxonomyKind } from '../../types';
import { useCreateTaxonomy, useDeleteTaxonomy, useTaxonomies, useUpdateTaxonomy, taxonomiesByKind } from '../../api/taxonomies';
import { useProject } from '../../api/projects';
import { useAuth } from '../../context/AuthContext';

const KINDS: { value: TaxonomyKind; label: string }[] = [
  { value: 'status', label: 'Statuts' },
  { value: 'priority', label: 'Priorités' },
  { value: 'type', label: 'Types' },
  { value: 'category', label: 'Catégories' },
  { value: 'techno', label: 'Technos' },
  { value: 'area', label: 'Domaines' },
  { value: 'version', label: 'Versions' },
  { value: 'sprint', label: 'Sprints' },
  { value: 'eventType', label: "Types d'événement" },
];

export const SPRINT_STATUS_META: Record<SprintStatus, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: '#6b7280' },
  ready: { label: 'Prêt', color: '#9db4dd' },
  active: { label: 'Actif', color: '#e6c46a' },
  finished: { label: 'Terminé', color: '#2f8f57' },
};

const ALL_FEATURES: { key: EventFeature; label: string }[] = [
  { key: 'participants', label: 'Participants' },
  { key: 'backlog', label: 'Tâches liées' },
  { key: 'estimation', label: 'Estimation' },
  { key: 'agenda', label: 'Ordre du jour' },
  { key: 'decisions', label: 'Décisions' },
  { key: 'actions', label: "Actions à suivre" },
  { key: 'adr', label: 'Décision archi (ADR)' },
  { key: 'demo', label: 'Ordre de démo' },
  { key: 'notes', label: 'Notes libres' },
];

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 3600 * 1000);
}

export default function TaxonomyAdmin({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'superadmin';
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: project } = useProject(projectKey);
  const createItem = useCreateTaxonomy(projectKey);
  const updateItem = useUpdateTaxonomy(projectKey);
  const deleteItem = useDeleteTaxonomy(projectKey);
  const [kind, setKind] = useState<TaxonomyKind>('status');
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#6b78ea');
  const [newIcon, setNewIcon] = useState('📌');
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const items = (taxonomies || [])
    .filter((i) => i.kind === kind && (showArchived || !i.archived))
    .sort((a, b) => a.order - b.order);

  // Effective sprint length in days from project settings.
  const effectiveDays = project
    ? (project.sprintDurationUnit === 'weeks' ? project.sprintDurationValue * 7 : project.sprintDurationValue)
    : 7;

  async function add() {
    setErr(null);
    if (!newKey.trim() || !newLabel.trim()) return;
    try {
      const meta: Record<string, unknown> = {};
      if (kind === 'sprint') {
        // Chain the new sprint after the latest existing one, using the
        // project's *current* cadence — past sprints are untouched.
        const sprints = taxonomiesByKind(taxonomies, 'sprint');
        const last = sprints[sprints.length - 1];
        const lastEnd = (last?.meta as SprintMeta | undefined)?.endDate;
        const start = lastEnd ? addDays(new Date(lastEnd), 1) : new Date();
        meta.status = 'draft';
        meta.startDate = start.toISOString();
        meta.endDate = addDays(start, effectiveDays - 1).toISOString();
      }
      if (kind === 'eventType') {
        meta.icon = newIcon || '📌';
        meta.features = ['participants', 'backlog', 'agenda'];
      }
      await createItem.mutateAsync({
        kind,
        key: newKey.trim(),
        label: newLabel.trim(),
        color: newColor,
        order: items.length,
        meta,
      });
      setNewKey('');
      setNewLabel('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erreur lors de l'ajout.");
    }
  }

  async function remove(item: TaxonomyItem) {
    if (!confirm(`Supprimer "${item.label}" ?`)) return;
    try {
      await deleteItem.mutateAsync(item._id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Suppression impossible.');
    }
  }

  const isSprint = kind === 'sprint';
  const isEventType = kind === 'eventType';

  return (
    <div>
      <h2 className="mt-0">Taxonomies du projet</h2>
      <p className="text-muted" style={{ fontSize: 12.5 }}>
        Ajoutez, modifiez, archivez ou supprimez chaque dimension du projet. Les éléments archivés
        restent liés à leurs tâches/événements existants mais ne sont plus proposés dans les listes.
      </p>

      <div className="tabs">
        {KINDS.map((k) => (
          <button key={k.value} className={kind === k.value ? 'active' : ''} onClick={() => setKind(k.value)}>
            {k.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 6, gap: 12, fontSize: 12 }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Afficher les éléments archivés
        </label>
        {isSprint && project && (
          <span className="text-muted">
            Nouveau sprint : {effectiveDays} jour(s), enchaîné après le dernier.
          </span>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              {isEventType && <th>Icône</th>}
              <th>Clé</th>
              <th>Libellé</th>
              <th>Couleur</th>
              <th>Ordre</th>
              {isSprint && <th>Statut</th>}
              {isSprint && <th>Début</th>}
              {isSprint && <th>Fin</th>}
              {isSprint && <th>But</th>}
              {isEventType && <th>Sections</th>}
              <th>État</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <TaxonomyRow
                key={item._id}
                item={item}
                canEdit={canEdit}
                isSprint={isSprint}
                isEventType={isEventType}
                onSave={(data) => updateItem.mutate({ id: item._id, data })}
                onDelete={() => remove(item)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <>
          <div className="form-row">
            {isEventType && (
              <input value={newIcon} onChange={(e) => setNewIcon(e.target.value)} style={{ width: 50, textAlign: 'center' }} title="Emoji" />
            )}
            <input placeholder="clé (ex: onhold)" value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ width: 140 }} />
            <input placeholder="libellé" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ width: 200 }} />
            <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} style={{ width: 44, padding: 2 }} />
            <button className="btn primary small" onClick={add} disabled={createItem.isPending}>
              + Ajouter
            </button>
          </div>
          {err && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</div>}
        </>
      )}
    </div>
  );
}

function TaxonomyRow({
  item,
  canEdit,
  isSprint,
  isEventType,
  onSave,
  onDelete,
}: {
  item: TaxonomyItem;
  canEdit: boolean;
  isSprint: boolean;
  isEventType: boolean;
  onSave: (data: Partial<TaxonomyItem>) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [color, setColor] = useState(item.color || '#6b78ea');
  const [order, setOrder] = useState(item.order);
  const meta = (item.meta || {}) as SprintMeta & { icon?: string; features?: EventFeature[] };

  const [status, setStatus] = useState<SprintStatus>((meta.status as SprintStatus) || 'draft');
  const [startDate, setStartDate] = useState(meta.startDate ? meta.startDate.slice(0, 10) : '');
  const [endDate, setEndDate] = useState(meta.endDate ? meta.endDate.slice(0, 10) : '');
  const [goal, setGoal] = useState(meta.goal || '');

  const [icon, setIcon] = useState(meta.icon || '📌');
  const [features, setFeatures] = useState<EventFeature[]>(meta.features || []);

  const currentMetaStart = meta.startDate ? meta.startDate.slice(0, 10) : '';
  const currentMetaEnd = meta.endDate ? meta.endDate.slice(0, 10) : '';
  const dirty =
    label !== item.label ||
    color !== item.color ||
    order !== item.order ||
    (isSprint &&
      (status !== (meta.status || 'draft') ||
        startDate !== currentMetaStart ||
        endDate !== currentMetaEnd ||
        goal !== (meta.goal || ''))) ||
    (isEventType && (icon !== (meta.icon || '📌') || JSON.stringify(features) !== JSON.stringify(meta.features || [])));

  function toggleFeature(f: EventFeature) {
    setFeatures((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }

  function save() {
    const patch: Partial<TaxonomyItem> = { label, color, order };
    if (isSprint) {
      patch.meta = {
        ...meta,
        status,
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        goal,
      };
    }
    if (isEventType) {
      patch.meta = { ...meta, icon, features };
    }
    onSave(patch);
  }

  if (!canEdit) {
    return (
      <tr style={item.archived ? { opacity: 0.5 } : undefined}>
        {isEventType && <td style={{ fontSize: 16 }}>{meta.icon || '📌'}</td>}
        <td style={{ fontFamily: 'var(--mono)', color: 'var(--mute)' }}>{item.key}</td>
        <td>{item.label}</td>
        <td>
          <span className="swatch" style={{ background: item.color }} />
        </td>
        <td>{item.order}</td>
        {isSprint && (
          <>
            <td>{meta.status || '—'}</td>
            <td>{currentMetaStart || '—'}</td>
            <td>{currentMetaEnd || '—'}</td>
            <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.goal || '—'}</td>
          </>
        )}
        {isEventType && <td style={{ fontSize: 11 }}>{(meta.features || []).join(', ') || '—'}</td>}
        <td>{item.archived ? 'Archivé' : 'Actif'}</td>
      </tr>
    );
  }

  return (
    <tr style={item.archived ? { opacity: 0.55 } : undefined}>
      {isEventType && (
        <td>
          <input value={icon} onChange={(e) => setIcon(e.target.value)} style={{ width: 44, textAlign: 'center' }} />
        </td>
      )}
      <td style={{ fontFamily: 'var(--mono)', color: 'var(--mute)' }}>{item.key}</td>
      <td>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 150 }} />
      </td>
      <td>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, padding: 2 }} />
      </td>
      <td>
        <input type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} style={{ width: 56 }} />
      </td>
      {isSprint && (
        <>
          <td>
            <select value={status} onChange={(e) => setStatus(e.target.value as SprintStatus)} style={{ width: 110 }}>
              <option value="draft">Brouillon</option>
              <option value="ready">Prêt</option>
              <option value="active">Actif</option>
              <option value="finished">Terminé</option>
            </select>
          </td>
          <td>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </td>
          <td>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </td>
          <td>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} style={{ width: 170 }} placeholder="Objectif du sprint" />
          </td>
        </>
      )}
      {isEventType && (
        <td>
          <div className="chips" style={{ maxWidth: 320 }}>
            {ALL_FEATURES.map((f) => (
              <span
                key={f.key}
                className={`chip ${features.includes(f.key) ? 'active' : ''}`}
                onClick={() => toggleFeature(f.key)}
                style={{ fontSize: 9.5 }}
              >
                {f.label}
              </span>
            ))}
          </div>
        </td>
      )}
      <td>{item.archived ? 'Archivé' : 'Actif'}</td>
      <td className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <button className="btn small" disabled={!dirty} onClick={save}>
          Enregistrer
        </button>
        <button
          className="btn small"
          onClick={() => onSave({ archived: !item.archived })}
          title={item.archived ? 'Réactiver' : 'Archiver'}
        >
          {item.archived ? 'Réactiver' : 'Archiver'}
        </button>
        <button className="btn danger small" onClick={onDelete}>
          Suppr.
        </button>
      </td>
    </tr>
  );
}
