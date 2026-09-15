import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useDeleteTaxonomy, useReplaceTaxonomy } from '../../api/taxonomies';
import type { TaxonomyItem } from '../../types';

// Delete a taxonomy value: directly when unused, otherwise by moving its tasks
// (with history) and saved filters to another value of the same kind.
export default function ReplaceValueDialog({
  projectKey,
  item,
  candidates,
  usage,
  onClose,
}: {
  projectKey: string;
  item: TaxonomyItem;
  candidates: TaxonomyItem[];
  usage: number;
  onClose: () => void;
}) {
  const replace = useReplaceTaxonomy(projectKey);
  const remove = useDeleteTaxonomy(projectKey);
  const [target, setTarget] = useState(candidates[0]?.key || '');
  const [err, setErr] = useState<string | null>(null);
  const busy = replace.isPending || remove.isPending;

  async function submit() {
    setErr(null);
    try {
      if (usage === 0) await remove.mutateAsync(item._id);
      else await replace.mutateAsync({ id: item._id, replacementKey: target });
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>Supprimer « {item.label} »</h3>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>
        <div className="stack">
          {usage === 0 ? (
            <p className="text-muted">Cette valeur n'est utilisée par aucune tâche : elle sera supprimée définitivement.</p>
          ) : (
            <>
              <p className="text-muted">
                {usage} tâche(s) utilisent cette valeur. Elles seront réaffectées (avec une entrée d'historique), ainsi que les filtres
                enregistrés qui la mentionnent.
              </p>
              <div className="field">
                <label>Remplacer par</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {candidates.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {err && <div className="form-error">{err}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={onClose}>
              Annuler
            </button>
            <button className="btn danger" disabled={busy || (usage > 0 && !target)} onClick={submit}>
              {usage === 0 ? 'Supprimer' : 'Réaffecter et supprimer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
