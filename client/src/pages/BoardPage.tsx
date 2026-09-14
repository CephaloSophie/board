import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useProject, useProjectLabels, useProjectStats } from '../api/projects';
import { useTaxonomies } from '../api/taxonomies';
import { useUsers } from '../api/users';
import { useTasks, useUpdateTask } from '../api/tasks';
import { useSavedFilters } from '../api/filters';
import Filters from '../components/Board/Filters';
import GroupedBoard from '../components/Board/GroupedBoard';
import JiraBoard from '../components/Board/JiraBoard';
import ListBoard from '../components/Board/ListBoard';
import SavedFiltersBar from '../components/Board/SavedFiltersBar';
import TaskModal from '../components/Task/TaskModal';
import NewTaskModal from '../components/Task/NewTaskModal';
import type { BoardView, SavedFilter } from '../types';
import { fmtDur, hoursOf } from '../utils/format';
import { GROUP_OPTIONS, type GroupByKey } from '../components/Board/groupUtils';
import {
  boardStateFromParams,
  boardStateOf,
  boardStateToParams,
  countActiveFilters,
  type BoardState,
} from '../utils/boardUrlState';
import { useDebounced } from '../utils/useDebounced';
import { useProjectRole } from '../hooks/useProjectRole';

const VIEWS: { value: BoardView; label: string }[] = [
  { value: 'grouped', label: 'Board' },
  { value: 'jira', label: 'Jira' },
  { value: 'list', label: 'Liste' },
];

const SHOW_FILTERS_KEY = 'board.showFilters';

function readShowFilters(): boolean {
  try {
    return localStorage.getItem(SHOW_FILTERS_KEY) !== '0';
  } catch {
    return true;
  }
}

export default function BoardPage() {
  const { projectKey } = useParams();
  const { data: project } = useProject(projectKey);
  const { data: stats } = useProjectStats(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: users } = useUsers();
  const { data: savedFilters } = useSavedFilters(projectKey);
  const { data: labelOptions } = useProjectLabels(projectKey);

  // The URL is the single source of truth for the board configuration.
  const [searchParams, setSearchParams] = useSearchParams();
  const board = useMemo(() => boardStateFromParams(searchParams), [searchParams]);
  const activeFilterId = searchParams.get('filter');

  const debouncedSearch = useDebounced(board.filters.search, 250);
  const queryFilters = useMemo(() => ({ ...board.filters, search: debouncedSearch }), [board.filters, debouncedSearch]);
  const { data: tasks, isLoading } = useTasks(projectKey, queryFilters, { summary: true });
  const { canWrite } = useProjectRole(projectKey);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showFilters, setShowFilters] = useState(readShowFilters);
  const updateTask = useUpdateTask(projectKey || '');

  function setBoard(patch: Partial<BoardState>) {
    setSearchParams(boardStateToParams({ ...board, ...patch }, activeFilterId), { replace: true });
  }

  function applySaved(filter: SavedFilter, replace = false) {
    setSearchParams(boardStateToParams(boardStateOf(filter), filter._id), { replace });
  }

  function resetBoard() {
    setSearchParams(new URLSearchParams());
  }

  // Landing on a bare board URL opens the user's default saved filter, once per project.
  const defaultAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectKey || !savedFilters || defaultAppliedFor.current === projectKey) return;
    defaultAppliedFor.current = projectKey;
    if ([...searchParams.keys()].length > 0) return;
    const def = savedFilters.find((f) => f.isDefault);
    if (def) applySaved(def, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, savedFilters]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_FILTERS_KEY, showFilters ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [showFilters]);

  if (!projectKey) return null;

  function handleDrop(taskId: string, status: string) {
    if (!canWrite) return;
    updateTask.mutate({ taskId, data: { status, note: 'Déplacée par glisser-déposer.' } });
  }

  const totalPoints = (tasks || []).reduce((a, t) => a + (t.complexity || 0), 0);
  const totalHours = (tasks || []).reduce((a, t) => a + hoursOf(t.duration), 0);
  const activeCount = countActiveFilters(board.filters);

  return (
    <div>
      <div className="kpis">
        <div className="kpi">
          <div className="v">{stats?.total ?? '—'}</div>
          <div className="l">Tâches</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ color: 'var(--success)' }}>
            {stats?.done ?? '—'}
          </div>
          <div className="l">Terminées</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ color: 'var(--danger)' }}>
            {stats ? `${stats.openBugs} / ${stats.bugs}` : '—'}
          </div>
          <div className="l">Bugs ouverts / total</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ color: 'var(--gold)' }}>
            {stats?.totalPoints ?? '—'}
          </div>
          <div className="l">Points totaux</div>
        </div>
        <div className="kpi">
          <div className="v" style={{ color: 'var(--violet)' }}>
            {(tasks || []).length} · {totalPoints}pts
          </div>
          <div className="l">Vue filtrée · {fmtDur(totalHours)}</div>
        </div>
      </div>

      <div className="page-toolbar" style={{ paddingTop: 0 }}>
        <span className="text-muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
          {project?.name} · v{project?.currentVersion}
        </span>
        <div className="header-spacer" />
        <button className={`btn small${showFilters ? '' : ' primary'}`} onClick={() => setShowFilters((s) => !s)}>
          {showFilters ? 'Masquer les filtres' : 'Afficher les filtres'}
          {activeCount > 0 && <span className="count-badge">{activeCount}</span>}
        </button>
        <div className="ctrl" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <label style={{ marginBottom: 0 }}>Regrouper par</label>
          <select value={board.groupBy} onChange={(e) => setBoard({ groupBy: e.target.value as GroupByKey })}>
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="view-switcher">
          {VIEWS.map((v) => (
            <button key={v.value} className={board.view === v.value ? 'active' : ''} onClick={() => setBoard({ view: v.value })}>
              {v.label}
            </button>
          ))}
        </div>
        {canWrite && (
          <button className="btn primary" onClick={() => setCreating(true)}>
            + Nouvelle tâche
          </button>
        )}
      </div>

      <SavedFiltersBar
        projectKey={projectKey}
        board={board}
        activeFilterId={activeFilterId}
        onApply={(f) => applySaved(f)}
        onReset={resetBoard}
      />

      {showFilters && (
        <Filters
          taxonomies={taxonomies}
          users={users}
          labels={(labelOptions || []).map((l) => l.value)}
          filters={board.filters}
          onChange={(filters) => setBoard({ filters })}
        />
      )}

      {isLoading && <div className="loadbox">Chargement des tâches…</div>}

      {!isLoading && tasks && board.view === 'grouped' && (
        <GroupedBoard
          tasks={tasks}
          taxonomies={taxonomies}
          onOpen={setOpenTaskId}
          onDrop={handleDrop}
          groupBy={board.groupBy}
          currentSprintKey={project?.currentSprint}
        />
      )}
      {!isLoading && tasks && board.view === 'jira' && (
        <JiraBoard
          tasks={tasks}
          taxonomies={taxonomies}
          onOpen={setOpenTaskId}
          onDrop={handleDrop}
          groupBy={board.groupBy}
          currentSprintKey={project?.currentSprint}
        />
      )}
      {!isLoading && tasks && board.view === 'list' && (
        <ListBoard
          tasks={tasks}
          taxonomies={taxonomies}
          onOpen={setOpenTaskId}
          groupBy={board.groupBy}
          currentSprintKey={project?.currentSprint}
          sort={board.sort}
          onSortChange={(sort) => setBoard({ sort })}
        />
      )}

      {openTaskId && (
        <TaskModal projectKey={projectKey} taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      )}
      {creating && (
        <NewTaskModal
          projectKey={projectKey}
          taxonomies={taxonomies}
          project={project}
          defaultSprint={project?.currentSprint || null}
          defaultVersion={project?.currentVersion}
          onClose={() => setCreating(false)}
          onCreated={(taskId) => {
            setCreating(false);
            setOpenTaskId(taskId);
          }}
        />
      )}
    </div>
  );
}
