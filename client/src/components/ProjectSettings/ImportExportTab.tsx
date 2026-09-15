import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { downloadFile } from '../../api/download';
import { useSavedFilters } from '../../api/filters';
import {
  useImportJobs,
  useImportMutations,
  type ImportFile,
  type ImportMapping,
  type ImportOptions,
  type ImportResult,
  type ImportRow,
  type MappingTarget,
} from '../../api/imports';
import { taxonomiesByKind, useTaxonomies } from '../../api/taxonomies';
import { useUsers } from '../../api/users';
import { useInvalidateProject } from '../../api/invalidate';
import { useProjectRole } from '../../hooks/useProjectRole';
import { fmtDate } from '../../utils/format';
import { STATUS_CATEGORY_META } from '../../utils/status';
import type { TaxonomyKind } from '../../types';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CREATE = '__create__';
const STEPS = ['Fichiers', 'Correspondances', 'Simulation', 'Rapport'] as const;

const FORMAT_LABELS: Record<string, string> = {
  'jira-csv': 'CSV Jira',
  'jira-issues-json': 'JSON tickets (API)',
  'jira-sprints-json': 'JSON sprints',
  'jira-versions-json': 'JSON versions',
  'jira-external-json': 'JSON import Jira (systèmes externes)',
};
const ACTION_LABELS: Record<ImportRow['action'], string> = {
  create: 'Créée',
  update: 'Mise à jour',
  unchanged: 'Inchangée',
  skip: 'Ignorée',
  error: 'Erreur',
};
const WARNING_LABELS: Record<string, string> = {
  SPRINT_STATE_GUESSED: 'États des sprints déduits',
  SPRINT_DATES_MISSING: 'Sprints sans dates',
  VERSION_META_MISSING: 'Versions sans statut de publication',
  PARENT_NOT_FOUND: 'Parents introuvables',
  ID_RENUMBERED: 'Identifiants renumérotés',
  ACTIVE_SPRINT_CONFLICT: 'Sprint actif en conflit',
  MULTIPLE_ACTIVE_SPRINTS: 'Plusieurs sprints actifs',
  COMMENT_NO_META: 'Commentaires sans métadonnées',
  COMMENTS_TRUNCATED: 'Commentaires tronqués',
  DATE_UNPARSEABLE: 'Dates illisibles',
};

export default function ImportExportTab({ projectKey }: { projectKey: string }) {
  const { isAdmin, project } = useProjectRole(projectKey);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <ExportSection projectKey={projectKey} />
      {isAdmin ? (
        <>
          <ImportWizard projectKey={projectKey} timezone={project?.timezone || 'Europe/Paris'} />
          <ImportHistory projectKey={projectKey} />
        </>
      ) : (
        <div className="notice">L'import Jira est réservé aux administrateurs du projet.</div>
      )}
    </div>
  );
}

function ExportSection({ projectKey }: { projectKey: string }) {
  const { data: filters } = useSavedFilters(projectKey);
  const [filterId, setFilterId] = useState('');
  const [sep, setSep] = useState<'comma' | 'semicolon'>('semicolon');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(path, name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <h3>Export</h3>
      {error && <div className="form-error">{error}</div>}
      <div className="danger-row" style={{ borderColor: 'var(--line)' }}>
        <div>
          <b>Projet complet (JSON)</b>
          <div className="text-muted small-text">Tâches avec historique et commentaires, taxonomies, sprints, rituels et filtres partagés.</div>
        </div>
        <button className="btn small" disabled={busy} onClick={() => run(`/projects/${projectKey}/export?format=json`, `${projectKey}-export.json`)}>
          Télécharger
        </button>
      </div>
      <div className="danger-row" style={{ borderColor: 'var(--line)' }}>
        <div>
          <b>Tâches (CSV compatible Jira)</b>
          <div className="text-muted small-text">Réimportable dans Jira ou Kýdos. Point-virgule recommandé pour Excel en français.</div>
        </div>
        <div className="row wrap">
          <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
            <option value="">Toutes les tâches</option>
            {(filters || []).map((f) => (
              <option key={f._id} value={f._id}>
                Filtre : {f.name}
              </option>
            ))}
          </select>
          <select value={sep} onChange={(e) => setSep(e.target.value as 'comma' | 'semicolon')}>
            <option value="semicolon">séparateur ;</option>
            <option value="comma">séparateur ,</option>
          </select>
          <button
            className="btn small"
            disabled={busy}
            onClick={() =>
              run(`/projects/${projectKey}/export?format=csv&sep=${sep}${filterId ? `&filterId=${filterId}` : ''}`, `${projectKey}-taches.csv`)
            }
          >
            Télécharger
          </button>
        </div>
      </div>
    </section>
  );
}

function targetValue(t: MappingTarget | undefined): string {
  if (!t) return '';
  return typeof t === 'string' ? t : CREATE;
}

function ImportWizard({ projectKey, timezone }: { projectKey: string; timezone: string }) {
  const { data: taxonomies } = useTaxonomies(projectKey);
  const { data: users } = useUsers();
  const m = useImportMutations(projectKey);
  const invalidate = useInvalidateProject(projectKey);
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [options, setOptions] = useState<ImportOptions>({
    mode: 'upsert',
    importComments: true,
    componentToArea: true,
    setCurrentSprint: true,
    extractAcceptance: true,
    hoursPerDay: 8,
    timezone,
    site: '',
  });
  const [analysis, setAnalysis] = useState<ImportResult | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [simulation, setSimulation] = useState<ImportResult | null>(null);
  const [simulatedFor, setSimulatedFor] = useState('');
  const [report, setReport] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const payload = () => ({ files, mapping: mapping || undefined, options: { ...options, site: options.site || undefined } });
  const signature = JSON.stringify({ mapping, options, files: files.map((f) => f.name + f.content.length) });
  const busy = m.analyze.isPending || m.simulate.isPending || m.run.isPending;

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name} dépasse 20 Mo.`);
        continue;
      }
      next.push({ name: file.name, content: await file.text() });
    }
    setFiles(next.slice(0, 5));
    setAnalysis(null);
    setSimulation(null);
  }

  async function analyze() {
    setError(null);
    try {
      const result = await m.analyze.mutateAsync({ files, options });
      setAnalysis(result);
      setMapping(result.mapping);
      setSimulation(null);
      setStep(1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function simulate() {
    setError(null);
    try {
      const result = await m.simulate.mutateAsync(payload());
      setSimulation(result);
      setSimulatedFor(signature);
      setStep(2);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function execute() {
    if (!confirm(`Importer ${simulation?.counts.created ?? 0} création(s) et ${simulation?.counts.updated ?? 0} mise(s) à jour ?`)) return;
    setError(null);
    try {
      const result = await m.run.mutateAsync(payload());
      setReport(result);
      setStep(3);
      invalidate();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function reset() {
    setStep(0);
    setFiles([]);
    setAnalysis(null);
    setMapping(null);
    setSimulation(null);
    setReport(null);
    setError(null);
  }

  const setTarget = (section: 'statuses' | 'priorities' | 'types', name: string, value: string, create: MappingTarget) =>
    setMapping((prev) => (prev ? { ...prev, [section]: { ...prev[section], [name]: value === CREATE ? create : value } } : prev));

  return (
    <section className="settings-card">
      <div className="section-head">
        <h3>Importer depuis Jira</h3>
        {step > 0 && (
          <button className="btn ghost small" onClick={reset}>
            Nouvel import
          </button>
        )}
      </div>
      <ol className="stepper">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <span>{i + 1}</span> {label}
          </li>
        ))}
      </ol>
      {error && <div className="form-error">{error}</div>}

      {step === 0 && (
        <div className="stack">
          <div
            className={`dropzone${dragOver ? ' over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <b>Déposez vos exports Jira ici</b> ou cliquez pour choisir (5 fichiers, 20 Mo max chacun)
            <div className="text-muted small-text">CSV « Tous les champs », ou JSON de l'API (tickets) + JSON des sprints + JSON des versions.</div>
            <input ref={inputRef} type="file" accept=".csv,.json,text/csv,application/json" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          </div>
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span>📄 {f.name}</span>
                  <span className="text-muted small-text">{(f.content.length / 1024).toFixed(0)} Ko</span>
                  <button className="icon-btn" onClick={() => setFiles(files.filter((_, k) => k !== i))} title="Retirer">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <details className="help-box">
            <summary>Comment exporter depuis Jira ?</summary>
            <ol>
              <li>
                <b>Sans accès API :</b> recherche de tickets (JQL <code>project = CLE</code>) → <i>Exporter</i> → <i>CSV (tous les champs)</i>. Ne rouvrez
                pas le fichier dans Excel avant l'import (les dates seraient réécrites).
              </li>
              <li>
                <b>Meilleur résultat :</b> exportez en JSON <code>/rest/api/3/search/jql?jql=project=CLE&amp;fields=*all&amp;expand=names</code>, les
                sprints <code>/rest/agile/1.0/board/ID/sprint</code> et les versions <code>/rest/api/3/project/CLE/versions</code> : états et dates des
                sprints et statut des versions sont alors exacts.
              </li>
              <li>Jira Cloud limite un export CSV : importez plusieurs fichiers successifs si besoin, le ré-import ne crée pas de doublons.</li>
              <li>
                Le <b>JSON « import de systèmes externes »</b> (<code>projects[].issues[]</code> + <code>links</code>) est aussi accepté : champs
                personnalisés conservés, « Catégorie » → catégorie, « Effort » S/M/L → points, liens décrits dans la tâche. Conversion hors ligne
                possible avec <code>npm run jira:convert -- fichier.json</code>.
              </li>
            </ol>
          </details>

          <div className="field-grid" style={{ margin: 0 }}>
            <div className="field">
              <label>Tickets déjà importés</label>
              <select value={options.mode} onChange={(e) => setOptions({ ...options, mode: e.target.value as ImportOptions['mode'] })}>
                <option value="upsert">Mettre à jour depuis Jira</option>
                <option value="create">Ignorer (créer seulement)</option>
              </select>
            </div>
            <div className="field">
              <label>Fuseau des dates CSV</label>
              <input type="text" value={options.timezone} onChange={(e) => setOptions({ ...options, timezone: e.target.value })} />
            </div>
            <div className="field">
              <label>Heures par jour (estimations)</label>
              <input type="number" min={1} max={24} value={options.hoursPerDay} onChange={(e) => setOptions({ ...options, hoursPerDay: Number(e.target.value) || 8 })} />
            </div>
            <div className="field">
              <label>URL du site Jira (liens)</label>
              <input type="text" placeholder="https://societe.atlassian.net" value={options.site} onChange={(e) => setOptions({ ...options, site: e.target.value })} />
            </div>
          </div>
          <div className="row wrap" style={{ gap: 14 }}>
            {(
              [
                ['importComments', 'Importer les commentaires'],
                ['componentToArea', 'Composant → domaine'],
                ['setCurrentSprint', 'Sprint actif Jira → sprint courant'],
                ['extractAcceptance', "Extraire les critères d'acceptation"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="row radio">
                <input type="checkbox" checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" disabled={!files.length || busy} onClick={analyze}>
              {m.analyze.isPending ? 'Analyse…' : 'Analyser les fichiers'}
            </button>
          </div>
        </div>
      )}

      {step === 1 && analysis && mapping && (
        <div className="stack">
          <div className="import-files">
            {analysis.files.map((f) => (
              <span key={f.name} className="tag">
                {f.name} · {FORMAT_LABELS[f.format] || f.format}
                {f.rows !== undefined ? ` · ${f.rows} ligne(s)` : ''}
              </span>
            ))}
          </div>
          <CountsBar result={analysis} />

          <MappingTable
            title="Statuts"
            rows={analysis.entities.statuses.map((s) => ({
              name: s.name,
              count: s.count,
              hint: `${STATUS_CATEGORY_META[s.category].label}${s.guessed ? ' (déduit)' : ''}`,
            }))}
            options={taxonomiesByKind(taxonomies, 'status').map((t) => ({ value: t.key, label: t.label }))}
            value={(name) => targetValue(mapping.statuses[name])}
            onChange={(name, v) => {
              const s = analysis.entities.statuses.find((x) => x.name === name)!;
              setTarget('statuses', name, v, { create: { label: name, category: s.category } });
            }}
          />
          <MappingTable
            title="Priorités"
            rows={analysis.entities.priorities.map((p) => ({ name: p.name, count: p.count }))}
            options={taxonomiesByKind(taxonomies, 'priority').map((t) => ({ value: t.key, label: `${t.key} · ${t.label}` }))}
            value={(name) => targetValue(mapping.priorities[name])}
            onChange={(name, v) => setTarget('priorities', name, v, { create: { label: name } })}
          />
          <MappingTable
            title="Types"
            rows={analysis.entities.types.map((t) => ({ name: t.name, count: t.count, hint: t.subtask ? 'sous-tâche' : t.hierarchyLevel === 1 ? 'epic' : undefined }))}
            options={taxonomiesByKind(taxonomies, 'type' as TaxonomyKind).map((t) => ({ value: t.key, label: t.label }))}
            value={(name) => targetValue(mapping.types[name])}
            onChange={(name, v) => {
              const original = analysis.mapping.types[name];
              setTarget('types', name, v, typeof original === 'object' ? original : { create: { label: name } });
            }}
          />

          <div className="mapping-block">
            <h4>Personnes</h4>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Personne Jira</th>
                    <th>Rôles</th>
                    <th>Utilisateur Kýdos</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.entities.people.map((p) => (
                    <tr key={p.ref}>
                      <td>
                        {p.displayName || p.ref} {p.email && <span className="text-muted small-text">{p.email}</span>}
                      </td>
                      <td className="small-text">
                        {Object.entries(p.roles)
                          .map(([role, n]) => `${{ assignee: 'assigné', reporter: 'rapporteur', commenter: 'commentaires' }[role] || role} ${n}`)
                          .join(' · ')}
                      </td>
                      <td>
                        <select
                          value={mapping.people[p.ref] || ''}
                          onChange={(e) => setMapping({ ...mapping, people: { ...mapping.people, [p.ref]: e.target.value || null } })}
                        >
                          <option value="">Ne pas associer (nom conservé)</option>
                          {(users || []).map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.displayName} ({u.username})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {analysis.entities.sprints.some((s) => !s.existingKey) && (
            <div className="mapping-block">
              <h4>Sprints à créer</h4>
              <div className="table-scroll">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Sprint Jira</th>
                      <th>Tickets</th>
                      <th>État</th>
                      <th>Début</th>
                      <th>Fin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.entities.sprints
                      .filter((s) => !s.existingKey)
                      .map((s) => {
                        const o = mapping.sprints[s.name] || {};
                        const setSprint = (patch: Partial<ImportMapping['sprints'][string]>) =>
                          setMapping({ ...mapping, sprints: { ...mapping.sprints, [s.name]: { ...o, ...patch } } });
                        const simulated = simulation?.entities.sprints.find((x) => x.name === s.name);
                        return (
                          <tr key={s.name}>
                            <td>{s.name}</td>
                            <td>{s.count}</td>
                            <td>
                              <select value={o.state || s.state || simulated?.state || ''} onChange={(e) => setSprint({ state: (e.target.value || undefined) as never })}>
                                <option value="">{s.state ? '' : 'Déduit automatiquement'}</option>
                                <option value="closed">Terminé</option>
                                <option value="active">Actif</option>
                                <option value="future">À venir</option>
                              </select>
                            </td>
                            <td>
                              <input type="date" value={(o.startDate || s.startDate || '').slice(0, 10)} onChange={(e) => setSprint({ startDate: e.target.value || undefined })} />
                            </td>
                            <td>
                              <input type="date" value={(o.endDate || s.endDate || '').slice(0, 10)} onChange={(e) => setSprint({ endDate: e.target.value || undefined })} />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mapping-block">
            <h4>Champs Jira</h4>
            <div className="field-grid" style={{ margin: 0 }}>
              <div className="field">
                <label>Story points</label>
                <select value={mapping.fields.storyPoints || ''} onChange={(e) => setMapping({ ...mapping, fields: { ...mapping.fields, storyPoints: e.target.value || null } })}>
                  <option value="">Aucun (0 point)</option>
                  {analysis.entities.fields.storyPoints.candidates.map((c) => (
                    <option key={c} value={c}>
                      {c.replace(/^cf:/, '')}
                    </option>
                  ))}
                </select>
              </div>
              {(
                [
                  ['category', 'Catégorie Kýdos'],
                  ['techno', 'Techno Kýdos'],
                ] as const
              ).map(([kind, label]) => (
                <div className="field" key={kind}>
                  <label>{label}</label>
                  <select value={mapping.fields[kind] || ''} onChange={(e) => setMapping({ ...mapping, fields: { ...mapping.fields, [kind]: e.target.value || null } })}>
                    <option value="">Aucun champ</option>
                    {(analysis.entities.fields.textFields || []).map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label} ({f.distinct} valeur{f.distinct > 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <p className="hint">Les valeurs absentes du projet (catégories, technos, domaines, types, étiquettes) sont créées automatiquement.</p>
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn ghost" onClick={() => setStep(0)}>
              ← Fichiers
            </button>
            <button className="btn primary" disabled={busy} onClick={simulate}>
              {m.simulate.isPending ? 'Simulation…' : 'Simuler l’import'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && simulation && (
        <div className="stack">
          <div className="notice">Simulation : aucune donnée n'a encore été écrite. Vérifiez le résultat puis lancez l'import.</div>
          <ResultDetails result={simulation} />
          {simulatedFor !== signature && <div className="form-error">Les correspondances ont changé : relancez la simulation.</div>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn ghost" onClick={() => setStep(1)}>
              ← Correspondances
            </button>
            <button className="btn primary" disabled={busy || simulatedFor !== signature || simulation.counts.created + simulation.counts.updated === 0} onClick={execute}>
              {m.run.isPending ? 'Import en cours…' : `Lancer l'import (${simulation.counts.created} création(s), ${simulation.counts.updated} mise(s) à jour)`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && report && (
        <div className="stack">
          <div className="form-ok" style={{ fontSize: 14 }}>
            Import terminé ({report.status === 'partial' ? 'avec des erreurs' : 'succès'}) : {report.counts.created} tâche(s) créée(s), {report.counts.updated}{' '}
            mise(s) à jour.
          </div>
          <ResultDetails result={report} />
          <div className="row">
            <Link className="btn primary" to={`/projects/${projectKey}/board`}>
              Voir le board
            </Link>
            <Link className="btn ghost" to={`/projects/${projectKey}/settings/sprints`}>
              Vérifier les sprints
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function CountsBar({ result }: { result: ImportResult }) {
  const c = result.counts;
  return (
    <div className="close-summary">
      {(
        [
          ['created', 'À créer', 'var(--success)'],
          ['updated', 'À mettre à jour', 'var(--gold)'],
          ['unchanged', 'Inchangées', 'var(--soft)'],
          ['skipped', 'Ignorées', 'var(--mute)'],
          ['errors', 'Erreurs', 'var(--danger)'],
        ] as const
      ).map(([key, label, color]) => (
        <div className="kpi" key={key}>
          <div className="v" style={{ color }}>
            {c[key]}
          </div>
          <div className="l">{label}</div>
        </div>
      ))}
      <div className="kpi">
        <div className="v">
          {result.idPlan.kept} / {result.idPlan.renumbered}
        </div>
        <div className="l">Clés conservées / renumérotées</div>
      </div>
    </div>
  );
}

function ResultDetails({ result }: { result: ImportResult }) {
  const [filter, setFilter] = useState<ImportRow['action'] | ''>('');
  const created = Object.entries(result.taxonomiesCreated).filter(([, keys]) => keys.length);
  const rows = useMemo(() => result.rows.filter((r) => !filter || r.action === filter), [result.rows, filter]);
  return (
    <div className="stack">
      <CountsBar result={result} />
      {created.length > 0 && (
        <div className="small-text">
          <b>Valeurs créées :</b>{' '}
          {created.map(([kind, keys]) => `${{ status: 'statuts', priority: 'priorités', type: 'types', sprint: 'sprints', version: 'versions', area: 'domaines', category: 'catégories', techno: 'technos' }[kind] || kind} (${keys.join(', ')})`).join(' · ')}
        </div>
      )}
      {result.currentSprint && <div className="small-text">Sprint courant défini : {result.currentSprint}</div>}
      {result.warnings.length > 0 && (
        <ul className="warning-list">
          {result.warnings.map((w) => (
            <li key={w.code}>
              ⚠ <b>{WARNING_LABELS[w.code] || w.code}</b> ({w.count}) — {w.message}
              {w.rows.length > 0 && <span className="text-muted"> lignes {w.rows.slice(0, 10).join(', ')}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="row wrap">
        <span className="small-text">Lignes :</span>
        {(['', 'create', 'update', 'unchanged', 'skip', 'error'] as const).map((a) => (
          <button key={a || 'all'} className={`chip${filter === a ? ' active' : ''}`} onClick={() => setFilter(a)}>
            {a ? ACTION_LABELS[a] : 'Toutes'}
          </button>
        ))}
      </div>
      <div className="table-scroll" style={{ maxHeight: 320 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ligne</th>
              <th>Jira</th>
              <th>Kýdos</th>
              <th>Titre</th>
              <th>Action</th>
              <th>Remarques</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((r) => (
              <tr key={`${r.row}-${r.externalKey}`}>
                <td>{r.row}</td>
                <td className="mono">{r.externalKey}</td>
                <td className="mono">{r.taskId || '—'}</td>
                <td>{r.title || '—'}</td>
                <td>
                  <span className={`import-action ${r.action}`}>{ACTION_LABELS[r.action]}</span>
                </td>
                <td className="small-text">{[...r.errors, ...r.warnings].map((c) => WARNING_LABELS[c] || c).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MappingTable({
  title,
  rows,
  options,
  value,
  onChange,
}: {
  title: string;
  rows: { name: string; count: number; hint?: string }[];
  options: { value: string; label: string }[];
  value: (name: string) => string;
  onChange: (name: string, value: string) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="mapping-block">
      <h4>{title}</h4>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Valeur Jira</th>
              <th>Tickets</th>
              <th>Valeur Kýdos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  {r.name} {r.hint && <span className="text-muted small-text">· {r.hint}</span>}
                </td>
                <td>{r.count}</td>
                <td>
                  <select value={value(r.name)} onChange={(e) => onChange(r.name, e.target.value)}>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value={CREATE}>+ Créer « {r.name} »</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportHistory({ projectKey }: { projectKey: string }) {
  const { data: jobs } = useImportJobs(projectKey);
  const m = useImportMutations(projectKey);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestUndoable = (jobs || []).find((j) => j.status === 'completed' || j.status === 'partial');
  const STATUS: Record<string, string> = { running: 'En cours', completed: 'Terminé', partial: 'Partiel', failed: 'Échec', rolledBack: 'Annulé' };

  if (!jobs?.length) return null;
  return (
    <section className="settings-card">
      <h3>Historique des imports</h3>
      {message && <div className="form-ok">{message}</div>}
      {error && <div className="form-error">{error}</div>}
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Par</th>
              <th>Fichiers</th>
              <th>Résultat</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j._id}>
                <td>{fmtDate(j.createdAt)}</td>
                <td>{j.createdBy?.displayName || '—'}</td>
                <td className="small-text">{j.files.map((f) => f.name).join(', ')}</td>
                <td className="small-text">
                  {j.counts.created} créée(s) · {j.counts.updated} maj · {j.counts.unchanged} inchangée(s)
                  {j.counts.errors ? ` · ${j.counts.errors} erreur(s)` : ''}
                </td>
                <td>{STATUS[j.status] || j.status}</td>
                <td>
                  {latestUndoable?._id === j._id && (
                    <button
                      className="btn small danger"
                      disabled={m.rollback.isPending}
                      onClick={async () => {
                        if (!confirm('Annuler cet import ? Les tâches créées non modifiées depuis seront supprimées.')) return;
                        setError(null);
                        try {
                          const { report } = await m.rollback.mutateAsync(j._id);
                          setMessage(
                            `Import annulé : ${report.tasksDeleted} tâche(s) supprimée(s), ${report.tasksRestored} restaurée(s)` +
                              (report.tasksKept.length ? `, ${report.tasksKept.length} conservée(s) car modifiée(s).` : '.')
                          );
                        } catch (e) {
                          setError(errorMessage(e));
                        }
                      }}
                    >
                      Annuler l'import
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
