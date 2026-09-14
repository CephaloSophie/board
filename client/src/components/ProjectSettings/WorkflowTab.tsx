import { useMemo, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useTasks } from '../../api/tasks';
import { useCreateTaxonomy, useReorderTaxonomies, useTaxonomies, useUpdateTaxonomy } from '../../api/taxonomies';
import { useProjectRole } from '../../hooks/useProjectRole';
import { STATUS_CATEGORY_META, statusCategoryOf } from '../../utils/status';
import { slugKey } from '../../utils/versions';
import type { StatusCategory, TaxonomyItem } from '../../types';
import ReplaceValueDialog from './ReplaceValueDialog';

const CATEGORIES = Object.keys(STATUS_CATEGORY_META) as StatusCategory[];

export default function WorkflowTab({ projectKey }: { projectKey: string }) {
  const { isAdmin } = useProjectRole(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey, { includeArchived: true });
  const { data: tasks } = useTasks(projectKey, {}, { summary: true });
  const create = useCreateTaxonomy(projectKey);
  const reorder = useReorderTaxonomies(projectKey);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState('#9db4dd');
  const [category, setCategory] = useState<StatusCategory>('inprogress');
  const [deleting, setDeleting] = useState<TaxonomyItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statuses = useMemo(
    () => (taxonomies || []).filter((t) => t.kind === 'status').sort((a, b) => a.order - b.order),
    [taxonomies]
  );
  const usage = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks || []) map.set(t.status, (map.get(t.status) || 0) + 1);
    return map;
  }, [tasks]);

  function move(index: number, delta: number) {
    const keys = statuses.map((s) => s.key);
    const target = index + delta;
    if (target < 0 || target >= keys.length) return;
    [keys[index], keys[target]] = [keys[target], keys[index]];
    reorder.mutate({ kind: 'status', keys });
  }

  async function add() {
    setError(null);
    try {
      await create.mutateAsync({ kind: 'status', key: slugKey(label) || `status-${Date.now()}`, label: label.trim(), color, meta: { category } });
      setLabel('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <h2 className="mt-0">Workflow & statuts</h2>
      <p className="text-muted section-intro">
        L'ordre définit les colonnes du board. La catégorie indique si un statut compte comme « à faire », « en cours » ou « terminé » :
        elle alimente les statistiques, la clôture de sprint, les burndowns et les filtres « catégorie de statut ».
      </p>
      {error && <div className="form-error">{error}</div>}

      <div className="flow-preview">
        {statuses
          .filter((s) => !s.archived)
          .map((s, i, arr) => (
            <span key={s.key} className="flow-step">
              <span className="flow-pill" style={{ borderColor: s.color, color: s.color }}>
                {s.label}
              </span>
              {i < arr.length - 1 && <span className="flow-arrow">→</span>}
            </span>
          ))}
      </div>

      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              {isAdmin && <th>Ordre</th>}
              <th>Couleur</th>
              <th>Libellé</th>
              <th>Clé</th>
              <th>Catégorie</th>
              <th>Tâches</th>
              <th>État</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {statuses.map((s, index) => (
              <StatusRow
                key={s._id}
                projectKey={projectKey}
                status={s}
                usage={usage.get(s.key) || 0}
                isAdmin={isAdmin}
                onUp={index > 0 ? () => move(index, -1) : undefined}
                onDown={index < statuses.length - 1 ? () => move(index, 1) : undefined}
                onDelete={() => setDeleting(s)}
                onError={setError}
              />
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <div className="form-row">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 44, padding: 2 }} />
          <input type="text" placeholder="Nouveau statut (ex. En revue)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value as StatusCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {STATUS_CATEGORY_META[c].label}
              </option>
            ))}
          </select>
          <button className="btn primary small" disabled={!label.trim() || create.isPending} onClick={add}>
            + Ajouter
          </button>
        </div>
      )}

      {deleting && (
        <ReplaceValueDialog
          projectKey={projectKey}
          item={deleting}
          usage={usage.get(deleting.key) || 0}
          candidates={statuses.filter((s) => s.key !== deleting.key && !s.archived)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function StatusRow({
  projectKey,
  status,
  usage,
  isAdmin,
  onUp,
  onDown,
  onDelete,
  onError,
}: {
  projectKey: string;
  status: TaxonomyItem;
  usage: number;
  isAdmin: boolean;
  onUp?: () => void;
  onDown?: () => void;
  onDelete: () => void;
  onError: (msg: string | null) => void;
}) {
  const update = useUpdateTaxonomy(projectKey);
  const [label, setLabel] = useState(status.label);
  const category = statusCategoryOf(status);

  async function save(data: Partial<TaxonomyItem>) {
    onError(null);
    try {
      await update.mutateAsync({ id: status._id, data });
    } catch (e) {
      onError(errorMessage(e));
    }
  }

  return (
    <tr style={status.archived ? { opacity: 0.5 } : undefined}>
      {isAdmin && (
        <td className="nowrap">
          <button className="icon-btn" disabled={!onUp} onClick={onUp} title="Monter">
            ▲
          </button>
          <button className="icon-btn" disabled={!onDown} onClick={onDown} title="Descendre">
            ▼
          </button>
        </td>
      )}
      <td>
        <input
          type="color"
          value={status.color || '#6b7280'}
          disabled={!isAdmin}
          onChange={(e) => save({ color: e.target.value })}
          style={{ width: 40, padding: 2 }}
        />
      </td>
      <td>
        {isAdmin ? (
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() && label !== status.label && save({ label: label.trim() })} />
        ) : (
          status.label
        )}
      </td>
      <td className="mono text-muted">{status.key}</td>
      <td>
        <select value={category} disabled={!isAdmin} onChange={(e) => save({ meta: { category: e.target.value } })}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {STATUS_CATEGORY_META[c].label}
            </option>
          ))}
        </select>
      </td>
      <td>{usage}</td>
      <td>{status.archived ? 'Archivé' : 'Actif'}</td>
      {isAdmin && (
        <td className="nowrap">
          <button className="btn small ghost" onClick={() => save({ archived: !status.archived })}>
            {status.archived ? 'Réactiver' : 'Archiver'}
          </button>
          <button className="btn small danger" onClick={onDelete}>
            Supprimer…
          </button>
        </td>
      )}
    </tr>
  );
}
