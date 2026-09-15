import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useProject, useProjectLabels, useProjectStats } from '../api/projects';
import { useTaxonomies } from '../api/taxonomies';
import { useUsers } from '../api/users';
import { useTasks, useUpdateTask, type TaskPatch } from '../api/tasks';
import { useAssignableUsers } from '../api/members';
import { useSavedFilters } from '../api/filters';
import Filters from '../components/Board/Filters';
import GroupedBoard, { type DropTarget } from '../components/Board/GroupedBoard';
import JiraBoard from '../components/Board/JiraBoard';
import ListBoard from '../components/Board/ListBoard';
import SavedFiltersBar from '../components/Board/SavedFiltersBar';
import TaskModal from '../components/Task/TaskModal';
import NewTaskModal from '../components/Task/NewTaskModal';
import type { BoardView, SavedFilter, Task } from '../types';
import { fmtDur, hoursOf } from '../utils/format';
import { GROUP_OPTIONS, UNASSIGNED, type GroupByKey } from '../components/Board/groupUtils';
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

const EMPTY_COLUMNS_KEY = 'board.showEmptyColumns';
const EMPTY_GROUPS_KEY = 'board.showEmptyGroups';

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v !== '0';
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

const readShowFilters = () => readPref(SHOW_FILTERS_KEY, true);

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
  // Every workflow status is a drop target, even without tasks; empty groups
  // (sprints, versions, members…) can be shown to drop cards into them.
  const [showEmptyColumns, setShowEmptyColumns] = useState(() => readPref(EMPTY_COLUMNS_KEY, true));
  const [showEmptyGroups, setShowEmptyGroups] = useState(() => readPref(EMPTY_GROUPS_KEY, true));
  const { data: assignable } = useAssignableUsers(projectKey);
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

  useEffect(() => writePref(SHOW_FILTERS_KEY, showFilters), [showFilters]);
  useEffect(() => writePref(EMPTY_COLUMNS_KEY, showEmptyColumns), [showEmptyColumns]);
  useEffect(() => writePref(EMPTY_GROUPS_KEY, showEmptyGroups), [showEmptyGroups]);

  if (!projectKey) return null;

  // A drop can change the status (column) and the grouped field (sprint, version, assignee…).
  function handleDrop(task: Task, target: DropTarget) {
    if (!canWrite) return;
    const data: TaskPatch = {};
    const optimistic: Partial<Task> = {};
    if (target.status && target.status !== task.status) data.status = target.status;
    const field = board.groupBy;
    if (target.groupKey !== null && field !== 'none') {
      const value = target.groupKey === UNASSIGNED ? null : target.groupKey;
      if (field === 'assignee') {
        if ((task.assignee?._id ?? null) !== value) {
          data.assignee = value;
          const member = value ? (assignable || []).find((u) => u.id === value) : null;
          optimistic.assignee = member
            ? { _id: member.id, username: member.username, displayName: member.displayName, color: member.color }
            : value
              ? (tasks || []).find((t) => t.assignee?._id === value)?.assignee ?? null
              : null;
        }
      } else if (field === 'status') {
        if (value && value !== task.status) data.status = value;
      } else if (((task as unknown as Record<string, unknown>)[field] ?? null) !== value) {
        (data as Record<string, unknown>)[field] = value;
      }
    }
    if (!Object.keys(data).length) return;
    updateTask.mutate({ taskId: task.taskId, data: { ...data, note: 'Déplacée par glisser-déposer.' }, optimistic });
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
        {board.view !== 'list' && (
          <div className="board-toggles">
            <label title="Afficher toutes les colonnes du workflow, même vides, pour y déposer des cartes">
              <input type="checkbox" checked={showEmptyColumns} onChange={(e) => setShowEmptyColumns(e.target.checked)} /> Tous les statuts
            </label>
            {board.groupBy !== 'none' && (
              <label title="Afficher aussi les groupes sans tâche (sprints à venir, versions, membres…)">
                <input type="checkbox" checked={showEmptyGroups} onChange={(e) => setShowEmptyGroups(e.target.checked)} /> Groupes vides
              </label>
            )}
          </div>
        )}
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
          showEmptyColumns={showEmptyColumns}
          showEmptyGroups={showEmptyGroups}
          users={assignable}
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
          showEmptyColumns={showEmptyColumns}
          showEmptyGroups={showEmptyGroups}
          users={assignable}
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
