import { useEffect, useMemo, useState } from 'react';
import { useProjectOverview, useUpdateProject } from '../../api/projects';
import { taxonomiesByKind, useTaxonomies } from '../../api/taxonomies';
import { errorMessage } from '../../api/client';
import { useProjectRole } from '../../hooks/useProjectRole';
import { fmtDate } from '../../utils/format';
import { compareVersions } from '../../utils/versions';
import type { Project } from '../../types';

const SCALE_PRESETS = [
  { label: 'Fibonacci', scale: [1, 2, 3, 5, 8, 13] },
  { label: 'Fibonacci étendu', scale: [0.5, 1, 2, 3, 5, 8, 13, 21] },
  { label: 'Puissances de 2', scale: [1, 2, 4, 8, 16] },
  { label: 'Linéaire', scale: [1, 2, 3, 4, 5] },
];
const DAYS = [
  { v: 1, l: 'Lun' },
  { v: 2, l: 'Mar' },
  { v: 3, l: 'Mer' },
  { v: 4, l: 'Jeu' },
  { v: 5, l: 'Ven' },
  { v: 6, l: 'Sam' },
  { v: 0, l: 'Dim' },
];
const COMMON_TIMEZONES = ['Europe/Paris', 'Europe/London', 'Europe/Brussels', 'Africa/Tunis', 'Africa/Casablanca', 'Africa/Algiers', 'America/Montreal', 'America/New_York', 'Asia/Dubai', 'UTC'];

interface Form {
  name: string;
  vendor: string;
  description: string;
  currentVersion: string;
  sprintDurationValue: number;
  sprintDurationUnit: 'days' | 'weeks';
  timezone: string;
  workingDays: number[];
  unit: 'points' | 'hours';
  scaleText: string;
  defaults: { status: string; type: string; priority: string };
}

function formFrom(p: Project): Form {
  return {
    name: p.name,
    vendor: p.vendor || '',
    description: p.description || '',
    currentVersion: p.currentVersion || '',
    sprintDurationValue: p.sprintDurationValue || 1,
    sprintDurationUnit: p.sprintDurationUnit || 'weeks',
    timezone: p.timezone || 'Europe/Paris',
    workingDays: [...(p.workingDays || [1, 2, 3, 4, 5])].sort(),
    unit: p.estimation?.unit || 'points',
    scaleText: (p.estimation?.scale || [1, 2, 3, 5, 8, 13]).join(', '),
    defaults: { status: p.defaults?.status || '', type: p.defaults?.type || '', priority: p.defaults?.priority || '' },
  };
}

const parseScale = (text: string) =>
  [...new Set(text.split(/[,;\s]+/).map((s) => Number(s.replace(',', '.'))).filter((n) => Number.isFinite(n) && n >= 0))].sort(
    (a, b) => a - b
  );

export default function GeneralTab({ projectKey }: { projectKey: string }) {
  const { project, isAdmin } = useProjectRole(projectKey);
  const { data: overview } = useProjectOverview(projectKey);
  const { data: taxonomies } = useTaxonomies(projectKey);
  const update = useUpdateProject(projectKey);
  const [form, setForm] = useState<Form | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (project) setForm(formFrom(project));
  }, [project?._id, project?.updatedAt]);

  const versions = useMemo(
    () => taxonomiesByKind(taxonomies, 'version').sort((a, b) => compareVersions(b.key, a.key)),
    [taxonomies]
  );
  const timezones = useMemo(() => {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone');
    return supported?.length ? supported : COMMON_TIMEZONES;
  }, []);

  if (!project || !form) return <div className="loadbox">Chargement…</div>;

  const dirty = JSON.stringify(formFrom(project)) !== JSON.stringify(form);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const disabled = !isAdmin;
  const scale = parseScale(form.scaleText);

  async function save() {
    if (!form) return;
    setMessage(null);
    try {
      await update.mutateAsync({
        name: form.name,
        vendor: form.vendor,
        description: form.description,
        currentVersion: form.currentVersion,
        sprintDurationValue: form.sprintDurationValue,
        sprintDurationUnit: form.sprintDurationUnit,
        timezone: form.timezone,
        workingDays: form.workingDays,
        estimation: { unit: form.unit, scale },
        defaults: {
          ...(form.defaults.status ? { status: form.defaults.status } : {}),
          ...(form.defaults.type ? { type: form.defaults.type } : {}),
          ...(form.defaults.priority ? { priority: form.defaults.priority } : {}),
        },
      });
      setMessage({ ok: true, text: 'Paramètres enregistrés.' });
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(e) });
    }
  }

  return (
    <div className="settings-grid">
      <section className="settings-card">
        <h3>Identité</h3>
        <div className="field">
          <label>Clé</label>
          <input type="text" value={project.key} disabled />
        </div>
        <div className="field">
          <label>Nom *</label>
          <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} disabled={disabled} />
        </div>
        <div className="field">
          <label>Éditeur</label>
          <input type="text" value={form.vendor} onChange={(e) => set('vendor', e.target.value)} disabled={disabled} />
        </div>
        <div className="field">
          <label>Description</label>
          <textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} disabled={disabled} />
        </div>
      </section>

      <section className="settings-card">
        <h3>Aperçu</h3>
        {overview ? (
          <div className="overview-stats">
            <div>
              <b>{overview.taskCount}</b> tâches · <b>{overview.openCount}</b> ouvertes
            </div>
            <div>
              <b>{overview.memberCount}</b> membres · <b>{overview.sprintCount}</b> sprints
            </div>
            <div>Sprint actif : {overview.activeSprint ? <b>{overview.activeSprint.label}</b> : <span className="text-muted">aucun</span>}</div>
            <div>Dernière activité : {overview.lastActivityAt ? fmtDate(overview.lastActivityAt) : '—'}</div>
            <div>Créé le {fmtDate(overview.createdAt)}</div>
          </div>
        ) : (
          <div className="text-muted">Chargement…</div>
        )}
      </section>

      <section className="settings-card">
        <h3>Planification</h3>
        <div className="field">
          <label>Version courante</label>
          <select value={form.currentVersion} onChange={(e) => set('currentVersion', e.target.value)} disabled={disabled}>
            {!versions.some((v) => v.key === form.currentVersion) && (
              <option value={form.currentVersion}>{form.currentVersion || '—'} (hors référentiel)</option>
            )}
            {versions.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Cadence des sprints</label>
          <div className="row">
            <input
              type="number"
              min={1}
              max={90}
              value={form.sprintDurationValue}
              onChange={(e) => set('sprintDurationValue', Number(e.target.value) || 1)}
              disabled={disabled}
              style={{ width: 90 }}
            />
            <select value={form.sprintDurationUnit} onChange={(e) => set('sprintDurationUnit', e.target.value as Form['sprintDurationUnit'])} disabled={disabled}>
              <option value="weeks">semaine(s)</option>
              <option value="days">jour(s)</option>
            </select>
          </div>
          <span className="hint">N'affecte que les prochains sprints créés.</span>
        </div>
        <div className="field">
          <label>Fuseau horaire</label>
          <select value={form.timezone} onChange={(e) => set('timezone', e.target.value)} disabled={disabled}>
            {!timezones.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Jours ouvrés</label>
          <div className="day-toggles">
            {DAYS.map((d) => {
              const on = form.workingDays.includes(d.v);
              return (
                <button
                  type="button"
                  key={d.v}
                  className={`day-toggle${on ? ' on' : ''}`}
                  disabled={disabled}
                  onClick={() => set('workingDays', on ? form.workingDays.filter((x) => x !== d.v) : [...form.workingDays, d.v].sort())}
                >
                  {d.l}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <h3>Estimation & valeurs par défaut</h3>
        <div className="field">
          <label>Unité</label>
          <div className="row">
            {(['points', 'hours'] as const).map((u) => (
              <label key={u} className="row radio">
                <input type="radio" checked={form.unit === u} onChange={() => set('unit', u)} disabled={disabled} />
                {u === 'points' ? 'Points de story' : 'Heures'}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Échelle proposée</label>
          <div className="chips">
            {SCALE_PRESETS.map((p) => (
              <button
                type="button"
                key={p.label}
                className={`chip${p.scale.join(',') === scale.join(',') ? ' active' : ''}`}
                disabled={disabled}
                onClick={() => set('scaleText', p.scale.join(', '))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input type="text" value={form.scaleText} onChange={(e) => set('scaleText', e.target.value)} disabled={disabled} placeholder="1, 2, 3, 5, 8" />
        </div>
        <div className="field-grid" style={{ margin: 0 }}>
          {(
            [
              ['status', 'Statut'],
              ['type', 'Type'],
              ['priority', 'Priorité'],
            ] as const
          ).map(([kind, label]) => (
            <div className="field" key={kind}>
              <label>{label} par défaut</label>
              <select
                value={form.defaults[kind]}
                onChange={(e) => set('defaults', { ...form.defaults, [kind]: e.target.value })}
                disabled={disabled}
              >
                <option value="">—</option>
                {taxonomiesByKind(taxonomies, kind).map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      {isAdmin && (
        <div className="settings-actions">
          {message && <span className={message.ok ? 'form-ok' : 'form-error'}>{message.text}</span>}
          <button className="btn ghost" disabled={!dirty} onClick={() => setForm(formFrom(project))}>
            Annuler
          </button>
          <button className="btn primary" disabled={!dirty || update.isPending || !form.name.trim()} onClick={save}>
            {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}
