import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useProject } from '../api/projects';
import { useTaxonomies, taxonomiesByKind } from '../api/taxonomies';
import { useTasks } from '../api/tasks';
import { useTeams } from '../api/teams';
import type { SprintMeta } from '../types';
import { BarChart, Burndown } from '../components/Dashboard/charts';
import {
  velocity,
  burndown,
  workload,
  qaMetrics,
  sprintSummary,
} from '../components/Dashboard/analytics';
import Avatar from '../components/common/Avatar';

export default function DashboardPage() {
  const { projectKey } = useParams();
  const { data: project } = useProject(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: allTasks } = useTasks(projectKey, {}); // no filters → whole project
  const { data: teams } = useTeams(projectKey);

  const tasks = allTasks || [];
  const currentKey = project?.currentSprint || undefined;
  const currentSprint = useMemo(
    () => taxonomiesByKind(taxonomies, 'sprint').find((s) => s.key === currentKey),
    [taxonomies, currentKey]
  );
  const sprintTasks = useMemo(() => tasks.filter((t) => t.sprint === currentKey), [tasks, currentKey]);

  if (!projectKey) return null;

  const vel = velocity(tasks, taxonomies).filter((v) => v.total > 0).slice(-8);
  const bd = burndown(sprintTasks, currentSprint?.meta as SprintMeta | undefined, taxonomies);
  const wl = workload(sprintTasks.length ? sprintTasks : tasks, taxonomies).slice(0, 8);
  const qa = qaMetrics(tasks, taxonomies);
  const summary = sprintSummary(sprintTasks, taxonomies);

  // Velocity average (excluding the current, likely-in-progress sprint).
  const past = vel.filter((v) => v.key !== currentKey);
  const avgVelocity = past.length ? Math.round(past.reduce((a, v) => a + v.done, 0) / past.length) : 0;

  // Capacity vs committed for the current sprint.
  const teamCapacity = (teams || []).reduce((a, t) => {
    const membersCap = t.members.reduce((s, m) => s + (m.capacityPoints || 0), 0);
    return a + (t.capacityPoints || membersCap);
  }, 0);
  const committed = sprintTasks.reduce((a, t) => a + (t.complexity || 0), 0);

  const daysLeft = (() => {
    const meta = currentSprint?.meta as SprintMeta | undefined;
    if (!meta?.endDate) return null;
    return Math.ceil((new Date(meta.endDate).getTime() - Date.now()) / 86400000);
  })();

  return (
    <div>
      <div className="page-toolbar">
        <h2 className="mt-0" style={{ marginRight: 'auto' }}>
          Tableau de bord Scrum
        </h2>
        <span className="text-muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
          {project?.name} · sprint courant : {currentSprint?.label || '—'}
        </span>
      </div>

      <div className="dash">
        {/* KPI row */}
        <div className="dash-card col-3">
          <div className="dash-kpi">
            <div className="v" style={{ color: 'var(--gold)' }}>{avgVelocity}</div>
            <div className="l">Vélocité moyenne</div>
            <div className="hint">points/sprint sur {past.length} sprints</div>
          </div>
        </div>
        <div className="dash-card col-3">
          <div className="dash-kpi">
            <div className="v" style={{ color: 'var(--success)' }}>{summary.pct}%</div>
            <div className="l">Avancement sprint</div>
            <div className="hint">{summary.done}/{summary.total} pts · {daysLeft != null ? `${daysLeft} j restants` : 'sans échéance'}</div>
          </div>
        </div>
        <div className="dash-card col-3">
          <div className="dash-kpi">
            <div className="v" style={{ color: committed > teamCapacity && teamCapacity ? 'var(--danger)' : 'var(--info)' }}>
              {committed}<span style={{ fontSize: 16, color: 'var(--mute)' }}> / {teamCapacity || '—'}</span>
            </div>
            <div className="l">Engagé / Capacité</div>
            <div className="hint">
              {teamCapacity ? (committed > teamCapacity ? 'sur-engagement' : `${teamCapacity - committed} pts de marge`) : 'définir la capacité équipe'}
            </div>
          </div>
        </div>
        <div className="dash-card col-3">
          <div className="dash-kpi">
            <div className="v" style={{ color: qa.bugsOpen ? 'var(--danger)' : 'var(--success)' }}>{qa.bugsOpen}</div>
            <div className="l">Bugs ouverts</div>
            <div className="hint">{qa.inQa} en QA · {qa.defectRatio}% de défauts</div>
          </div>
        </div>

        {/* Burndown */}
        <div className="dash-card col-6">
          <h3>Burndown — {currentSprint?.label || 'sprint courant'}</h3>
          <div className="sub">Points restants réels vs trajectoire idéale (calculé depuis l'historique des tâches).</div>
          {bd ? <Burndown points={bd.points} /> : <div className="empty">Aucun sprint courant daté.</div>}
        </div>

        {/* Velocity */}
        <div className="dash-card col-6">
          <h3>Vélocité par sprint</h3>
          <div className="sub">Points terminés (barre pleine) vs engagés (fond) sur les derniers sprints.</div>
          <BarChart data={vel.map((v) => ({ label: v.label, value: v.done, sub: v.total, color: v.color }))} />
        </div>

        {/* Workload */}
        <div className="dash-card col-8">
          <h3>Charge par personne</h3>
          <div className="sub">Répartition des points {sprintTasks.length ? 'du sprint courant' : 'du projet'} par état.</div>
          {wl.map((r) => (
            <div className="wl-row" key={r.name}>
              <span className="wl-name">
                <Avatar name={r.name} color={r.color} size="sm" />
                {r.name}
              </span>
              <span className="wl-bar">
                {r.todo > 0 && <span className="wl-seg" style={{ width: `${(r.todo / r.total) * 100}%`, background: '#9db4dd' }} />}
                {r.doing > 0 && <span className="wl-seg" style={{ width: `${(r.doing / r.total) * 100}%`, background: 'var(--gold)' }} />}
                {r.done > 0 && <span className="wl-seg" style={{ width: `${(r.done / r.total) * 100}%`, background: 'var(--success)' }} />}
              </span>
              <span className="wl-total">{r.total} pts</span>
            </div>
          ))}
          {wl.length === 0 && <div className="empty">Aucune charge à afficher.</div>}
          <div className="legend">
            <span><i style={{ background: '#9db4dd' }} /> À faire</span>
            <span><i style={{ background: 'var(--gold)' }} /> En cours</span>
            <span><i style={{ background: 'var(--success)' }} /> Terminé</span>
          </div>
        </div>

        {/* Role-oriented cards */}
        <div className="dash-card col-4">
          <h3>Par rôle</h3>
          <div className="sub">Indicateurs clés pour chaque casquette.</div>
          <div className="role-cards">
            <div className="role-card" style={{ borderLeftColor: 'var(--gold)' }}>
              <div className="role-card__role">Product Owner</div>
              <div className="role-card__line"><span>Backlog estimé</span><b>{summary.estimated}/{summary.count}</b></div>
              <div className="role-card__line"><span>Points engagés</span><b>{committed}</b></div>
            </div>
            <div className="role-card" style={{ borderLeftColor: 'var(--info)' }}>
              <div className="role-card__role">Scrum Master</div>
              <div className="role-card__line"><span>Avancement</span><b>{summary.pct}%</b></div>
              <div className="role-card__line"><span>Bloquants (P0)</span><b style={{ color: summary.blockers ? 'var(--danger)' : undefined }}>{summary.blockers}</b></div>
            </div>
            <div className="role-card" style={{ borderLeftColor: 'var(--violet)' }}>
              <div className="role-card__role">Chef d'équipe</div>
              <div className="role-card__line"><span>Sans assigné</span><b style={{ color: summary.unassigned ? 'var(--danger)' : undefined }}>{summary.unassigned}</b></div>
              <div className="role-card__line"><span>Capacité restante</span><b>{teamCapacity ? teamCapacity - committed : '—'}</b></div>
            </div>
            <div className="role-card" style={{ borderLeftColor: 'var(--danger)' }}>
              <div className="role-card__role">QA</div>
              <div className="role-card__line"><span>Bugs ouverts</span><b>{qa.bugsOpen}</b></div>
              <div className="role-card__line"><span>En QA</span><b>{qa.inQa}</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
