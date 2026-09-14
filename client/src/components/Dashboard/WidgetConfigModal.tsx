import { useState } from 'react';
import type { Widget } from '../../api/dashboards';
import { useSavedFilters } from '../../api/filters';
import { useProjectLabels } from '../../api/projects';
import { taxonomiesByKind } from '../../api/taxonomies';
import { useUsers } from '../../api/users';
import type { TaxonomyItem } from '../../types';
import { normalizeFilters } from '../../utils/boardUrlState';
import Filters from '../Board/Filters';
import { DIMENSION_LABELS, METRIC_LABELS, WIDGETS } from './registry';

const SORTS: Record<string, string> = {
  'updatedAt:desc': 'Dernières modifiées',
  'priority:asc': 'Priorité',
  'dueDate:asc': 'Échéance',
  'createdAt:desc': 'Dernières créées',
  'complexity:desc': 'Plus gros points',
  'taskId:asc': 'Identifiant',
};

export default function WidgetConfigModal({
  projectKey,
  widget,
  taxonomies,
  onSave,
  onClose,
}: {
  projectKey: string;
  widget: Widget;
  taxonomies?: TaxonomyItem[];
  onSave: (widget: Widget) => void;
  onClose: () => void;
}) {
  const meta = WIDGETS[widget.type];
  const [draft, setDraft] = useState<Widget>(() => JSON.parse(JSON.stringify(widget)));
  const { data: savedFilters } = useSavedFilters(projectKey);
  const { data: users } = useUsers();
  const { data: labels } = useProjectLabels(projectKey);
  const c = draft.config;
  const setConfig = (key: string, value: unknown) => setDraft((d) => ({ ...d, config: { ...d.config, [key]: value } }));
  const sprints = taxonomiesByKind(taxonomies, 'sprint');

  const select = (key: string, options: Record<string, string>, label: string, allowNone = false) => (
    <div className="field">
      <label>{label}</label>
      <select value={c[key] ?? ''} onChange={(e) => setConfig(key, e.target.value || null)}>
        {allowNone && <option value="">Aucun</option>}
        {Object.entries(options).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
  const sprintSelect = (
    <div className="field">
      <label>Sprint</label>
      <select value={c.sprint || '@current'} onChange={(e) => setConfig('sprint', e.target.value)}>
        <option value="@current">Sprint courant (dynamique)</option>
        {sprints.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
  const metrics = { count: METRIC_LABELS.count, points: METRIC_LABELS.points, hours: METRIC_LABELS.hours };

  return (
    <div className="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide">
        <div className="modal-head">
          <div>
            <div className="m-id">
              {meta.icon} {meta.label}
            </div>
            <h3>Configurer le widget</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            Fermer ✕
          </button>
        </div>

        <div className="field-grid">
          <div className="field">
            <label>Titre</label>
            <input type="text" value={draft.title} placeholder={meta.label} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div className="field">
            <label>Largeur (colonnes)</label>
            <input
              type="number"
              min={meta.min[0]}
              max={12}
              value={draft.layout.w}
              onChange={(e) => setDraft({ ...draft, layout: { ...draft.layout, w: Math.min(12, Math.max(meta.min[0], Number(e.target.value) || meta.min[0])) } })}
            />
          </div>
          <div className="field">
            <label>Hauteur (lignes)</label>
            <input
              type="number"
              min={meta.min[1]}
              max={12}
              value={draft.layout.h}
              onChange={(e) => setDraft({ ...draft, layout: { ...draft.layout, h: Math.min(12, Math.max(meta.min[1], Number(e.target.value) || meta.min[1])) } })}
            />
          </div>

          {draft.type === 'kpi' && (
            <>
              {select('metric', METRIC_LABELS, 'Mesure')}
              <div className="field">
                <label>Suffixe</label>
                <input type="text" value={c.suffix || ''} onChange={(e) => setConfig('suffix', e.target.value)} placeholder="pts" />
              </div>
            </>
          )}
          {draft.type === 'breakdown' && (
            <>
              {select('groupBy', DIMENSION_LABELS, 'Regrouper par')}
              {select('splitBy', DIMENSION_LABELS, 'Empiler par', true)}
              {select('metric', metrics, 'Mesure')}
              {select('chart', { bar: 'Barres verticales', hbar: 'Barres horizontales', donut: 'Donut', table: 'Tableau' }, 'Graphique')}
              <div className="field">
                <label>Nombre max de groupes</label>
                <input type="number" min={1} max={50} value={c.topN} onChange={(e) => setConfig('topN', Number(e.target.value) || 12)} />
              </div>
            </>
          )}
          {draft.type === 'matrix' && (
            <>
              {select('rows', DIMENSION_LABELS, 'Lignes')}
              {select('cols', DIMENSION_LABELS, 'Colonnes')}
              {select('metric', metrics, 'Mesure')}
            </>
          )}
          {draft.type === 'sprintBurndown' && (
            <>
              {sprintSelect}
              {select('unit', { points: 'Points', count: 'Nombre de tâches' }, 'Unité')}
              {select('mode', { burndown: 'Burndown (reste à faire)', burnup: 'Burnup (terminé vs périmètre)' }, 'Mode')}
              <label className="row radio">
                <input type="checkbox" checked={c.showIdeal !== false} onChange={(e) => setConfig('showIdeal', e.target.checked)} />
                Ligne idéale
              </label>
            </>
          )}
          {draft.type === 'velocity' && (
            <>
              <div className="field">
                <label>Derniers sprints</label>
                <input type="number" min={1} max={20} value={c.last} onChange={(e) => setConfig('last', Number(e.target.value) || 6)} />
              </div>
              {select('unit', { points: 'Points', count: 'Nombre de tâches' }, 'Unité')}
            </>
          )}
          {draft.type === 'workload' && (
            <>
              {select('metric', metrics, 'Mesure')}
              <div className="field">
                <label>Capacité par personne</label>
                <input type="number" min={0} value={c.capacityPerUser ?? ''} onChange={(e) => setConfig('capacityPerUser', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <label className="row radio">
                <input type="checkbox" checked={c.includeUnassigned !== false} onChange={(e) => setConfig('includeUnassigned', e.target.checked)} />
                Inclure « Non assigné »
              </label>
            </>
          )}
          {draft.type === 'taskList' && (
            <>
              {select('sort', SORTS, 'Tri')}
              <div className="field">
                <label>Nombre de tâches</label>
                <input type="number" min={1} max={100} value={c.limit} onChange={(e) => setConfig('limit', Number(e.target.value) || 20)} />
              </div>
            </>
          )}
          {draft.type === 'recentActivity' && (
            <div className="field">
              <label>Nombre d'événements</label>
              <input type="number" min={1} max={50} value={c.limit} onChange={(e) => setConfig('limit', Number(e.target.value) || 20)} />
            </div>
          )}
          {draft.type === 'sprintSummary' && sprintSelect}
        </div>

        {draft.type === 'note' && (
          <div className="field">
            <label>Texte</label>
            <textarea rows={8} value={c.text || ''} onChange={(e) => setConfig('text', e.target.value)} />
          </div>
        )}

        {meta.usesTasks && (
          <div className="widget-source">
            <h4>Tâches prises en compte</h4>
            <div className="row wrap" style={{ gap: 14 }}>
              <label className="row radio">
                <input type="radio" checked={draft.source.mode === 'global'} onChange={() => setDraft({ ...draft, source: { ...draft.source, mode: 'global' } })} />
                Filtre global du dashboard
              </label>
              <label className="row radio">
                <input
                  type="radio"
                  checked={draft.source.mode === 'filter'}
                  disabled={!savedFilters?.length}
                  onChange={() => setDraft({ ...draft, source: { ...draft.source, mode: 'filter', filterId: draft.source.filterId || savedFilters?.[0]?._id || null } })}
                />
                Filtre enregistré
              </label>
              <label className="row radio">
                <input type="radio" checked={draft.source.mode === 'inline'} onChange={() => setDraft({ ...draft, source: { ...draft.source, mode: 'inline' } })} />
                Critères personnalisés
              </label>
            </div>
            {draft.source.mode === 'filter' && (
              <select value={draft.source.filterId || ''} onChange={(e) => setDraft({ ...draft, source: { ...draft.source, filterId: e.target.value } })}>
                {(savedFilters || []).map((f) => (
                  <option key={f._id} value={f._id}>
                    {f.name}
                    {f.visibility === 'shared' ? ' (partagé)' : ''}
                  </option>
                ))}
              </select>
            )}
            {draft.source.mode === 'inline' && (
              <Filters
                taxonomies={taxonomies}
                users={users}
                labels={(labels || []).map((l) => l.value)}
                filters={normalizeFilters(draft.source.filters)}
                onChange={(filters) => setDraft({ ...draft, source: { ...draft.source, filters } })}
              />
            )}
            <p className="hint">Les critères du widget se combinent toujours avec le filtre global du dashboard.</p>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn ghost" onClick={onClose}>
            Annuler
          </button>
          <button className="btn primary" onClick={() => onSave(draft)}>
            Appliquer
          </button>
        </div>
      </div>
    </div>
  );
}
