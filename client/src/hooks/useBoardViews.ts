import { useCallback, useEffect, useMemo, useState } from 'react';
import { EMPTY_FILTERS, type BoardConfig, type SavedView } from '../types';

// Saved board views live entirely in localStorage, scoped per project:
//  - board.views.<KEY>   → the list of named SavedView
//  - board.last.<KEY>    → the last-used (possibly unnamed) BoardConfig,
//                          auto-restored when the user comes back.
//  - board.current.<KEY> → id of the currently-applied saved view (or '' none)

const DEFAULT_CONFIG: BoardConfig = {
  view: 'grouped',
  groupBy: 'sprint',
  filters: EMPTY_FILTERS,
  visibleStatuses: null,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function sameConfig(a: BoardConfig, b: BoardConfig) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useBoardViews(projectKey: string | undefined) {
  const kViews = `board.views.${projectKey}`;
  const kLast = `board.last.${projectKey}`;
  const kCurrent = `board.current.${projectKey}`;

  const [views, setViews] = useState<SavedView[]>(() => read(kViews, []));
  const [currentId, setCurrentId] = useState<string>(() => read(kCurrent, ''));
  const [config, setConfig] = useState<BoardConfig>(() => read(kLast, DEFAULT_CONFIG));

  // Re-hydrate when switching project.
  useEffect(() => {
    setViews(read(kViews, []));
    setCurrentId(read(kCurrent, ''));
    setConfig(read(kLast, DEFAULT_CONFIG));
  }, [projectKey]);

  // Auto-save the last-used config on every change (restores on return).
  useEffect(() => {
    if (projectKey) write(kLast, config);
  }, [config, projectKey]);
  useEffect(() => {
    if (projectKey) write(kCurrent, currentId);
  }, [currentId, projectKey]);

  const persistViews = useCallback(
    (next: SavedView[]) => {
      setViews(next);
      write(kViews, next);
    },
    [kViews]
  );

  const currentView = useMemo(() => views.find((v) => v.id === currentId) || null, [views, currentId]);
  const dirty = useMemo(() => (currentView ? !sameConfig(currentView.config, config) : false), [currentView, config]);

  const apply = useCallback((id: string) => {
    const v = read<SavedView[]>(kViews, []).find((x) => x.id === id);
    if (v) {
      setConfig(v.config);
      setCurrentId(id);
    }
  }, [kViews]);

  const saveAsNew = useCallback(
    (name: string) => {
      const v: SavedView = { id: uid(), name: name.trim() || 'Sans nom', config };
      persistViews([...views, v]);
      setCurrentId(v.id);
      return v.id;
    },
    [config, views, persistViews]
  );

  const updateCurrent = useCallback(() => {
    if (!currentId) return;
    persistViews(views.map((v) => (v.id === currentId ? { ...v, config } : v)));
  }, [currentId, views, config, persistViews]);

  const cloneCurrent = useCallback(
    (name: string) => {
      const base = currentView ? currentView.config : config;
      const v: SavedView = { id: uid(), name: name.trim() || 'Copie', config: base };
      persistViews([...views, v]);
      setCurrentId(v.id);
    },
    [currentView, config, views, persistViews]
  );

  const rename = useCallback(
    (id: string, name: string) => persistViews(views.map((v) => (v.id === id ? { ...v, name: name.trim() || v.name } : v))),
    [views, persistViews]
  );

  const remove = useCallback(
    (id: string) => {
      persistViews(views.filter((v) => v.id !== id));
      if (currentId === id) setCurrentId('');
    },
    [views, currentId, persistViews]
  );

  const resetNew = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    setCurrentId('');
  }, []);

  // Editing the live config detaches from a saved view only if it diverges;
  // we keep currentId so "dirty" can show and updateCurrent stays available.
  const update = useCallback((patch: Partial<BoardConfig>) => setConfig((c) => ({ ...c, ...patch })), []);

  return {
    config,
    update,
    views,
    currentId,
    currentView,
    dirty,
    apply,
    saveAsNew,
    updateCurrent,
    cloneCurrent,
    rename,
    remove,
    resetNew,
  };
}
