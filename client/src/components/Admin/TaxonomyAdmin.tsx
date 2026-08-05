import { useState } from 'react';
import type { TaxonomyItem, TaxonomyKind } from '../../types';
import { useCreateTaxonomy, useDeleteTaxonomy, useTaxonomies, useUpdateTaxonomy } from '../../api/taxonomies';
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
];

export default function TaxonomyAdmin({ projectKey }: { projectKey: string }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'superadmin';
  const { data: taxonomies } = useTaxonomies(projectKey);
  const createItem = useCreateTaxonomy(projectKey);
  const updateItem = useUpdateTaxonomy(projectKey);
  const deleteItem = useDeleteTaxonomy(projectKey);
  const [kind, setKind] = useState<TaxonomyKind>('status');
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#6b78ea');
  const [err, setErr] = useState<string | null>(null);

  const items = (taxonomies || [])
    .filter((i) => i.kind === kind)
    .sort((a, b) => a.order - b.order);

  async function add() {
    setErr(null);
    if (!newKey.trim() || !newLabel.trim()) return;
    try {
      await createItem.mutateAsync({ kind, key: newKey.trim(), label: newLabel.trim(), color: newColor, order: items.length });
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

  return (
    <div>
      <h2>Taxonomies du projet</h2>
      <p className="text-muted" style={{ fontSize: 12.5 }}>
        Gérez les statuts, priorités, catégories, technos, domaines, versions et sprints utilisés par les tâches.
      </p>

      <div className="tabs">
        {KINDS.map((k) => (
          <button key={k.value} className={kind === k.value ? 'active' : ''} onClick={() => setKind(k.value)}>
            {k.label}
          </button>
        ))}
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Clé</th>
            <th>Libellé</th>
            <th>Couleur</th>
            <th>Ordre</th>
            {canEdit && <th></th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <TaxonomyRow
              key={item._id}
              item={item}
              canEdit={canEdit}
              onSave={(data) => updateItem.mutate({ id: item._id, data })}
              onDelete={() => remove(item)}
            />
          ))}
        </tbody>
      </table>

      {canEdit && (
        <>
          <div className="form-row">
            <input placeholder="clé (ex: onhold)" value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ width: 140 }} />
            <input placeholder="libellé (ex: En attente)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} style={{ width: 200 }} />
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
  onSave,
  onDelete,
}: {
  item: TaxonomyItem;
  canEdit: boolean;
  onSave: (data: Partial<TaxonomyItem>) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [color, setColor] = useState(item.color || '#6b78ea');
  const [order, setOrder] = useState(item.order);

  const dirty = label !== item.label || color !== item.color || order !== item.order;

  if (!canEdit) {
    return (
      <tr>
        <td style={{ fontFamily: 'var(--mono)', color: 'var(--mute)' }}>{item.key}</td>
        <td>{item.label}</td>
        <td>
          <span className="swatch" style={{ background: item.color }} />
        </td>
        <td>{item.order}</td>
      </tr>
    );
  }

  return (
    <tr>
      <td style={{ fontFamily: 'var(--mono)', color: 'var(--mute)' }}>{item.key}</td>
      <td>
        <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 160 }} />
      </td>
      <td>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, padding: 2 }} />
      </td>
      <td>
        <input type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} style={{ width: 60 }} />
      </td>
      <td className="row">
        <button className="btn small" disabled={!dirty} onClick={() => onSave({ label, color, order })}>
          Enregistrer
        </button>
        <button className="btn danger small" onClick={onDelete}>
          Suppr.
        </button>
      </td>
    </tr>
  );
}
