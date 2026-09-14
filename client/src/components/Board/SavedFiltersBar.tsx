import { useEffect, useRef, useState } from 'react';
import type { SavedFilter, SavedFilterVisibility } from '../../types';
import {
  useCreateSavedFilter,
  useDefaultSavedFilter,
  useDeleteSavedFilter,
  useSavedFilters,
  useStarSavedFilter,
  useUpdateSavedFilter,
} from '../../api/filters';
import { useAuth } from '../../context/AuthContext';
import { boardStateOf, countActiveFilters, isSameBoardState, type BoardState } from '../../utils/boardUrlState';
import { GROUP_OPTIONS } from './groupUtils';
import Avatar from '../common/Avatar';

const VIEW_LABELS: Record<string, string> = { grouped: 'Board', jira: 'Jira', list: 'Liste' };

function summary(f: SavedFilter): string {
  const state = boardStateOf(f);
  const n = countActiveFilters(state.filters);
  const group = GROUP_OPTIONS.find((o) => o.value === state.groupBy)?.label || state.groupBy;
  return `${n} critère${n > 1 ? 's' : ''} · ${VIEW_LABELS[state.view]} · ${group}`;
}

/**
 * Saved-filter toolbar above the board: pick / star / set default / share
 * named filters, save the current board configuration, copy a link to it.
 */
export default function SavedFiltersBar({
  projectKey,
  board,
  activeFilterId,
  onApply,
  onReset,
}: {
  projectKey: string;
  board: BoardState;
  activeFilterId: string | null;
  onApply: (filter: SavedFilter) => void;
  onReset: () => void;
}) {
  const { user } = useAuth();
  const { data: filters } = useSavedFilters(projectKey);
  const update = useUpdateSavedFilter(projectKey);
  const remove = useDeleteSavedFilter(projectKey);
  const star = useStarSavedFilter(projectKey);
  const setDefault = useDefaultSavedFilter(projectKey);
  const [open, setOpen] = useState(false);
  const [editor, setEditor] = useState<{ mode: 'create' } | { mode: 'edit'; filter: SavedFilter } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2200);
  }

  const list = filters || [];
  const active = list.find((f) => f._id === activeFilterId) || null;
  const dirty = active ? !isSameBoardState(board, boardStateOf(active)) : false;
  const starred = list.filter((f) => f.isStarred);
  const mine = list.filter((f) => f.isOwner);
  const shared = list.filter((f) => !f.isOwner);
  const canManage = (f: SavedFilter) => f.isOwner || user?.role === 'superadmin';
  const hasCriteria = countActiveFilters(board.filters) > 0;

  async function saveActive() {
    if (!active) return;
    await update.mutateAsync({
      id: active._id,
      data: { filters: board.filters, view: board.view, groupBy: board.groupBy, sort: board.sort },
    });
    flash('Filtre mis à jour.');
  }

  async function copyLink() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      flash('Lien copié dans le presse-papiers.');
    } catch {
      window.prompt('Copiez ce lien :', url);
    }
  }

  async function handleDelete(f: SavedFilter) {
    if (!confirm(`Supprimer le filtre « ${f.name} » ?`)) return;
    await remove.mutateAsync(f._id);
    if (f._id === activeFilterId) onReset();
  }

  function renderRow(f: SavedFilter) {
    return (
      <div key={f._id} className={`saved-row${f._id === activeFilterId ? ' active' : ''}`}>
        <button
          className={`icon-btn${f.isStarred ? ' on' : ''}`}
          title={f.isStarred ? 'Retirer des favoris' : 'Ajouter aux favoris (raccourci dans la barre)'}
          onClick={() => star.mutate({ id: f._id, starred: !f.isStarred })}
        >
          {f.isStarred ? '★' : '☆'}
        </button>
        <div
          className="saved-row__main"
          onClick={() => {
            onApply(f);
            setOpen(false);
          }}
        >
          <div className="saved-row__name">
            {f.name}
            {f.visibility === 'shared' && <span className="tag">partagé</span>}
            {f.isDefault && <span className="tag pts">par défaut</span>}
          </div>
          <div className="saved-row__meta">
            {!f.isOwner && <Avatar name={f.owner.displayName} color={f.owner.color} size="sm" />}
            {summary(f)}
            {f.description ? ` — ${f.description}` : ''}
          </div>
        </div>
        <button
          className={`icon-btn${f.isDefault ? ' on' : ''}`}
          title={f.isDefault ? 'Ne plus ouvrir par défaut' : 'Ouvrir ce filtre par défaut sur ce projet'}
          onClick={() => setDefault.mutate({ id: f._id, isDefault: !f.isDefault })}
        >
          ⌂
        </button>
        {canManage(f) && (
          <>
            <button className="icon-btn" title="Renommer / partager" onClick={() => setEditor({ mode: 'edit', filter: f })}>
              ✎
            </button>
            <button className="icon-btn" title="Supprimer" onClick={() => handleDelete(f)}>
              🗑
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="saved-filters">
      <div className="saved-filters__menu" ref={menuRef}>
        <button className={`btn small${open ? ' primary' : ''}`} onClick={() => setOpen((o) => !o)}>
          ☰ Filtres enregistrés{list.length ? ` (${list.length})` : ''} ▾
        </button>
        {open && (
          <div className="saved-filters__panel">
            <div className="saved-filters__section">Mes filtres</div>
            {mine.map(renderRow)}
            {mine.length === 0 && <div className="empty">Aucun filtre. Composez une vue puis « Enregistrer sous… ».</div>}
            <div className="saved-filters__section">Partagés par l'équipe</div>
            {shared.map(renderRow)}
            {shared.length === 0 && <div className="empty">Aucun filtre partagé.</div>}
          </div>
        )}
      </div>

      {starred.map((f) => (
        <button
          key={f._id}
          className={`saved-chip${f._id === activeFilterId ? ' active' : ''}`}
          onClick={() => onApply(f)}
          title={summary(f)}
        >
          ★ {f.name}
        </button>
      ))}

      <div className="header-spacer" />

      {active && (
        <span className="saved-filters__active">
          Filtre : <b>{active.name}</b>
          {dirty && <span className="badge-dirty">modifié</span>}
        </span>
      )}
      {active && dirty && canManage(active) && (
        <button className="btn small primary" onClick={saveActive} disabled={update.isPending}>
          Enregistrer
        </button>
      )}
      {active && dirty && (
        <button className="btn small ghost" onClick={() => onApply(active)}>
          Annuler les modifications
        </button>
      )}
      <button className="btn small" onClick={() => setEditor({ mode: 'create' })}>
        Enregistrer sous…
      </button>
      <button className="btn small ghost" onClick={copyLink} title="Copier un lien vers cette vue exacte">
        🔗 Lien
      </button>
      {(hasCriteria || active) && (
        <button className="btn small ghost" onClick={onReset}>
          Réinitialiser
        </button>
      )}
      {notice && <span className="saved-filters__notice">{notice}</span>}

      {editor && (
        <SavedFilterModal
          projectKey={projectKey}
          board={board}
          filter={editor.mode === 'edit' ? editor.filter : null}
          onClose={() => setEditor(null)}
          onSaved={(f, created) => {
            setEditor(null);
            if (created) onApply(f);
            flash(created ? `Filtre « ${f.name} » enregistré.` : 'Filtre modifié.');
          }}
        />
      )}
    </div>
  );
}

function SavedFilterModal({
  projectKey,
  board,
  filter,
  onClose,
  onSaved,
}: {
  projectKey: string;
  board: BoardState;
  filter: SavedFilter | null;
  onClose: () => void;
  onSaved: (filter: SavedFilter, created: boolean) => void;
}) {
  const create = useCreateSavedFilter(projectKey);
  const update = useUpdateSavedFilter(projectKey);
  const [name, setName] = useState(filter?.name || '');
  const [description, setDescription] = useState(filter?.description || '');
  const [visibility, setVisibility] = useState<SavedFilterVisibility>(filter?.visibility || 'private');
  const [isDefault, setIsDefault] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  async function submit() {
    if (!name.trim()) {
      setErr('Le nom est requis.');
      return;
    }
    setErr(null);
    try {
      if (filter) {
        const { filter: saved } = await update.mutateAsync({
          id: filter._id,
          data: { name: name.trim(), description, visibility },
        });
        onSaved(saved as SavedFilter, false);
      } else {
        const { filter: saved } = await create.mutateAsync({
          name: name.trim(),
          description,
          visibility,
          isDefault,
          filters: board.filters,
          view: board.view,
          groupBy: board.groupBy,
          sort: board.sort,
        });
        onSaved(saved as SavedFilter, true);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Enregistrement impossible.');
    }
  }

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h3>{filter ? 'Modifier le filtre' : 'Enregistrer la vue actuelle'}</h3>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>
        {!filter && (
          <p className="text-muted" style={{ fontSize: 12 }}>
            Les critères, la vue ({VIEW_LABELS[board.view]}), le regroupement et le tri actuels seront mémorisés.
          </p>
        )}
        <div className="stack">
          <div className="field">
            <label>Nom</label>
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Mes tâches du sprint"
            />
          </div>
          <div className="field">
            <label>Description (optionnelle)</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label>Visibilité</label>
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as SavedFilterVisibility)}>
              <option value="private">Privé — visible par moi uniquement</option>
              <option value="shared">Partagé — visible par toute l'équipe du projet</option>
            </select>
          </div>
          {!filter && (
            <label className="row" style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Ouvrir ce filtre par défaut quand j'arrive sur le board
            </label>
          )}
          {err && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{err}</div>}
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
