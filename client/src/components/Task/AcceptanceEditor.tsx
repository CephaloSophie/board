import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import RichText from '../common/RichText';
import RichTextEditor from '../common/RichTextEditor';
import { useProjectPeople } from '../../hooks/useProjectPeople';
import { fmtDate } from '../../utils/format';
import { fmtRelative } from '../../utils/dates';
import { REGEX_PRESETS, looksLikeList, splitCriteria, type ParsedCriterion, type SplitMode } from '../../utils/acceptance';

/*
 * Acceptance criteria editor, shared by the creation popup (local list) and the
 * task detail (server-backed). Order = priority (drag and drop or ↑ / ↓), a
 * checked criterion is struck through, every criterion is rich text (lists,
 * links, images) and can carry a discussion (`renderComments`).
 */

export interface CriterionItem {
  id: string;
  text: string;
  done: boolean;
  doneLabel?: string | null;
  doneAt?: string | null;
  commentCount?: number;
}

type Filter = 'all' | 'open' | 'done';

// Failures are displayed by the owner through the `error` prop.
const ignore = () => undefined;

interface Props {
  projectKey: string;
  taskId?: string;
  items: CriterionItem[];
  readOnly?: boolean;
  busy?: boolean;
  error?: string | null;
  onAdd: (items: ParsedCriterion[], position: 'start' | 'end') => void | Promise<unknown>;
  onUpdate: (id: string, patch: { text?: string; done?: boolean }) => void | Promise<unknown>;
  onDelete: (id: string) => void | Promise<unknown>;
  onReorder: (ids: string[]) => void | Promise<unknown>;
  renderComments?: (item: CriterionItem) => ReactNode;
  emptyHint?: string;
}

export default function AcceptanceEditor({
  projectKey,
  taskId,
  items,
  readOnly,
  busy,
  error,
  onAdd,
  onUpdate,
  onDelete,
  onReorder,
  renderComments,
  emptyHint = "Aucun critère d'acceptation. Ajoutez-en un ou collez une liste.",
}: Props) {
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pasteSource, setPasteSource] = useState<string | null>(null);
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const done = items.filter((i) => i.done).length;
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;
  const visible = items.filter((i) => (filter === 'open' ? !i.done : filter === 'done' ? i.done : true));
  // Reordering a filtered list would be ambiguous: drag and drop only on the full list.
  const sortable = !readOnly && filter === 'all';

  function addDraft() {
    const text = draft.trim();
    if (!text) return;
    Promise.resolve(onAdd([{ text, done: false }], 'end')).then(() => setDraft(''), ignore);
  }

  function move(id: string, delta: number) {
    const from = items.findIndex((i) => i.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return;
    onReorder(arrayMove(items, from, to).map((i) => i.id));
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to).map((i) => i.id));
  }

  function toggleComments(id: string) {
    setOpenComments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rows = visible.map((item) => (
    <CriterionRow
      key={item.id}
      item={item}
      index={items.indexOf(item)}
      count={items.length}
      projectKey={projectKey}
      taskId={taskId}
      readOnly={readOnly}
      sortable={sortable}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onMove={move}
      commentsOpen={openComments.has(item.id)}
      onToggleComments={renderComments ? () => toggleComments(item.id) : undefined}
      comments={renderComments && openComments.has(item.id) ? renderComments(item) : null}
    />
  ));

  return (
    <div className={`criteria${busy ? ' busy' : ''}`}>
      <div className="criteria__head">
        {items.length > 0 && <div className="criteria__progress" title={`${done} / ${items.length} critère(s) validé(s)`}>
          <span className="criteria__count">
            <b>{done}</b>/{items.length} validé{done > 1 ? 's' : ''}
          </span>
          <span className="progress">
            <span className={`progress__bar${percent === 100 ? ' complete' : ''}`} style={{ width: `${percent}%` }} />
          </span>
        </div>}
        {items.length > 0 && (
          <div className="filter-chips criteria__filters">
            {(
              [
                ['all', 'Tous', items.length],
                ['open', 'À valider', items.length - done],
                ['done', 'Validés', done],
              ] as const
            ).map(([key, label, n]) => (
              <button type="button" key={key} className={`filter-chip${filter === key ? ' on' : ''}`} onClick={() => setFilter(key)}>
                {label} <span>{n}</span>
              </button>
            ))}
          </div>
        )}
        {!readOnly && (
          <button type="button" className="btn ghost small" onClick={() => setPasteSource('')} title="Coller un texte et le découper en critères">
            ⧉ Coller une liste
          </button>
        )}
      </div>

      {items.length === 0 && <div className="text-muted small-text criteria__empty">{emptyHint}</div>}
      {items.length > 0 && visible.length === 0 && <div className="text-muted small-text criteria__empty">Aucun critère dans ce filtre.</div>}

      {sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <ol className="criteria__list">{rows}</ol>
          </SortableContext>
        </DndContext>
      ) : (
        <ol className="criteria__list">{rows}</ol>
      )}

      {error && <div className="form-error">{error}</div>}

      {!readOnly && pasteSource === null && (
        <div className="criteria__add">
          <RichTextEditor
            value={draft}
            onChange={setDraft}
            projectKey={projectKey}
            taskId={taskId}
            rows={2}
            showHint={false}
            placeholder="Nouveau critère… (Ctrl+Entrée pour ajouter — collez une liste pour la découper en plusieurs critères)"
            onSubmit={addDraft}
            onPasteIntercept={(text) => {
              if (!looksLikeList(text)) return false;
              setPasteSource(text);
              return true;
            }}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn primary small" disabled={!draft.trim() || busy} onClick={addDraft}>
              + Ajouter le critère
            </button>
          </div>
        </div>
      )}

      {!readOnly && pasteSource !== null && (
        <PastePanel
          initial={pasteSource}
          onCancel={() => setPasteSource(null)}
          onConfirm={(parsed, position) =>
            Promise.resolve(onAdd(parsed, position)).then(() => {
              setPasteSource(null);
              setDraft('');
            }, ignore)
          }
        />
      )}
    </div>
  );
}

function CriterionRow({
  item,
  index,
  count,
  projectKey,
  taskId,
  readOnly,
  sortable,
  onUpdate,
  onDelete,
  onMove,
  commentsOpen,
  onToggleComments,
  comments,
}: {
  item: CriterionItem;
  index: number;
  count: number;
  projectKey: string;
  taskId?: string;
  readOnly?: boolean;
  sortable: boolean;
  onUpdate: Props['onUpdate'];
  onDelete: Props['onDelete'];
  onMove: (id: string, delta: number) => void;
  commentsOpen: boolean;
  onToggleComments?: () => void;
  comments: ReactNode;
}) {
  const people = useProjectPeople(projectKey);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !sortable });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);

  function save() {
    const next = text.trim();
    if (!next) return;
    if (next === item.text) {
      setEditing(false);
      return;
    }
    Promise.resolve(onUpdate(item.id, { text: next })).then(() => setEditing(false), ignore);
  }

  function remove() {
    const extra = item.commentCount ? ` et ses ${item.commentCount} commentaire(s)` : '';
    if (confirm(`Supprimer ce critère${extra} ?`)) onDelete(item.id);
  }

  return (
    <li
      ref={setNodeRef}
      id={`criterion-${item.id}`}
      className={`criterion${item.done ? ' done' : ''}${isDragging ? ' dragging' : ''}${commentsOpen ? ' open' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="criterion__main">
        {sortable ? (
          <button type="button" ref={setActivatorNodeRef} className="criterion__handle" title="Glisser pour changer la priorité" {...attributes} {...listeners}>
            ⋮⋮
          </button>
        ) : (
          <span className="criterion__handle placeholder" />
        )}
        <span className="criterion__rank" title="Priorité">
          {index + 1}
        </span>
        <input
          type="checkbox"
          className="criterion__check"
          checked={item.done}
          disabled={readOnly}
          title={item.done ? 'Rouvrir le critère' : 'Valider le critère (test passé)'}
          onChange={(e) => Promise.resolve(onUpdate(item.id, { done: e.target.checked })).catch(ignore)}
        />
        <div className="criterion__body">
          {editing ? (
            <div className="stack" style={{ gap: 6 }}>
              <RichTextEditor
                value={text}
                onChange={setText}
                projectKey={projectKey}
                taskId={taskId}
                rows={3}
                autoFocus
                showHint={false}
                onSubmit={save}
                onCancel={() => {
                  setText(item.text);
                  setEditing(false);
                }}
              />
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    setText(item.text);
                    setEditing(false);
                  }}
                >
                  Annuler
                </button>
                <button type="button" className="btn primary small" disabled={!text.trim()} onClick={save}>
                  Enregistrer
                </button>
              </div>
            </div>
          ) : (
            <div
              className="criterion__text"
              onDoubleClick={() => {
                if (readOnly) return;
                setText(item.text);
                setEditing(true);
              }}
              title={readOnly ? undefined : 'Double-cliquer pour modifier'}
            >
              <RichText text={item.text} projectKey={projectKey} mentionLabel={people.mentionLabel} />
            </div>
          )}
          {item.done && (item.doneLabel || item.doneAt) && !editing && (
            <div className="criterion__meta" title={item.doneAt ? fmtDate(item.doneAt) : undefined}>
              ✓ Validé{item.doneLabel ? ` par ${item.doneLabel}` : ''}
              {item.doneAt ? ` ${fmtRelative(item.doneAt)}` : ''}
            </div>
          )}
        </div>
        <div className="criterion__actions">
          {onToggleComments && (
            <button type="button" className={`icon-btn criterion__comments${item.commentCount ? ' has' : ''}`} onClick={onToggleComments} title="Commentaires, captures, liens">
              💬{item.commentCount ? ` ${item.commentCount}` : ''}
            </button>
          )}
          {!readOnly && !editing && (
            <>
              <button
                type="button"
                className="icon-btn"
                title="Modifier"
                onClick={() => {
                  setText(item.text);
                  setEditing(true);
                }}
              >
                ✎
              </button>
              <button type="button" className="icon-btn" title="Monter (plus prioritaire)" disabled={!sortable || index === 0} onClick={() => onMove(item.id, -1)}>
                ↑
              </button>
              <button type="button" className="icon-btn" title="Descendre" disabled={!sortable || index === count - 1} onClick={() => onMove(item.id, 1)}>
                ↓
              </button>
              <button type="button" className="icon-btn danger" title="Supprimer" onClick={remove}>
                ✕
              </button>
            </>
          )}
        </div>
      </div>
      {comments && <div className="criterion__thread">{comments}</div>}
    </li>
  );
}

const MODES: { value: SplitMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatique', hint: 'Puces, numéros, cases à cocher, scénarios Gherkin, paragraphes' },
  { value: 'lines', label: 'Une par ligne', hint: 'Chaque ligne non vide devient un critère' },
  { value: 'paragraphs', label: 'Par paragraphe', hint: 'Blocs séparés par une ligne vide' },
  { value: 'regex', label: 'Expression régulière', hint: 'Votre séparateur (ex. ; ou \\n(?=\\d+\\.))' },
];

// Paste → preview → add: the text is split live, each case can be edited or left out before adding.
function PastePanel({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: string;
  onCancel: () => void;
  onConfirm: (items: ParsedCriterion[], position: 'start' | 'end') => Promise<unknown>;
}) {
  const [source, setSource] = useState(initial);
  const [mode, setMode] = useState<SplitMode>('auto');
  const [pattern, setPattern] = useState('');
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const result = useMemo(() => splitCriteria(source, mode, pattern), [source, mode, pattern]);

  // A new split invalidates per-item edits.
  const resetEdits = () => {
    setOverrides({});
    setExcluded(new Set());
  };

  const selected = result.items
    .map((item, i) => ({ ...item, text: (overrides[i] ?? item.text).trim(), i }))
    .filter((item) => !excluded.has(item.i) && item.text);

  function confirm(position: 'start' | 'end') {
    if (!selected.length) return;
    setSaving(true);
    onConfirm(selected.map(({ text, done }) => ({ text, done })), position).finally(() => setSaving(false));
  }

  return (
    <div className="paste-panel">
      <div className="paste-panel__head">
        <b>Découper un texte en critères</b>
        <span className="text-muted small-text">Collez une liste (Word, Google Docs, Jira, e-mail…) : chaque point devient un critère.</span>
      </div>
      <div className="paste-panel__grid">
        <div className="stack" style={{ gap: 6 }}>
          <textarea
            className="paste-panel__source"
            rows={9}
            value={source}
            autoFocus={!initial}
            placeholder={'- Le bouton « Payer » est visible\n- [x] Le reçu est envoyé\n1. Les erreurs sont traduites\nScénario : …'}
            onChange={(e) => {
              setSource(e.target.value);
              resetEdits();
            }}
          />
          <div className="paste-panel__modes">
            {MODES.map((m) => (
              <label key={m.value} title={m.hint}>
                <input
                  type="radio"
                  name="split-mode"
                  checked={mode === m.value}
                  onChange={() => {
                    setMode(m.value);
                    resetEdits();
                  }}
                />{' '}
                {m.label}
              </label>
            ))}
          </div>
          {mode === 'regex' && (
            <div className="stack" style={{ gap: 4 }}>
              <input
                type="text"
                className="mono"
                value={pattern}
                placeholder="Séparateur, ex. ;|\n(?=\d+\.)"
                onChange={(e) => {
                  setPattern(e.target.value);
                  resetEdits();
                }}
                autoFocus
              />
              <div className="row wrap" style={{ gap: 4 }}>
                {REGEX_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.label}
                    className="chip"
                    title={p.pattern}
                    onClick={() => {
                      setPattern(p.pattern);
                      resetEdits();
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="paste-panel__preview">
          <div className="small-text text-muted">
            Aperçu : <b>{selected.length}</b> critère(s){result.items.length !== selected.length ? ` sur ${result.items.length}` : ''}
          </div>
          {result.error && <div className="form-error">{result.error}</div>}
          <ol>
            {result.items.map((item, i) => (
              <li key={`${i}-${item.text.slice(0, 20)}`} className={excluded.has(i) ? 'excluded' : ''}>
                <input
                  type="checkbox"
                  checked={!excluded.has(i)}
                  title="Inclure ce critère"
                  onChange={() =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                />
                {item.done && <span className="tag" title="Déjà coché dans le texte collé">✓</span>}
                <textarea rows={Math.min(4, (overrides[i] ?? item.text).split('\n').length)} value={overrides[i] ?? item.text} onChange={(e) => setOverrides((o) => ({ ...o, [i]: e.target.value }))} />
              </li>
            ))}
          </ol>
          {!result.items.length && !result.error && <div className="text-muted small-text">Rien à découper pour l'instant.</div>}
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost small" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="btn ghost small"
          disabled={!source.trim() || saving}
          title="Garder tout le texte collé dans un seul critère"
          onClick={() => {
            setSaving(true);
            onConfirm([{ text: source.trim(), done: false }], 'end').finally(() => setSaving(false));
          }}
        >
          Un seul critère
        </button>
        <button type="button" className="btn small" disabled={!selected.length || saving} onClick={() => confirm('start')}>
          Ajouter en tête
        </button>
        <button type="button" className="btn primary small" disabled={!selected.length || saving} onClick={() => confirm('end')}>
          {saving ? 'Ajout…' : `Ajouter ${selected.length} critère(s)`}
        </button>
      </div>
    </div>
  );
}
