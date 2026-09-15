import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../api/client';
import { useDashboard, useDashboardMutations, useDashboards, type Dashboard, type Widget, type WidgetLayout, type WidgetType } from '../api/dashboards';
import { useProjectLabels } from '../api/projects';
import { useTaxonomies } from '../api/taxonomies';
import { useUsers } from '../api/users';
import Filters from '../components/Board/Filters';
import TaskModal from '../components/Task/TaskModal';
import { WidgetBody } from '../components/Dashboard/Widgets';
import WidgetConfigModal from '../components/Dashboard/WidgetConfigModal';
import { bottomOf, compact, GRID_COLUMNS, GRID_GAP, resolveCollisions, ROW_HEIGHT } from '../components/Dashboard/layout';
import { TEMPLATE_META, WIDGETS } from '../components/Dashboard/registry';
import { boardStateToParams, countActiveFilters, DEFAULT_BOARD_STATE, normalizeFilters } from '../utils/boardUrlState';
import type { TaskFilters } from '../types';

interface Draft {
  name: string;
  visibility: 'private' | 'shared';
  globalFilters: Partial<TaskFilters>;
  widgets: Widget[];
}

const draftOf = (d: Dashboard): Draft => ({
  name: d.name,
  visibility: d.visibility,
  globalFilters: d.globalFilters || {},
  widgets: JSON.parse(JSON.stringify(d.widgets)),
});

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `w-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function DashboardPage() {
  const { projectKey, dashboardId } = useParams();
  const navigate = useNavigate();
  const { data: list, isLoading: listLoading } = useDashboards(projectKey);
  const { data: dashboard, error: loadError } = useDashboard(projectKey, dashboardId);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: users } = useUsers();
  const { data: labels } = useProjectLabels(projectKey);
  const m = useDashboardMutations(projectKey || '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [configuring, setConfiguring] = useState<Widget | null>(null);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const editing = !!draft;

  // Bare /dashboards → the user's default, else a starred one, else the first.
  useEffect(() => {
    if (!projectKey || dashboardId || !list?.dashboards.length) return;
    const target = list.dashboards.find((d) => d.isDefault) || list.dashboards.find((d) => d.isStarred) || list.dashboards[0];
    navigate(`/projects/${projectKey}/dashboards/${target._id}`, { replace: true });
  }, [projectKey, dashboardId, list]);

  useEffect(() => {
    setDraft(null);
    setConflict(null);
  }, [dashboardId]);

  useEffect(() => {
    if (!editing) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing]);

  if (!projectKey) return null;
  const view: Draft | null = draft || (dashboard ? draftOf(dashboard) : null);

  async function save() {
    if (!dashboard || !draft) return;
    setError(null);
    try {
      await m.update.mutateAsync({ id: dashboard._id, data: { revision: dashboard.revision, ...draft } });
      setDraft(null);
      setConflict(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') {
        const current = e.body?.current as { updatedBy?: string; updatedAt?: string } | undefined;
        setConflict(`Ce dashboard a été modifié par ${current?.updatedBy || 'quelqu’un'} pendant votre édition.`);
      } else setError(errorMessage(e));
    }
  }

  async function saveAsCopy() {
    if (!draft) return;
    try {
      const { dashboard: copy } = await m.create.mutateAsync({ ...draft, name: `${draft.name} (copie ${new Date().toLocaleTimeString('fr-FR')})`, visibility: 'private' });
      setDraft(null);
      setConflict(null);
      navigate(`/projects/${projectKey}/dashboards/${copy._id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function addWidget(type: WidgetType) {
    if (!draft) return;
    const meta = WIDGETS[type];
    const widget: Widget = {
      id: uid(),
      type,
      title: '',
      layout: { x: 0, y: bottomOf(draft.widgets), w: meta.size[0], h: meta.size[1] },
      source: { mode: meta.usesTasks ? 'global' : 'none', filterId: null, filters: {} },
      config: { ...meta.defaultConfig },
    };
    setDraft({ ...draft, widgets: [...draft.widgets, widget] });
    setCatalog(false);
    setConfiguring(widget);
  }

  const boardLinkFor = (w: Widget) => {
    if (!WIDGETS[w.type].usesTasks || !view) return null;
    if (w.source.mode === 'filter' && w.source.filterId) return `/projects/${projectKey}/board?filter=${w.source.filterId}`;
    const merged = { ...normalizeFilters(view.globalFilters) };
    const inline = w.source.mode === 'inline' ? normalizeFilters(w.source.filters) : null;
    if (inline) for (const [k, v] of Object.entries(inline)) if (Array.isArray(v) ? v.length : v) Object.assign(merged, { [k]: v });
    return `/projects/${projectKey}/board?${boardStateToParams({ ...DEFAULT_BOARD_STATE, view: 'list', groupBy: 'none', filters: merged })}`;
  };

  const globalCount = view ? countActiveFilters(normalizeFilters(view.globalFilters)) : 0;

  return (
    <div className="dashboard-page">
      <div className="page-toolbar dashboard-toolbar">
        {list && list.dashboards.length > 0 && (
          <select
            value={dashboardId || ''}
            disabled={editing}
            onChange={(e) => navigate(`/projects/${projectKey}/dashboards/${e.target.value}`)}
            className="dashboard-select"
          >
            {list.dashboards.map((d) => (
              <option key={d._id} value={d._id}>
                {d.isStarred ? '★ ' : ''}
                {d.name}
                {d.visibility === 'shared' && !d.isOwner ? ` — ${d.owner.displayName}` : ''}
              </option>
            ))}
          </select>
        )}
        {dashboard && !editing && (
          <>
            <button className={`icon-btn${dashboard.isStarred ? ' on' : ''}`} title="Favori" onClick={() => m.star.mutate({ id: dashboard._id, starred: !dashboard.isStarred })}>
              {dashboard.isStarred ? '★' : '☆'}
            </button>
            <button
              className={`btn small ghost${dashboard.isDefault ? ' active-link' : ''}`}
              title="Ouvrir ce dashboard par défaut"
              onClick={() => m.setDefault.mutate({ id: dashboard._id, isDefault: !dashboard.isDefault })}
            >
              ⌂ {dashboard.isDefault ? 'Par défaut' : 'Définir par défaut'}
            </button>
            {dashboard.visibility === 'shared' && <span className="tag">partagé</span>}
          </>
        )}
        {editing && draft && (
          <input type="text" className="dashboard-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        )}
        <div className="header-spacer" />
        {view && (
          <button className={`btn small${globalCount ? ' primary' : ''}`} onClick={() => setGlobalOpen(true)} disabled={!editing && !globalCount}>
            Filtre global{globalCount ? ` (${globalCount})` : ''}
          </button>
        )}
        {!editing ? (
          <>
            {dashboard?.canEdit && (
              <button className="btn small primary" onClick={() => setDraft(draftOf(dashboard))}>
                ✎ Modifier
              </button>
            )}
            {dashboard && (
              <button
                className="btn small ghost"
                onClick={async () => {
                  const { dashboard: copy } = await m.duplicate.mutateAsync({ id: dashboard._id });
                  navigate(`/projects/${projectKey}/dashboards/${copy._id}`);
                }}
              >
                Dupliquer
              </button>
            )}
            <button className="btn small" onClick={() => setCreating(true)}>
              + Nouveau dashboard
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => setCatalog(true)}>
              + Ajouter un widget
            </button>
            <select value={draft!.visibility} onChange={(e) => setDraft({ ...draft!, visibility: e.target.value as Draft['visibility'] })}>
              <option value="private">Privé</option>
              <option value="shared">Partagé avec le projet</option>
            </select>
            {dashboard?.isOwner && (
              <button
                className="btn small danger"
                onClick={async () => {
                  if (!confirm(`Supprimer le dashboard « ${dashboard.name} » ?`)) return;
                  await m.remove.mutateAsync(dashboard._id);
                  navigate(`/projects/${projectKey}/dashboards`);
                }}
              >
                Supprimer
              </button>
            )}
            <button className="btn small ghost" onClick={() => setDraft(null)}>
              Annuler
            </button>
            <button className="btn small primary" disabled={m.update.isPending || !draft!.name.trim()} onClick={save}>
              Enregistrer
            </button>
          </>
        )}
      </div>

      {conflict && (
        <div className="notice conflict">
          {conflict}{' '}
          <button className="btn small" onClick={() => setDraft(null)}>
            Recharger et perdre mes changements
          </button>{' '}
          <button className="btn small primary" onClick={saveAsCopy}>
            Enregistrer comme copie
          </button>
        </div>
      )}
      {error && <div className="form-error" style={{ margin: '0 22px' }}>{error}</div>}
      {editing && <div className="notice edit-hint">Mode édition : glissez un widget par son en-tête, redimensionnez-le par le coin ◢, ⚙ pour le configurer.</div>}

      {!listLoading && list && list.dashboards.length === 0 && (
        <div className="dashboard-empty">
          <h2>Composez votre premier dashboard</h2>
          <p className="text-muted">Choisissez un modèle : il reste entièrement modifiable (widgets, tailles, filtres, partage).</p>
          <TemplatePicker projectKey={projectKey} onCreated={(id) => navigate(`/projects/${projectKey}/dashboards/${id}`)} />
        </div>
      )}
      {loadError && <div className="loadbox">Dashboard introuvable ou non partagé. <Link to={`/projects/${projectKey}/dashboards`}>Revenir</Link></div>}

      {view && (
        <DashboardGrid
          widgets={view.widgets}
          editing={editing}
          onChange={(widgets) => draft && setDraft({ ...draft, widgets })}
          renderWidget={(w, handlers) => (
            <div className="widget">
              <div className="widget__head" onPointerDown={editing ? handlers.onMove : undefined}>
                <span className="widget__title">
                  {editing && <span className="drag-grip">⠿</span>}
                  {w.title || WIDGETS[w.type].label}
                </span>
                <div className="widget__actions" onPointerDown={(e) => e.stopPropagation()}>
                  {!editing && boardLinkFor(w) && (
                    <Link className="icon-btn" to={boardLinkFor(w)!} title="Ouvrir ces tâches dans le board">
                      ↗
                    </Link>
                  )}
                  {editing && (
                    <>
                      <button className="icon-btn" title="Configurer" onClick={() => setConfiguring(w)}>
                        ⚙
                      </button>
                      <button className="icon-btn" title="Retirer" onClick={() => setDraft({ ...draft!, widgets: compact(draft!.widgets.filter((x) => x.id !== w.id)) })}>
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="widget__body">
                <WidgetBody projectKey={projectKey} widget={w} globalFilters={view.globalFilters} taxonomies={taxonomies} onOpenTask={setOpenTaskId} />
              </div>
              {editing && <div className="widget__resize" onPointerDown={handlers.onResize} title="Redimensionner" />}
            </div>
          )}
        />
      )}
      {view && view.widgets.length === 0 && (
        <div className="dashboard-empty">
          <p className="text-muted">Ce dashboard est vide.</p>
          {editing ? (
            <button className="btn primary" onClick={() => setCatalog(true)}>
              + Ajouter un widget
            </button>
          ) : (
            dashboard?.canEdit && (
              <button className="btn primary" onClick={() => setDraft(draftOf(dashboard))}>
                ✎ Modifier
              </button>
            )
          )}
        </div>
      )}

      {creating && (
        <div className="backdrop" onClick={(e) => e.target === e.currentTarget && setCreating(false)}>
          <div className="modal wide">
            <div className="modal-head">
              <h3>Nouveau dashboard</h3>
              <button className="close-btn" onClick={() => setCreating(false)}>
                Fermer ✕
              </button>
            </div>
            <TemplatePicker
              projectKey={projectKey}
              onCreated={(id) => {
                setCreating(false);
                navigate(`/projects/${projectKey}/dashboards/${id}`);
              }}
            />
          </div>
        </div>
      )}

      {catalog && (
        <div className="backdrop" onClick={(e) => e.target === e.currentTarget && setCatalog(false)}>
          <div className="modal wide">
            <div className="modal-head">
              <h3>Ajouter un widget</h3>
              <button className="close-btn" onClick={() => setCatalog(false)}>
                Fermer ✕
              </button>
            </div>
            <div className="catalog">
              {(Object.keys(WIDGETS) as WidgetType[]).map((type) => (
                <button key={type} className="catalog-item" onClick={() => addWidget(type)}>
                  <span className="catalog-item__icon">{WIDGETS[type].icon}</span>
                  <b>{WIDGETS[type].label}</b>
                  <span className="text-muted small-text">{WIDGETS[type].description}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {configuring && draft && (
        <WidgetConfigModal
          projectKey={projectKey}
          widget={configuring}
          taxonomies={taxonomies}
          onClose={() => setConfiguring(null)}
          onSave={(updated) => {
            setDraft({ ...draft, widgets: compact(resolveCollisions(draft.widgets.map((w) => (w.id === updated.id ? updated : w)), updated.id)) });
            setConfiguring(null);
          }}
        />
      )}

      {globalOpen && view && (
        <div className="backdrop" onClick={(e) => e.target === e.currentTarget && setGlobalOpen(false)}>
          <div className="modal wide">
            <div className="modal-head">
              <div>
                <h3>Filtre global</h3>
                <div className="text-muted small-text">Appliqué à tous les widgets de tâches (combiné avec leurs propres critères).</div>
              </div>
              <button className="close-btn" onClick={() => setGlobalOpen(false)}>
                Fermer ✕
              </button>
            </div>
            {editing && draft ? (
              <Filters
                taxonomies={taxonomies}
                users={users}
                labels={(labels || []).map((l) => l.value)}
                filters={normalizeFilters(draft.globalFilters)}
                onChange={(filters) => setDraft({ ...draft, globalFilters: filters })}
              />
            ) : (
              <p className="text-muted">Passez en mode édition pour modifier le filtre global.</p>
            )}
          </div>
        </div>
      )}

      {openTaskId && <TaskModal projectKey={projectKey} taskId={openTaskId} onClose={() => setOpenTaskId(null)} />}
    </div>
  );
}

function TemplatePicker({ projectKey, onCreated }: { projectKey: string; onCreated: (id: string) => void }) {
  const m = useDashboardMutations(projectKey);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('sprint');
  const [shared, setShared] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="template-grid">
        {Object.entries(TEMPLATE_META).map(([key, meta]) => (
          <button key={key} className={`catalog-item${template === key ? ' active' : ''}`} onClick={() => setTemplate(key)}>
            <span className="catalog-item__icon">{meta.icon}</span>
            <b>{meta.label}</b>
            <span className="text-muted small-text">{meta.description}</span>
          </button>
        ))}
      </div>
      <div className="row wrap">
        <input type="text" value={name} placeholder={TEMPLATE_META[template].label} onChange={(e) => setName(e.target.value)} />
        <label className="row radio">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Partager avec le projet
        </label>
        <label className="row radio">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Ouvrir par défaut
        </label>
      </div>
      {err && <div className="form-error">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          className="btn primary"
          disabled={m.create.isPending}
          onClick={async () => {
            setErr(null);
            try {
              const { dashboard } = await m.create.mutateAsync({
                name: name.trim() || TEMPLATE_META[template].label,
                template,
                visibility: shared ? 'shared' : 'private',
                isDefault,
                isStarred: true,
              });
              onCreated(dashboard._id);
            } catch (e) {
              setErr(errorMessage(e));
            }
          }}
        >
          Créer le dashboard
        </button>
      </div>
    </div>
  );
}

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  orig: WidgetLayout;
  min: [number, number];
}

function DashboardGrid({
  widgets,
  editing,
  onChange,
  renderWidget,
}: {
  widgets: Widget[];
  editing: boolean;
  onChange: (widgets: Widget[]) => void;
  renderWidget: (w: Widget, handlers: { onMove: (e: React.PointerEvent) => void; onResize: (e: React.PointerEvent) => void }) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<{ id: string; layout: WidgetLayout } | null>(null);
  const rows = useMemo(() => Math.max(bottomOf(widgets), preview ? preview.layout.y + preview.layout.h : 0), [widgets, preview]);

  function start(e: React.PointerEvent, w: Widget, mode: DragState['mode']) {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = { id: w.id, mode, startX: e.clientX, startY: e.clientY, orig: w.layout, min: WIDGETS[w.type].min };
    setPreview({ id: w.id, layout: w.layout });
    const width = ref.current?.clientWidth || 1200;
    const colW = (width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
    let latest = w.layout;
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = Math.round((ev.clientX - d.startX) / (colW + GRID_GAP));
      const dy = Math.round((ev.clientY - d.startY) / (ROW_HEIGHT + GRID_GAP));
      latest =
        d.mode === 'move'
          ? { ...d.orig, x: Math.min(Math.max(d.orig.x + dx, 0), GRID_COLUMNS - d.orig.w), y: Math.max(0, d.orig.y + dy) }
          : { ...d.orig, w: Math.min(Math.max(d.orig.w + dx, d.min[0]), GRID_COLUMNS - d.orig.x), h: Math.min(Math.max(d.orig.h + dy, d.min[1]), 12) };
      setPreview({ id: d.id, layout: latest });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const d = drag.current;
      drag.current = null;
      setPreview(null);
      if (d) onChange(compact(resolveCollisions(widgets.map((x) => (x.id === d.id ? { ...x, layout: latest } : x)), d.id)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div ref={ref} className={`dash-grid${editing ? ' editing' : ''}`} style={{ gridTemplateRows: `repeat(${Math.max(rows, 1)}, ${ROW_HEIGHT}px)` }}>
      {widgets.map((w) => {
        const layout = preview?.id === w.id ? preview.layout : w.layout;
        return (
          <div
            key={w.id}
            className={`dash-cell${preview?.id === w.id ? ' dragging' : ''}`}
            style={{ gridColumn: `${layout.x + 1} / span ${layout.w}`, gridRow: `${layout.y + 1} / span ${layout.h}`, ['--rows' as string]: layout.h }}
          >
            {renderWidget(w, { onMove: (e) => start(e, w, 'move'), onResize: (e) => start(e, w, 'resize') })}
          </div>
        );
      })}
    </div>
  );
}
