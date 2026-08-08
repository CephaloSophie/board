import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useProject, useProjectStats } from '../api/projects';
import { useTaxonomies } from '../api/taxonomies';
import { useUsers } from '../api/users';
import { useTasks, useUpdateTask } from '../api/tasks';
import Filters from '../components/Board/Filters';
import GroupedBoard from '../components/Board/GroupedBoard';
import JiraBoard from '../components/Board/JiraBoard';
import ListBoard from '../components/Board/ListBoard';
import PlanningBoard from '../components/Board/PlanningBoard';
import CurrentSprintHero from '../components/Board/CurrentSprintHero';
import StatusPicker from '../components/Board/StatusPicker';
import ViewsBar from '../components/Board/ViewsBar';
import TaskModal from '../components/Task/TaskModal';
import NewTaskModal from '../components/Task/NewTaskModal';
import { type BoardView } from '../types';
import { fmtDur, hoursOf } from '../utils/format';
import { GROUP_OPTIONS, type GroupByKey } from '../components/Board/groupUtils';
import { useBoardViews } from '../hooks/useBoardViews';

const VIEWS: { value: BoardView; label: string }[] = [
  { value: 'grouped', label: 'Board' },
  { value: 'jira', label: 'Jira' },
  { value: 'planning', label: 'Planning' },
  { value: 'list', label: 'Liste' },
];

export default function BoardPage() {
  const { projectKey } = useParams();
  const { data: project } = useProject(projectKey);
  const { data: stats } = useProjectStats(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: users } = useUsers();
  const boardViews = useBoardViews(projectKey);
  const { config, update } = boardViews;
  const { filters, view, visibleStatuses } = config;
  const groupBy = config.groupBy as GroupByKey;
  const setFilters = (f: typeof filters) => update({ filters: f });
  const setView = (v: BoardView) => update({ view: v });
  const setGroupBy = (g: GroupByKey) => update({ groupBy: g });
  const { data: tasks, isLoading } = useTasks(projectKey, filters);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const updateTask = useUpdateTask(projectKey || '');

  if (!projectKey) return null;

  function handleDrop(taskId: string, status: string) {
    updateTask.mutate({ taskId, data: { status, note: 'Déplacée par glisser-déposer.' } });
  }

  function handleReassign(taskId: string, field: string, value: string | null) {
    updateTask.mutate({ taskId, data: { [field]: value, note: 'Replanifiée par glisser-déposer.' } as any });
  }

  const totalPoints = (tasks || []).reduce((a, t) => a + (t.complexity || 0), 0);
  const totalHours = (tasks || []).reduce((a, t) => a + hoursOf(t.duration), 0);

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
            {stats?.bugs ?? '—'}
          </div>
          <div className="l">Bugs</div>
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
        <ViewsBar
          views={boardViews.views}
          currentId={boardViews.currentId}
          dirty={boardViews.dirty}
          onApply={boardViews.apply}
          onSaveNew={boardViews.saveAsNew}
          onUpdate={boardViews.updateCurrent}
          onClone={boardViews.cloneCurrent}
          onRename={boardViews.rename}
          onDelete={boardViews.remove}
          onReset={boardViews.resetNew}
        />
        <div className="header-spacer" />
        {(view === 'grouped' || view === 'jira') && (
          <StatusPicker taxonomies={taxonomies} value={visibleStatuses} onChange={(v) => update({ visibleStatuses: v })} />
        )}
        <div className="ctrl" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <label style={{ marginBottom: 0 }}>Regrouper par</label>
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupByKey)}>
            {GROUP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="view-switcher">
          {VIEWS.map((v) => (
            <button key={v.value} className={view === v.value ? 'active' : ''} onClick={() => setView(v.value)}>
              {v.label}
            </button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>
          + Nouvelle tâche
        </button>
      </div>

      <CurrentSprintHero projectKey={projectKey} project={project} taxonomies={taxonomies} />

      <Filters taxonomies={taxonomies} users={users} filters={filters} onChange={setFilters} />

      {isLoading && <div className="loadbox">Chargement des tâches…</div>}

      {!isLoading && tasks && view === 'grouped' && (
        <GroupedBoard
          tasks={tasks}
          taxonomies={taxonomies}
          onOpen={setOpenTaskId}
          onDrop={handleDrop}
          groupBy={groupBy}
          currentSprintKey={project?.currentSprint}
          visibleStatuses={visibleStatuses}
        />
      )}
      {!isLoading && tasks && view === 'jira' && (
        <JiraBoard
          tasks={tasks}
          taxonomies={taxonomies}
          onOpen={setOpenTaskId}
          onDrop={handleDrop}
          groupBy={groupBy}
          currentSprintKey={project?.currentSprint}
          visibleStatuses={visibleStatuses}
        />
      )}
      {!isLoading && tasks && view === 'planning' && (
        <PlanningBoard
          tasks={tasks}
          taxonomies={taxonomies}
          groupBy={groupBy}
          currentSprintKey={project?.currentSprint}
          onOpen={setOpenTaskId}
          onReassign={handleReassign}
        />
      )}
      {!isLoading && tasks && view === 'list' && (
        <ListBoard
          tasks={tasks}
          taxonomies={taxonomies}
          onOpen={setOpenTaskId}
          groupBy={groupBy}
          currentSprintKey={project?.currentSprint}
        />
      )}

      {openTaskId && (
        <TaskModal projectKey={projectKey} taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      )}
      {creating && (
        <NewTaskModal
          projectKey={projectKey}
          taxonomies={taxonomies}
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
