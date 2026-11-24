import { useEffect, useRef, useState } from 'react';
import type { Task, TaxonomyItem } from '../../types';
import { useTaskSearch } from '../../api/tasks';
import { metaOf } from '../../utils/format';
import { useDebounced } from '../../utils/useDebounced';

/**
 * Searchable task selector (key or words of the title). Used to choose a parent
 * task or to attach an existing task as a sub-task.
 */
export default function TaskPicker({
  projectKey,
  taxonomies,
  value,
  onPick,
  exclude = [],
  placeholder = 'Rechercher une tâche (clé ou titre)…',
  disabled,
  clearable = true,
  autoFocus,
}: {
  projectKey: string;
  taxonomies?: TaxonomyItem[];
  value?: { taskId: string; title?: string } | null;
  onPick: (task: Task | null) => void;
  exclude?: string[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(!!autoFocus);
  const [index, setIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const debounced = useDebounced(query, 200);
  const { data, isFetching } = useTaskSearch(projectKey, debounced, open);
  const excluded = new Set(exclude.map((k) => k.toUpperCase()));
  const results = (data || []).filter((t) => !excluded.has(t.taskId)).slice(0, 12);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => setIndex(0), [debounced]);

  function pick(task: Task | null) {
    onPick(task);
    setQuery('');
    setOpen(false);
  }

  return (
    <div className="task-picker" ref={ref}>
      {value && !open ? (
        <div className="task-picker__value">
          <button type="button" className="task-picker__current" disabled={disabled} onClick={() => setOpen(true)} title="Changer">
            <span className="mono">{value.taskId}</span> {value.title && <span className="task-picker__title">{value.title}</span>}
          </button>
          {clearable && !disabled && (
            <button type="button" className="icon-btn" title="Retirer" onClick={() => pick(null)}>
              ✕
            </button>
          )}
        </div>
      ) : (
        <input
          type="search"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (results.length) setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
            } else if (e.key === 'Enter' && results[index]) {
              e.preventDefault();
              pick(results[index]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
      )}
      {open && (
        <div className="task-picker__menu" role="listbox">
          {isFetching && !data && <div className="task-picker__empty">Recherche…</div>}
          {data && results.length === 0 && <div className="task-picker__empty">Aucune tâche trouvée.</div>}
          {results.map((t, i) => {
            const status = metaOf(taxonomies, 'status', t.status);
            return (
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                key={t.taskId}
                className={i === index ? 'on' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(t)}
              >
                <span className="mono">{t.taskId}</span>
                <span className="task-picker__title">{t.title}</span>
                <span className="col__dot" style={{ background: status.color }} title={status.label} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
