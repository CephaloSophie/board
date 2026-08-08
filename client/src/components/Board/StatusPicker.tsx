import { useState } from 'react';
import type { TaxonomyItem } from '../../types';
import { taxonomiesByKind } from '../../api/taxonomies';

// Popup to choose which status columns are shown on the board — including
// empty ones. null = "auto" (only statuses that currently have tasks).
export default function StatusPicker({
  taxonomies,
  value,
  onChange,
}: {
  taxonomies: TaxonomyItem[] | undefined;
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const statuses = taxonomiesByKind(taxonomies, 'status');
  const auto = value === null;
  const selected = new Set(value || statuses.map((s) => s.key));

  function toggle(key: string) {
    const next = new Set(auto ? statuses.map((s) => s.key) : value || []);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(Array.from(next));
  }

  return (
    <div className="status-picker">
      <button className="btn ghost small" onClick={() => setOpen((o) => !o)} title="Colonnes de statut affichées">
        ▦ Colonnes{!auto ? ` (${selected.size})` : ''}
      </button>
      {open && (
        <>
          <div className="status-picker__backdrop" onClick={() => setOpen(false)} />
          <div className="status-picker__pop">
            <div className="status-picker__head">
              <b>Colonnes de statut</b>
              <label className="row" style={{ gap: 6, fontSize: 11.5 }}>
                <input type="checkbox" checked={auto} onChange={(e) => onChange(e.target.checked ? null : statuses.map((s) => s.key))} />
                Auto (masquer les vides)
              </label>
            </div>
            <div className="status-picker__list">
              {statuses.map((s) => (
                <label key={s.key} className={`status-picker__item${selected.has(s.key) ? ' on' : ''}`}>
                  <input type="checkbox" checked={selected.has(s.key)} disabled={auto} onChange={() => toggle(s.key)} />
                  <span className="col__dot" style={{ background: s.color }} />
                  {s.label}
                </label>
              ))}
            </div>
            <div className="status-picker__foot">
              <button className="btn small" onClick={() => onChange(statuses.map((s) => s.key))}>Tout afficher (même vides)</button>
              <button className="btn small" onClick={() => onChange(null)}>Auto</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
