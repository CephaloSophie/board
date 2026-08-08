import { useState } from 'react';
import type { SavedView } from '../../types';

// Toolbar control to manage saved board views (localStorage): apply, save,
// save-as, clone, rename, delete. A "•" marks unsaved changes to the active view.
export default function ViewsBar({
  views,
  currentId,
  dirty,
  onApply,
  onSaveNew,
  onUpdate,
  onClone,
  onRename,
  onDelete,
  onReset,
}: {
  views: SavedView[];
  currentId: string;
  dirty: boolean;
  onApply: (id: string) => void;
  onSaveNew: (name: string) => void;
  onUpdate: () => void;
  onClone: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReset: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const current = views.find((v) => v.id === currentId) || null;

  function saveAs() {
    const name = prompt('Nom de la vue :', current ? `${current.name} (copie)` : 'Ma vue');
    if (name) onSaveNew(name);
    setMenu(false);
  }
  function clone() {
    const name = prompt('Nom de la copie :', current ? `${current.name} (copie)` : 'Copie');
    if (name) onClone(name);
    setMenu(false);
  }
  function rename() {
    if (!current) return;
    const name = prompt('Nouveau nom :', current.name);
    if (name) onRename(current.id, name);
    setMenu(false);
  }

  return (
    <div className="views-bar">
      <label className="views-bar__label">Vue</label>
      <select
        value={currentId}
        onChange={(e) => (e.target.value ? onApply(e.target.value) : onReset())}
        title="Vues enregistrées"
      >
        <option value="">— Vue courante (non enregistrée) —</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      {dirty && <span className="views-bar__dirty" title="Modifications non enregistrées">•</span>}

      <div className="views-bar__actions">
        {current && dirty && (
          <button className="btn small" onClick={onUpdate} title="Enregistrer les changements dans cette vue">
            Enregistrer
          </button>
        )}
        <button className="btn small" onClick={() => setMenu((m) => !m)}>⋯</button>
        {menu && (
          <>
            <div className="status-picker__backdrop" onClick={() => setMenu(false)} />
            <div className="views-bar__menu">
              <button onClick={saveAs}>💾 Enregistrer sous…</button>
              {current && <button onClick={clone}>⧉ Cloner cette vue</button>}
              {current && <button onClick={rename}>✎ Renommer</button>}
              {current && <button className="danger" onClick={() => { if (confirm(`Supprimer la vue "${current.name}" ?`)) onDelete(current.id); setMenu(false); }}>🗑 Supprimer</button>}
              <button onClick={() => { onReset(); setMenu(false); }}>↺ Réinitialiser (nouvelle vue)</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
