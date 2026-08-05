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
import TaskModal from '../components/Task/TaskModal';
import NewTaskModal from '../components/Task/NewTaskModal';
import { EMPTY_FILTERS, type BoardView, type TaskFilters } from '../types';
import { fmtDur, hoursOf } from '../utils/format';
import { GROUP_OPTIONS, type GroupByKey } from '../components/Board/groupUtils';

const VIEWS: { value: BoardView; label: string }[] = [
  { value: 'grouped', label: 'Board' },
  { value: 'jira', label: 'Jira' },
  { value: 'list', label: 'Liste' },
];

export default function BoardPage() {
  const { projectKey } = useParams();
  const { data: project } = useProject(projectKey);
  const { data: stats } = useProjectStats(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: users } = useUsers();
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  const { data: tasks, isLoading } = useTasks(projectKey, filters);
  const [view, setView] = useState<BoardView>('grouped');
  const [groupBy, setGroupBy] = useState<GroupByKey>('sprint');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const updateTask = useUpdateTask(projectKey || '');

  if (!projectKey) return null;

  function handleDrop(taskId: string, status: string) {
    updateTask.mutate({ taskId, data: { status, note: 'Déplacée par glisser-déposer.' } });
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
        <span className="text-muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
          {project?.name} · v{project?.currentVersion}
        </span>
        <div className="header-spacer" />
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
