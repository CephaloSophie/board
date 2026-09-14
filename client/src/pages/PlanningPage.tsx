import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useSprintLeftovers, useSprintMutations, useSprints } from '../api/sprints';
import { useVersions } from '../api/versions';
import { useBulkUpdateTasks, useTasks, type BulkPatch } from '../api/tasks';
import { taxonomiesByKind, useTaxonomies } from '../api/taxonomies';
import { useUpdateProject } from '../api/projects';
import { useAssignableUsers } from '../api/members';
import { errorMessage } from '../api/client';
import { useProjectRole } from '../hooks/useProjectRole';
import { useDebounced } from '../utils/useDebounced';
import { daysUntil, fmtDay } from '../utils/dates';
import { SPRINT_STATUS_META, statusCategoryResolver } from '../utils/status';
import { metaOf } from '../utils/format';
import type { LeftoverTask, SprintRow, Task, TaxonomyItem, VersionRow } from '../types';
import Avatar from '../components/common/Avatar';
import TaskModal from '../components/Task/TaskModal';
import ActivityFeed from '../components/Activity/ActivityFeed';
import { CloseSprintDialog, StartSprintDialog } from '../components/ProjectSettings/SprintsTab';

const BACKLOG = '__backlog__';
type Mode = 'sprint' | 'version';

interface PlanColumn {
  key: string;
  label: string;
  sprint?: SprintRow;
  version?: VersionRow;
}

const timeOf = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
const SPRINT_ORDER: Record<string, number> = { active: 0, ready: 1, draft: 2, finished: 3 };

/**
 * Planning cockpit: current sprint / version, leftovers of the previous sprint,
 * and a drag & drop board to move work between backlog, sprints and versions.
 * Every move goes through the bulk API and is traced in the activity log.
 */
export default function PlanningPage() {
  const { projectKey = '' } = useParams();
  const { project, isAdmin, canWrite } = useProjectRole(projectKey);
  const { data: sprintData } = useSprints(projectKey);
  const { data: versionData } = useVersions(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: users } = useAssignableUsers(projectKey);
  const sprintM = useSprintMutations(projectKey);
  const updateProject = useUpdateProject(projectKey);
  const bulk = useBulkUpdateTasks(projectKey);

  const [mode, setMode] = useState<Mode>('sprint');
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [starting, setStarting] = useState<SprintRow | null>(null);
  const [closing, setClosing] = useState<SprintRow | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dragging, setDragging] = useState<Task | null>(null);
  const [feedTab, setFeedTab] = useState<'moves' | 'lifecycle'>('moves');
  const debouncedSearch = useDebounced(search, 250);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const filters = useMemo(() => ({ search: debouncedSearch, ...(assignee ? { assignee: [assignee] } : {}) }), [debouncedSearch, assignee]);
  const { data: tasks, isLoading } = useTasks(projectKey, filters, { summary: true });
  const categoryOf = useMemo(() => statusCategoryResolver(taxonomies), [taxonomies]);

  const sprints = sprintData?.sprints || [];
  const currentSprintKey = sprintData?.currentSprint ?? project?.currentSprint ?? null;
  const currentSprint = sprints.find((s) => s.key === currentSprintKey) || null;
  const activeSprint = sprints.find((s) => s.status === 'active') || null;
  const openSprints = sprints.filter((s) => s.status !== 'finished' && !s.archived);
  const previousSprint = useMemo(
    () =>
      sprints
        .filter((s) => s.status === 'finished')
        .sort((a, b) => timeOf(b.meta?.closedAt || b.meta?.endDate) - timeOf(a.meta?.closedAt || a.meta?.endDate))[0] || null,
    [sprints]
  );
  const versions = versionData?.versions || [];
  const currentVersionKey = versionData?.currentVersion ?? project?.currentVersion;
  const currentVersion = versions.find((v) => v.key === currentVersionKey) || null;
  const openVersions = versions.filter((v) => v.status !== 'released' && !v.archived);

  const columns: PlanColumn[] = useMemo(() => {
    if (mode === 'sprint') {
      const list = sprints
        .filter((s) => !s.archived && (showClosed || s.status !== 'finished'))
        .sort((a, b) => (SPRINT_ORDER[a.status] ?? 9) - (SPRINT_ORDER[b.status] ?? 9) || a.order - b.order);
      return [{ key: BACKLOG, label: 'Backlog' }, ...list.map((s) => ({ key: s.key, label: s.label, sprint: s }))];
    }
    const list = versions.filter((v) => !v.archived && (showClosed || v.status !== 'released'));
    return [{ key: BACKLOG, label: 'Sans version' }, ...list.map((v) => ({ key: v.key, label: v.label, version: v }))];
  }, [mode, sprints, versions, showClosed]);

  const byId = useMemo(() => new Map((tasks || []).map((t) => [t.taskId, t])), [tasks]);
  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>(columns.map((c) => [c.key, []]));
    let hidden = 0;
    for (const t of tasks || []) {
      if (hideDone && categoryOf(t.status) === 'done') continue;
      const key = (mode === 'sprint' ? t.sprint : t.version) || BACKLOG;
      if (map.has(key)) map.get(key)!.push(t);
      else hidden += 1;
    }
    return { map, hidden };
  }, [tasks, columns, mode, hideDone, categoryOf]);

  const columnLabel = (key: string, field: Mode = mode) =>
    key === BACKLOG
      ? field === 'sprint'
        ? 'le backlog'
        : 'aucune version'
      : field === 'sprint'
        ? `« ${sprints.find((s) => s.key === key)?.label || key} »`
        : `la version ${key}`;

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: success });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  async function applyBulk(taskIds: string[], patch: BulkPatch, describe: (updated: number) => string) {
    if (!taskIds.length) return;
    setMessage(null);
    try {
      const r = await bulk.mutateAsync({ taskIds, patch, note: 'Planification.' });
      setSelected(new Set());
      setMessage({ ok: true, text: describe(r.updated) });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  function moveTo(taskIds: string[], columnKey: string, field: Mode = mode) {
    const value = columnKey === BACKLOG ? null : columnKey;
    const moving = taskIds.filter((id) => {
      const t = byId.get(id);
      return !t || ((field === 'sprint' ? t.sprint : t.version) ?? null) !== value;
    });
    return applyBulk(moving, { [field]: value }, (n) => `${n} tâche(s) déplacée(s) vers ${columnLabel(columnKey, field)}.`);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const task = event.active.data.current?.task as Task | undefined;
    if (!task || !event.over || !canWrite) return;
    const ids = selected.has(task.taskId) ? [...selected] : [task.taskId];
    moveTo(ids, String(event.over.id));
  }

  function toggleSelect(taskId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  const selectedPoints = [...selected].reduce((a, id) => a + (byId.get(id)?.complexity || 0), 0);

  return (
    <div className="page plan-page">
      <div className="section-head">
        <div>
          <h2>Planification</h2>
          <p className="text-muted section-intro">
            Sprint et version courants, reste à faire du sprint précédent, déplacement des tâches par glisser-déposer. Chaque action est tracée dans le{' '}
            <Link to={`/projects/${projectKey}/activity`}>journal</Link>.
          </p>
        </div>
      </div>
      {message && <div className={message.ok ? 'form-ok' : 'form-error'}>{message.text}</div>}

      <div className="plan-cards">
        <PilotCard title="Sprint courant">
          {currentSprint ? <SprintSummary sprint={currentSprint} /> : <div className="text-muted">Aucun sprint courant.</div>}
          {isAdmin && (
            <div className="plan-card__actions">
              <select
                value={currentSprintKey || ''}
                disabled={!!activeSprint || sprintM.setCurrent.isPending}
                title={activeSprint ? `« ${activeSprint.label} » est actif : il reste courant jusqu’à sa clôture.` : 'Choisir le sprint courant'}
                onChange={(e) => run(() => sprintM.setCurrent.mutateAsync(e.target.value || null), 'Sprint courant mis à jour.')}
              >
                <option value="">— Aucun sprint courant —</option>
                {openSprints.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label} ({SPRINT_STATUS_META[s.status]?.label || s.status})
                  </option>
                ))}
              </select>
              {currentSprint && !activeSprint && currentSprint.status !== 'finished' && (
                <button className="btn small primary" onClick={() => setStarting(currentSprint)}>
                  Démarrer…
                </button>
              )}
              {activeSprint && (
                <button className="btn small primary" onClick={() => setClosing(activeSprint)}>
                  Clôturer…
                </button>
              )}
            </div>
          )}
        </PilotCard>

        <PilotCard title="Version courante">
          {currentVersion ? (
            <VersionSummary version={currentVersion} />
          ) : (
            <div className="text-muted">{currentVersionKey ? `v${currentVersionKey} (non déclarée dans les versions)` : 'Aucune version courante.'}</div>
          )}
          {isAdmin && (
            <div className="plan-card__actions">
              <select
                value={currentVersion ? currentVersion.key : ''}
                disabled={updateProject.isPending}
                onChange={(e) => e.target.value && run(() => updateProject.mutateAsync({ currentVersion: e.target.value }), 'Version courante mise à jour.')}
              >
                {!currentVersion && <option value="">— Choisir —</option>}
                {versions.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.label} {v.status === 'released' ? '(publiée)' : ''}
                  </option>
                ))}
              </select>
              <Link className="btn small ghost" to={`/projects/${projectKey}/settings/sprints`}>
                Publier / gérer…
              </Link>
            </div>
          )}
        </PilotCard>

        <PilotCard title="Sprint précédent">
          {previousSprint ? <PreviousSprintSummary sprint={previousSprint} /> : <div className="text-muted">Aucun sprint clôturé.</div>}
        </PilotCard>
      </div>

      {previousSprint && (
        <LeftoversPanel
          projectKey={projectKey}
          sprint={previousSprint}
          targets={openSprints}
          currentSprintKey={currentSprintKey}
          taxonomies={taxonomies}
          canWrite={canWrite}
          busy={bulk.isPending}
          onMove={(ids, key) => moveTo(ids, key, 'sprint')}
          onOpen={setOpenTaskId}
        />
      )}

      <div className="plan-toolbar">
        <div className="view-switcher">
          <button className={mode === 'sprint' ? 'active' : ''} onClick={() => setMode('sprint')}>
            Par sprint
          </button>
          <button className={mode === 'version' ? 'active' : ''} onClick={() => setMode('version')}>
            Par version
          </button>
        </div>
        <input type="search" placeholder="Rechercher une tâche…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Tous les assignés</option>
          <option value="@none">Non assigné</option>
          {(users || []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
        <label className="board-toggles">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Masquer les terminées
        </label>
        <label className="board-toggles">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          {mode === 'sprint' ? 'Sprints terminés' : 'Versions publiées'}
        </label>
        {grouped.hidden > 0 && <span className="hint">{grouped.hidden} tâche(s) dans des colonnes masquées</span>}
      </div>

      {selected.size > 0 && canWrite && (
        <div className="plan-selection">
          <b>
            {selected.size} sélectionnée(s) · {selectedPoints} pts
          </b>
          <select value="" onChange={(e) => e.target.value && moveTo([...selected], e.target.value, 'sprint')}>
            <option value="">Déplacer vers le sprint…</option>
            <option value={BACKLOG}>Backlog (sans sprint)</option>
            {openSprints.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <select value="" onChange={(e) => e.target.value && moveTo([...selected], e.target.value, 'version')}>
            <option value="">Version…</option>
            <option value={BACKLOG}>Aucune version</option>
            {openVersions.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
          <select
            value=""
            onChange={(e) =>
              e.target.value &&
              applyBulk([...selected], { assignee: e.target.value === '@none' ? null : e.target.value }, (n) => `${n} tâche(s) réassignée(s).`)
            }
          >
            <option value="">Assigner à…</option>
            <option value="@none">Personne</option>
            {(users || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <select value="" onChange={(e) => e.target.value && applyBulk([...selected], { status: e.target.value }, (n) => `${n} statut(s) modifié(s).`)}>
            <option value="">Statut…</option>
            {taxonomiesByKind(taxonomies, 'status').map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="btn small ghost" onClick={() => setSelected(new Set())}>
            Désélectionner
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="loadbox">Chargement des tâches…</div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setDragging((e.active.data.current?.task as Task) || null)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <div className="plan-board">
            {columns.map((col) => (
              <PlanColumnView
                key={col.key}
                column={col}
                tasks={grouped.map.get(col.key) || []}
                isCurrent={mode === 'sprint' ? col.key === currentSprintKey : col.key === currentVersionKey}
                taxonomies={taxonomies}
                selected={selected}
                canWrite={canWrite}
                categoryOf={categoryOf}
                onToggle={toggleSelect}
                onSelectAll={(ids, on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
                    return next;
                  })
                }
                onOpen={setOpenTaskId}
              />
            ))}
          </div>
          <DragOverlay>
            {dragging && (
              <div className="plan-row dragging">
                <span className="mono">{dragging.taskId}</span> {dragging.title}
                {selected.has(dragging.taskId) && selected.size > 1 && <span className="count-badge">+{selected.size - 1}</span>}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      <div className="admin-panel plan-feed">
        <div className="section-head">
          <h3 style={{ margin: 0 }}>Traçabilité de la planification</h3>
          <div className="view-switcher">
            <button className={feedTab === 'moves' ? 'active' : ''} onClick={() => setFeedTab('moves')}>
              Décalages de tâches
            </button>
            <button className={feedTab === 'lifecycle' ? 'active' : ''} onClick={() => setFeedTab('lifecycle')}>
              Sprints & versions
            </button>
          </div>
          <Link className="btn small ghost" to={`/projects/${projectKey}/activity?field=sprint,version`}>
            Journal complet →
          </Link>
        </div>
        <ActivityFeed
          projectKey={projectKey}
          taxonomies={taxonomies}
          onOpenTask={setOpenTaskId}
          compact
          query={feedTab === 'moves' ? { field: ['sprint', 'version'], limit: 15 } : { scope: ['sprint', 'version'], limit: 15 }}
        />
      </div>

      {openTaskId && <TaskModal projectKey={projectKey} taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
      {starting && (
        <StartSprintDialog
          sprint={starting}
          busy={sprintM.start.isPending}
          onCancel={() => setStarting(null)}
          onConfirm={(data) =>
            run(() => sprintM.start.mutateAsync({ key: starting.key, data }).then(() => setStarting(null)), `« ${starting.label} » démarré.`)
          }
        />
      )}
      {closing && (
        <CloseSprintDialog
          projectKey={projectKey}
          sprint={closing}
          onCancel={() => setClosing(null)}
          onClosed={(text) => {
            setClosing(null);
            setMessage({ ok: true, text });
          }}
        />
      )}
    </div>
  );
}

function PilotCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="plan-card">
      <div className="plan-card__title">{title}</div>
      {children}
    </div>
  );
}

function Progress({ done, total, unit }: { done: number; total: number; unit: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <>
      <div className="small-text">
        {done}/{total} {unit} · {pct} %
      </div>
      <div className="progress">
        <span style={{ width: `${pct}%` }} />
      </div>
    </>
  );
}

function SprintSummary({ sprint }: { sprint: SprintRow }) {
  const status = SPRINT_STATUS_META[sprint.status] || SPRINT_STATUS_META.draft;
  const meta = sprint.meta || {};
  const stats = sprint.stats || { taskCount: 0, points: 0, doneCount: 0, donePoints: 0 };
  const left = sprint.status === 'active' ? daysUntil(meta.endDate) : null;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="plan-card__main">
        <span className="sprint-status" style={{ background: `${status.color}26`, color: status.color }}>
          {status.label}
        </span>
        <b>{sprint.label}</b>
      </div>
      <div className="small-text text-muted">
        {fmtDay(meta.startDate)} → {fmtDay(meta.endDate)}
        {left !== null && <span className={left < 0 ? 'late' : ''}>{left < 0 ? ` · en retard de ${-left} j` : ` · J-${left}`}</span>}
      </div>
      {meta.goal && <div className="small-text">🎯 {meta.goal}</div>}
      <Progress done={stats.donePoints} total={stats.points} unit="pts" />
      <div className="small-text text-muted">
        {stats.doneCount}/{stats.taskCount} tâche(s) terminée(s)
        {meta.startSnapshot ? ` · engagé ${meta.startSnapshot.committedPoints} pts` : ''}
      </div>
    </div>
  );
}

function VersionSummary({ version }: { version: VersionRow }) {
  const meta = version.meta || {};
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="plan-card__main">
        <span className={`tag${version.status === 'released' ? ' type' : ''}`}>{version.status === 'released' ? 'publiée' : 'en cours'}</span>
        <b>{version.label}</b>
      </div>
      <div className="small-text text-muted">
        Sortie prévue {fmtDay(meta.releaseDate)}
        {version.status === 'released' && ` · publiée le ${fmtDay(meta.releasedAt)}`}
      </div>
      <Progress done={version.stats?.doneCount || 0} total={version.stats?.taskCount || 0} unit="tâches" />
      <div className="small-text text-muted">{version.stats?.points || 0} pts au total</div>
    </div>
  );
}

function PreviousSprintSummary({ sprint }: { sprint: SprintRow }) {
  const report = sprint.meta?.report;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="plan-card__main">
        <b>{sprint.label}</b>
        <span className="small-text text-muted">clôturé le {fmtDay(sprint.meta?.closedAt || sprint.meta?.endDate)}</span>
      </div>
      {report ? (
        <>
          <Progress done={report.completedPoints} total={report.committedPoints} unit="pts livrés / engagés" />
          <div className="small-text">
            Reporté : <b>{report.carriedOverTaskIds.length}</b> tâche(s)
            {report.carriedOverPoints !== undefined && ` · ${report.carriedOverPoints} pts`}
            {report.keptTaskIds?.length ? ` · ${report.keptTaskIds.length} laissée(s) dans le sprint` : ''}
          </div>
        </>
      ) : (
        <div className="small-text text-muted">Pas de rapport de clôture (sprint importé).</div>
      )}
    </div>
  );
}

function LeftoversPanel({
  projectKey,
  sprint,
  targets,
  currentSprintKey,
  taxonomies,
  canWrite,
  busy,
  onMove,
  onOpen,
}: {
  projectKey: string;
  sprint: SprintRow;
  targets: SprintRow[];
  currentSprintKey: string | null;
  taxonomies: TaxonomyItem[] | undefined;
  canWrite: boolean;
  busy: boolean;
  onMove: (taskIds: string[], sprintKey: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const { data, isLoading } = useSprintLeftovers(projectKey, sprint.key);
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');

  const rows = useMemo(() => {
    const map = new Map<string, LeftoverTask & { origin: 'kept' | 'carried' }>();
    for (const t of data?.notDone || []) map.set(t.taskId, { ...t, origin: 'kept' });
    for (const t of data?.carriedOver || []) if (!t.done) map.set(t.taskId, { ...t, origin: 'carried' });
    return [...map.values()];
  }, [data]);
  const points = rows.reduce((a, t) => a + (t.complexity || 0), 0);
  const destination = target || currentSprintKey || targets[0]?.key || '';

  return (
    <div className="admin-panel plan-leftovers">
      <div className="section-head">
        <button className="as-button plan-leftovers__title" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'} Reste à faire de « {sprint.label} » : {rows.length} tâche(s) · {points} pts
        </button>
        {canWrite && rows.length > 0 && (
          <div className="row wrap">
            <select value={destination} onChange={(e) => setTarget(e.target.value)}>
              {targets.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label} {s.key === currentSprintKey ? '★' : ''}
                </option>
              ))}
              <option value={BACKLOG}>Backlog</option>
            </select>
            <button
              className="btn small primary"
              disabled={busy || !destination || !picked.size}
              onClick={() => {
                onMove([...picked], destination);
                setPicked(new Set());
              }}
            >
              Décaler la sélection ({picked.size})
            </button>
            <button
              className="btn small"
              disabled={busy || !destination}
              onClick={() => {
                onMove(
                  rows.map((r) => r.taskId),
                  destination
                );
                setPicked(new Set());
              }}
            >
              Tout décaler
            </button>
          </div>
        )}
      </div>
      {open &&
        (isLoading ? (
          <div className="loadbox">Analyse du sprint…</div>
        ) : rows.length === 0 ? (
          <div className="empty">Rien à reprendre : tout est terminé ou déjà replanifié.</div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  {canWrite && (
                    <th>
                      <input
                        type="checkbox"
                        checked={picked.size === rows.length}
                        onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.taskId)) : new Set())}
                      />
                    </th>
                  )}
                  <th>Tâche</th>
                  <th>Statut</th>
                  <th>Points</th>
                  <th>Assigné</th>
                  <th>Situation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const status = metaOf(taxonomies, 'status', t.status);
                  return (
                    <tr key={t.taskId}>
                      {canWrite && (
                        <td>
                          <input
                            type="checkbox"
                            checked={picked.has(t.taskId)}
                            onChange={() =>
                              setPicked((prev) => {
                                const next = new Set(prev);
                                if (next.has(t.taskId)) next.delete(t.taskId);
                                else next.add(t.taskId);
                                return next;
                              })
                            }
                          />
                        </td>
                      )}
                      <td>
                        <button className="link-btn mono" onClick={() => onOpen(t.taskId)}>
                          {t.taskId}
                        </button>{' '}
                        {t.title}
                      </td>
                      <td>
                        <span style={{ color: status.color }}>{status.label}</span>
                      </td>
                      <td>{t.complexity}</td>
                      <td>{t.assignee ? <Avatar name={t.assignee.displayName} color={t.assignee.color} size="sm" /> : '—'}</td>
                      <td className="small-text">
                        {t.origin === 'kept'
                          ? 'Restée dans le sprint clôturé'
                          : `Reportée → ${t.sprint ? metaOf(taxonomies, 'sprint', t.sprint).label : 'backlog'}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

function PlanColumnView({
  column,
  tasks,
  isCurrent,
  taxonomies,
  selected,
  canWrite,
  categoryOf,
  onToggle,
  onSelectAll,
  onOpen,
}: {
  column: PlanColumn;
  tasks: Task[];
  isCurrent: boolean;
  taxonomies: TaxonomyItem[] | undefined;
  selected: Set<string>;
  canWrite: boolean;
  categoryOf: (status: string) => string;
  onToggle: (taskId: string) => void;
  onSelectAll: (taskIds: string[], on: boolean) => void;
  onOpen: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: !canWrite });
  const points = tasks.reduce((a, t) => a + (t.complexity || 0), 0);
  const donePoints = tasks.filter((t) => categoryOf(t.status) === 'done').reduce((a, t) => a + (t.complexity || 0), 0);
  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.taskId));
  const sprintStatus = column.sprint ? SPRINT_STATUS_META[column.sprint.status] : undefined;
  const meta = column.sprint?.meta || column.version?.meta;

  return (
    <div ref={setNodeRef} className={`plan-col${isOver ? ' over' : ''}${isCurrent ? ' current' : ''}`}>
      <div className="plan-col__head">
        <div className="plan-col__title">
          {canWrite && tasks.length > 0 && (
            <input type="checkbox" checked={allSelected} title="Tout sélectionner" onChange={(e) => onSelectAll(tasks.map((t) => t.taskId), e.target.checked)} />
          )}
          <b>
            {isCurrent && '★ '}
            {column.label}
          </b>
          {sprintStatus && (
            <span className="sprint-tag" style={{ background: `${sprintStatus.color}33`, color: sprintStatus.color }}>
              {sprintStatus.label}
            </span>
          )}
          {column.version && <span className="tag">{column.version.status === 'released' ? 'publiée' : 'en cours'}</span>}
        </div>
        <div className="small-text text-muted">
          {tasks.length} tâche(s) · {points} pts{points ? ` · ${donePoints} terminés` : ''}
          {column.sprint && meta && ` · ${fmtDay((meta as SprintRow['meta']).startDate)} → ${fmtDay((meta as SprintRow['meta']).endDate)}`}
          {column.version && meta && (meta as VersionRow['meta']).releaseDate ? ` · sortie ${fmtDay((meta as VersionRow['meta']).releaseDate)}` : ''}
        </div>
        {points > 0 && (
          <div className="progress">
            <span style={{ width: `${Math.round((donePoints / points) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="plan-col__body">
        {tasks.map((t) => (
          <PlanRow
            key={t.taskId}
            task={t}
            taxonomies={taxonomies}
            selected={selected.has(t.taskId)}
            done={categoryOf(t.status) === 'done'}
            canWrite={canWrite}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))}
        {tasks.length === 0 && <div className="empty">Déposer des tâches ici</div>}
      </div>
    </div>
  );
}

function PlanRow({
  task,
  taxonomies,
  selected,
  done,
  canWrite,
  onToggle,
  onOpen,
}: {
  task: Task;
  taxonomies: TaxonomyItem[] | undefined;
  selected: boolean;
  done: boolean;
  canWrite: boolean;
  onToggle: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `plan:${task.taskId}`, data: { task }, disabled: !canWrite });
  const status = metaOf(taxonomies, 'status', task.status);
  const priority = metaOf(taxonomies, 'priority', task.priority);
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`plan-row${selected ? ' selected' : ''}${done ? ' done' : ''}${isDragging ? ' is-dragging' : ''}`}
      onClick={() => onOpen(task.taskId)}
    >
      {canWrite && (
        <input
          type="checkbox"
          checked={selected}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggle(task.taskId)}
        />
      )}
      <span className="col__dot" style={{ background: status.color }} title={status.label} />
      <span className="mono plan-row__id">{task.taskId}</span>
      <span className="plan-row__title">{task.title}</span>
      {task.priority && (
        <span className="card__pri" style={{ background: `${priority.color}22`, color: priority.color }}>
          {task.priority}
        </span>
      )}
      <span className="tag pts">{task.complexity}</span>
      {task.assignee && <Avatar name={task.assignee.displayName} color={task.assignee.color} size="sm" />}
    </div>
  );
}
