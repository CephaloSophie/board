const { Taxonomy } = require('../../models/Taxonomy');
const { Task } = require('../../models/Task');
const { User } = require('../../models/User');
const { Project } = require('../../models/Project');
const { Counter } = require('../../models/Counter');
const { ImportJob } = require('../../models/ImportJob');
const { statusCategoryOf } = require('../../utils/taxonomyMeta');
const { applyPatchWithHistory, TRACKED_FIELDS, PASSTHROUGH_FIELDS } = require('../../utils/taskHistory');
const { hoursOf, secondsToDuration } = require('../../utils/duration');
const { compareVersions } = require('../../utils/versions');
const { normalizeName, slug, sha1, stableStringify, normalizeText, importError } = require('./text');
const { suggestMapping } = require('./suggest');

/*
 * Jira import engine. One code path computes the full plan (dry-run) and, when
 * dryRun is false, writes it: taxonomies → counter → created tasks → updated
 * tasks → project → job report. No Mongo transaction is assumed; rollback
 * relies on the ImportJob record.
 */

const DEFAULT_OPTIONS = {
  mode: 'upsert', // 'create' skips tasks already imported
  importComments: true,
  componentToArea: true,
  hoursPerDay: 8,
  setCurrentSprint: true,
  site: null,
};
const ROW_REPORT_CAP = 5000;
// Colors given to values created by an import (categories, domains, types…), cycled per kind.
const PALETTE = ['#6b78ea', '#7ecb98', '#e6c46a', '#e85d70', '#b39ddb', '#e0a458', '#9db4dd', '#4fb3bf', '#f28fad', '#a3be8c', '#d08770', '#88c0d0'];
const SPRINT_STATE_TO_STATUS = { closed: 'finished', future: 'draft', active: 'active' };
const EXTRA_FIELDS = ['components', 'fixVersions', 'affectsVersions', 'sprintHistory', 'timeOriginalEstimateSec', 'timeRemainingSec', 'timeSpentSec', 'resolution', 'resolvedAt'];

const padId = (projectKey, n) => `${projectKey}-${String(n).padStart(3, '0')}`;
const toIso = (v) => {
  if (!v) return undefined;
  const d = new Date(String(v).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
const trailingNumber = (name) => {
  const m = /(\d+)\s*$/.exec(name || '');
  return m ? +m[1] : null;
};

// Snapshot comparable across ObjectId / Date / Mongoose arrays.
function plainValue(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'object' && v._bsontype === 'ObjectId') return String(v);
  if (typeof v === 'object' && typeof v.toHexString === 'function') return v.toHexString();
  return v;
}
const sameValue = (a, b) => stableStringify(plainValue(a)) === stableStringify(plainValue(b));

function mergeMapping(suggested, input = {}) {
  const out = {};
  for (const section of ['statuses', 'priorities', 'types', 'people', 'sprints', 'fields']) {
    out[section] = { ...(suggested[section] || {}), ...((input && input[section]) || {}) };
  }
  return out;
}

function taxonomyIndex(list) {
  const items = list.map((t) => ({ ...t, meta: { ...(t.meta || {}) } }));
  return {
    of: (kind) => items.filter((t) => t.kind === kind),
    get: (kind, key) => items.find((t) => t.kind === kind && t.key === key),
    byName: (kind, name) =>
      items.find((t) => t.kind === kind && (normalizeName(t.label) === normalizeName(name) || normalizeName(t.key) === normalizeName(name))),
    uniqueKey(kind, base) {
      const root = base || kind;
      let key = root;
      for (let i = 2; items.some((t) => t.kind === kind && t.key === key); i++) key = `${root}-${i}`;
      return key;
    },
    nextOrder: (kind) => items.filter((t) => t.kind === kind).reduce((m, t) => Math.max(m, t.order || 0), -1) + 1,
    add(doc) {
      items.push(doc);
      return doc;
    },
  };
}

// CSV exports only carry sprint names: infer closed / active / future (see spec §2.4.3).
function resolveSprintStates(sprints, issues, warn) {
  const appearance = new Map();
  let seq = 0;
  for (const i of issues) for (const s of i.sprints) if (!appearance.has(normalizeName(s.name))) appearance.set(normalizeName(s.name), seq++);
  for (const s of sprints) if (!appearance.has(normalizeName(s.name))) appearance.set(normalizeName(s.name), seq++);
  const byNum = (a, b) =>
    (trailingNumber(a.name) ?? Infinity) - (trailingNumber(b.name) ?? Infinity) ||
    appearance.get(normalizeName(a.name)) - appearance.get(normalizeName(b.name));

  const unknown = sprints.filter((s) => !s.state);
  if (unknown.length) {
    const hasSuccessor = new Set();
    for (const i of issues) i.sprints.slice(0, -1).forEach((s) => hasSuccessor.add(normalizeName(s.name)));
    for (const s of unknown) if (hasSuccessor.has(normalizeName(s.name))) s.state = 'closed';
    const remaining = unknown.filter((s) => !s.state).sort(byNum);
    let decided = false;
    remaining.forEach((s, idx) => {
      if (decided) {
        s.state = 'future';
        return;
      }
      const its = issues.filter((i) => i.sprints.some((x) => normalizeName(x.name) === normalizeName(s.name)));
      if (its.length && its.every((i) => i.status.category === 'done') && idx < remaining.length - 1) {
        s.state = 'closed';
        return;
      }
      s.state = its.some((i) => i.status.category !== 'todo') ? 'active' : 'future';
      decided = true;
    });
    unknown.forEach((s) => {
      s.stateSource = 'heuristic';
    });
    warn('SPRINT_STATE_GUESSED', `${unknown.length} sprint(s) : état déduit (l'export CSV ne contient pas l'état des sprints).`);
  }
  const withoutDates = sprints.filter((s) => !s.startDate).length;
  if (withoutDates) warn('SPRINT_DATES_MISSING', `${withoutDates} sprint(s) sans dates : complétez-les dans Paramètres → Sprints ou fournissez le JSON des sprints.`);

  const stateRank = { closed: 0, active: 1, future: 2 };
  return [...sprints].sort((a, b) => {
    const da = a.startDate ? Date.parse(a.startDate) : null;
    const db = b.startDate ? Date.parse(b.startDate) : null;
    if (da !== null && db !== null && da !== db) return da - db;
    return (stateRank[a.state] ?? 3) - (stateRank[b.state] ?? 3) || byNum(a, b);
  });
}

// Current sprint of an issue: its open sprint, else the closed sprint it was finished in, else backlog.
function assignSprint(refs, isDone, rank) {
  const chrono = [...new Map(refs.map((r) => [r.key, r])).values()].sort((a, b) => rank.get(a.key) - rank.get(b.key));
  const history = chrono.map((s) => s.key);
  const open = chrono.filter((s) => s.state !== 'closed');
  const closed = chrono.filter((s) => s.state === 'closed');
  let current = null;
  if (open.length) current = (open.find((s) => s.state === 'active') || open[open.length - 1]).key;
  else if (closed.length && isDone) current = closed[closed.length - 1].key;
  return { sprint: current, sprintHistory: history };
}

function primaryVersion(infos) {
  if (!infos.length) return null;
  const cmpDate = (a, b) => (a ? Date.parse(a) : Infinity) - (b ? Date.parse(b) : Infinity);
  const unreleased = infos.filter((v) => !v.released);
  if (unreleased.length) return [...unreleased].sort((a, b) => cmpDate(a.releaseDate, b.releaseDate) || compareVersions(a.key, b.key))[0].key;
  return [...infos].sort((a, b) => cmpDate(b.releaseDate, a.releaseDate) || compareVersions(b.key, a.key))[0].key;
}

async function runJiraImport({ project, user, bundle, mapping: mappingInput, options: optionsInput, dryRun = true }) {
  const options = { ...DEFAULT_OPTIONS, ...(optionsInput || {}) };
  const hoursPerDay = Number(options.hoursPerDay) || 8;
  const [taxonomies, users, projectTasks, counter] = await Promise.all([
    Taxonomy.find({ project: project._id }).lean(),
    User.find({}, { passwordHash: 0 }).lean(),
    Task.find({ project: project._id }, { taskId: 1, external: 1, 'comments.externalId': 1 }).lean(),
    Counter.findById(project.key).lean(),
  ]);
  const suggestion = suggestMapping({ bundle, taxonomies, users });
  const mapping = mergeMapping(suggestion.mapping, mappingInput);

  const warnings = new Map();
  const warn = (code, message, row) => {
    const w = warnings.get(code) || { code, message, count: 0, rows: [] };
    w.count += 1;
    if (row && w.rows.length < 50) w.rows.push(row);
    warnings.set(code, w);
  };
  const valid = bundle.issues.filter((i) => !i.errors.length);
  const invalid = bundle.issues.filter((i) => i.errors.length);
  for (const i of bundle.issues) for (const w of i.warnings) warn(w.code, w.message, i.row);

  const tax = taxonomyIndex(taxonomies);
  const createdTaxonomies = [];
  const taxonomiesCreated = { status: [], priority: [], type: [], sprint: [], version: [], area: [], category: [], techno: [] };
  const createTaxonomy = (kind, baseKey, fields) => {
    const doc = tax.add({
      kind,
      key: tax.uniqueKey(kind, baseKey),
      label: fields.label,
      color: fields.color || PALETTE[tax.of(kind).length % PALETTE.length],
      order: tax.nextOrder(kind),
      meta: fields.meta || {},
      archived: false,
      _new: true,
    });
    createdTaxonomies.push(doc);
    taxonomiesCreated[kind].push(doc.key);
    return doc;
  };

  // ---- Dimension values (status / priority / type) ----
  const sections = { status: 'statuses', priority: 'priorities', type: 'types' };
  const missing = { statuses: [], priorities: [], types: [] };
  const resolved = { status: new Map(), priority: new Map(), type: new Map() };
  const userById = new Map(users.filter((u) => u.active !== false).map((u) => [String(u._id), u]));
  function resolveDimension(kind, name, category) {
    if (!name) return null;
    if (resolved[kind].has(name)) return resolved[kind].get(name);
    const value = mapping[sections[kind]][name];
    let key = null;
    if (typeof value === 'string' && value) {
      if (tax.get(kind, value)) key = value;
      else missing[sections[kind]].push(name);
    } else if (value && value.create) {
      const c = value.create;
      const cat = ['todo', 'inprogress', 'done'].includes(c.category) ? c.category : category || 'todo';
      const meta = kind === 'status' ? { category: cat, isDone: cat === 'done', jiraName: name } : { ...(c.meta || {}), jiraName: name };
      key = createTaxonomy(kind, c.key || slug(c.label || name) || kind, { label: c.label || name, color: c.color, meta }).key;
    } else {
      missing[sections[kind]].push(name);
    }
    resolved[kind].set(name, key);
    return key;
  }
  for (const i of valid) {
    resolveDimension('status', i.status.name, i.status.category);
    resolveDimension('priority', i.priority);
    resolveDimension('type', i.type.name);
  }
  if (missing.statuses.length || missing.priorities.length || missing.types.length) {
    throw importError(422, 'MAPPING_INCOMPLETE', 'Certaines valeurs Jira ne sont associées à aucune valeur Kýdos.', { missing });
  }
  const categoryOf = (key) => statusCategoryOf(tax.get('status', key) || { key });
  const fallbackStatus =
    project.defaults?.status || tax.of('status').filter((s) => !s.archived).sort((a, b) => a.order - b.order).find((s) => statusCategoryOf(s) === 'todo')?.key;

  // ---- Sprints ----
  const sprintList = resolveSprintStates([...bundle.sprints.values()].map((s) => ({ ...s })), valid, warn);
  const projectHasActive = tax.of('sprint').some((t) => !t.archived && t.meta?.status === 'active');
  const jiraActive = sprintList.filter((s) => s.state === 'active').sort((a, b) => Date.parse(b.startDate || 0) - Date.parse(a.startDate || 0));
  if (jiraActive.length > 1) warn('MULTIPLE_ACTIVE_SPRINTS', 'Plusieurs sprints actifs dans Jira : seul le plus récent devient actif.');
  let newCurrentSprint = null;
  const sprintPatches = [];
  const sprintByName = new Map();
  const sprintByJiraId = new Map();
  for (const s of sprintList) {
    const override = mapping.sprints?.[s.name] || {};
    const state = override.state || s.state || 'future';
    const dates = { startDate: toIso(override.startDate || s.startDate), endDate: toIso(override.endDate || s.endDate) };
    let doc = tax
      .of('sprint')
      .find((t) => (s.jiraId !== null && s.jiraId !== undefined && String(t.meta?.jiraId) === String(s.jiraId)) || normalizeName(t.label) === normalizeName(s.name));
    if (!doc) {
      let status = SPRINT_STATE_TO_STATUS[state] || 'draft';
      if (status === 'active') {
        if (projectHasActive || newCurrentSprint || jiraActive[0] !== s) {
          status = 'ready';
          warn('ACTIVE_SPRINT_CONFLICT', `« ${s.name} » est actif dans Jira mais un autre sprint est actif : importé comme « prêt ».`);
        }
      }
      doc = createTaxonomy('sprint', slug(s.name) || 'sprint', {
        label: s.name,
        meta: {
          status,
          ...(dates.startDate ? { startDate: dates.startDate } : {}),
          ...(dates.endDate ? { endDate: dates.endDate } : {}),
          goal: override.goal ?? s.goal ?? '',
          ...(s.jiraId !== null && s.jiraId !== undefined ? { jiraId: s.jiraId } : {}),
          ...(s.completeDate ? { closedAt: toIso(s.completeDate) } : {}),
          source: 'jira',
          stateSource: s.stateSource || 'jira',
        },
      });
      if (status === 'active') newCurrentSprint = doc.key;
    } else {
      const patch = {};
      if (!doc.meta?.startDate && dates.startDate) patch.startDate = dates.startDate;
      if (!doc.meta?.endDate && dates.endDate) patch.endDate = dates.endDate;
      if (!doc.meta?.goal && s.goal) patch.goal = s.goal;
      if (doc.meta?.jiraId === undefined && s.jiraId !== null && s.jiraId !== undefined) patch.jiraId = s.jiraId;
      if (Object.keys(patch).length && !doc._new) {
        sprintPatches.push({ id: doc._id, patch });
        Object.assign(doc.meta, patch);
      }
    }
    s.key = doc.key;
    s.state = state;
    sprintByName.set(normalizeName(s.name), s);
    if (s.jiraId !== null && s.jiraId !== undefined) sprintByJiraId.set(String(s.jiraId), s);
  }
  const sprintRank = new Map(sprintList.map((s, i) => [s.key, i]));
  const sprintEndOf = (key) => {
    const doc = tax.get('sprint', key);
    return doc?.meta?.closedAt || doc?.meta?.endDate || null;
  };

  // ---- Versions ----
  const versionByName = new Map();
  let versionMetaMissing = 0;
  for (const v of bundle.versions.values()) {
    const used = valid.some((i) => i.fixVersions.includes(v.name) || i.affectsVersions.includes(v.name));
    let doc = tax.get('version', v.name) || tax.byName('version', v.name);
    if (!doc) {
      if (v.archived && !used) continue;
      if (v.released === null || v.released === undefined) versionMetaMissing += 1;
      doc = createTaxonomy('version', v.name.trim(), {
        label: v.name,
        meta: {
          status: v.released ? 'released' : 'unreleased',
          ...(v.releaseDate ? { releaseDate: toIso(v.releaseDate) } : {}),
          ...(v.startDate ? { startDate: toIso(v.startDate) } : {}),
          ...(v.released && v.releaseDate ? { releasedAt: toIso(v.releaseDate) } : {}),
          ...(v.description ? { description: v.description } : {}),
          ...(v.jiraId ? { jiraId: v.jiraId } : {}),
        },
      });
      if (v.archived) doc.archived = true;
    }
    versionByName.set(v.name, {
      key: doc.key,
      released: doc.meta?.status === 'released' || v.released === true,
      releaseDate: v.releaseDate || doc.meta?.releaseDate || null,
    });
  }
  if (versionMetaMissing) warn('VERSION_META_MISSING', `${versionMetaMissing} version(s) sans statut de publication : fournissez le JSON des versions pour les compléter.`);

  const areaKeyFor = (component) => {
    if (!component || !options.componentToArea) return null;
    return (tax.byName('area', component) || createTaxonomy('area', slug(component) || 'area', { label: component })).key;
  };

  // Text custom field chosen in the mapping (e.g. Jira « Catégorie ») → Kýdos category / techno value, created if missing.
  const fieldTaxonomyKey = (kind, issue) => {
    const field = mapping.fields?.[kind];
    const value = field ? issue.texts?.[field] : null;
    if (!value) return null;
    return (tax.byName(kind, value) || createTaxonomy(kind, slug(value) || kind, { label: value })).key;
  };

  // ---- Identifier plan ----
  const existingIds = new Set(projectTasks.map((t) => t.taskId));
  const byExtId = new Map();
  const byExtKey = new Map();
  for (const t of projectTasks) {
    if (t.external?.source !== 'jira') continue;
    if (t.external.id) byExtId.set(String(t.external.id), t);
    if (t.external.key) byExtKey.set(t.external.key, t);
  }
  const parseKey = (k) => {
    const m = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(k || '');
    return m ? { prefix: m[1].toUpperCase(), n: +m[2] } : null;
  };
  const plans = valid.map((issue) => ({
    issue,
    existing: (issue.externalId && byExtId.get(String(issue.externalId))) || (issue.externalKey && byExtKey.get(issue.externalKey)) || null,
  }));
  plans.sort((a, b) => {
    const pa = parseKey(a.issue.externalKey);
    const pb = parseKey(b.issue.externalKey);
    return (pa?.prefix || '').localeCompare(pb?.prefix || '') || (pa?.n ?? 0) - (pb?.n ?? 0) || a.issue.row - b.issue.row;
  });
  const reserved = new Set();
  const pending = [];
  let maxKept = 0;
  let kept = 0;
  for (const plan of plans) {
    if (plan.existing) {
      plan.taskId = plan.existing.taskId;
      continue;
    }
    const parsed = parseKey(plan.issue.externalKey);
    if (parsed && parsed.prefix === project.key) {
      const candidate = padId(project.key, parsed.n);
      if (!existingIds.has(candidate) && !existingIds.has(`${project.key}-${parsed.n}`) && !reserved.has(candidate)) {
        plan.taskId = candidate;
        reserved.add(candidate);
        maxKept = Math.max(maxKept, parsed.n);
        kept += 1;
        continue;
      }
      warn('ID_RENUMBERED', 'Identifiant déjà utilisé dans le projet : ticket renuméroté.', plan.issue.row);
    }
    pending.push(plan);
  }
  let seq = Math.max(counter?.seq || 0, maxKept);
  for (const plan of pending) {
    do seq += 1;
    while (existingIds.has(padId(project.key, seq)) || reserved.has(padId(project.key, seq)));
    plan.taskId = padId(project.key, seq);
    reserved.add(plan.taskId);
  }
  const taskIdByExtId = new Map();
  const taskIdByExtKey = new Map();
  for (const t of projectTasks) {
    if (t.external?.source !== 'jira') continue;
    if (t.external.id) taskIdByExtId.set(String(t.external.id), t.taskId);
    if (t.external.key) taskIdByExtKey.set(t.external.key, t.taskId);
  }
  for (const p of plans) {
    if (p.issue.externalId) taskIdByExtId.set(String(p.issue.externalId), p.taskId);
    if (p.issue.externalKey) taskIdByExtKey.set(p.issue.externalKey, p.taskId);
  }

  // ---- Mapped task values ----
  const spField = mapping.fields?.storyPoints || null;
  const personUser = (p) => {
    if (!p) return null;
    const id = mapping.people[p.ref];
    return id ? userById.get(String(id)) || null : null;
  };
  const counts = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: invalid.length, warnings: 0 };
  for (const plan of plans) {
    const { issue } = plan;
    const status = resolved.status.get(issue.status.name) || fallbackStatus;
    const refs = issue.sprints.map((s) => (s.jiraId !== null && s.jiraId !== undefined && sprintByJiraId.get(String(s.jiraId))) || sprintByName.get(normalizeName(s.name))).filter(Boolean);
    const { sprint, sprintHistory } = assignSprint(refs, issue.status.category === 'done', sprintRank);
    const assignee = personUser(issue.assignee);
    let parent = null;
    if (issue.parent) {
      parent = (issue.parent.id && taskIdByExtId.get(String(issue.parent.id))) || (issue.parent.key && taskIdByExtKey.get(issue.parent.key)) || null;
      if (!parent) warn('PARENT_NOT_FOUND', 'Ticket parent absent de l’import : lien ignoré.', issue.row);
    }
    const fixInfos = issue.fixVersions.map((n) => ({ ...versionByName.get(n) })).filter((v) => v.key);
    plan.mapped = {
      title: issue.summary.slice(0, 500),
      description: issue.description,
      acceptance: issue.acceptance,
      type: resolved.type.get(issue.type.name) || null,
      status,
      priority: resolved.priority.get(issue.priority) || null,
      sprint,
      sprintHistory,
      version: primaryVersion(fixInfos),
      fixVersions: fixInfos.map((v) => v.key),
      affectsVersions: issue.affectsVersions.map((n) => versionByName.get(n)?.key).filter(Boolean),
      components: issue.components,
      area: areaKeyFor(issue.components[0]),
      category: fieldTaxonomyKey('category', issue),
      techno: fieldTaxonomyKey('techno', issue),
      labels: issue.labels,
      complexity: spField && Number.isFinite(Number(issue.numbers[spField])) ? Number(issue.numbers[spField]) : 0,
      estimate: secondsToDuration(issue.originalEstimateSec, hoursPerDay),
      duration: secondsToDuration(issue.timeSpentSec, hoursPerDay),
      timeOriginalEstimateSec: issue.originalEstimateSec,
      timeRemainingSec: issue.remainingEstimateSec,
      timeSpentSec: issue.timeSpentSec,
      assignee: assignee ? String(assignee._id) : null,
      parent,
      dueDate: issue.dueDate || null,
      resolution: issue.resolution || null,
      resolvedAt: issue.resolved ? issue.resolved.toISOString() : categoryOf(status) === 'done' && issue.updated ? issue.updated.toISOString() : null,
    };
    plan.hash = sha1(stableStringify(plan.mapped));
    plan.assigneeName = !assignee && issue.assignee ? issue.assignee.displayName || issue.assignee.accountId : undefined;
    plan.reporterUser = personUser(issue.reporter);
    plan.reporterName = issue.reporter ? issue.reporter.displayName || issue.reporter.accountId : undefined;
    plan.comments = options.importComments
      ? issue.comments
          .filter((c) => c.body && c.body.trim())
          .map((c) => {
            const author = personUser(c.author);
            const minute = c.created ? new Date(Math.floor(c.created.getTime() / 60000) * 60000).toISOString() : '';
            const fingerprint = `fp:${sha1(`${minute}|${c.author?.ref || ''}|${normalizeText(c.body).slice(0, 200)}`)}`;
            const createdAt = c.created || issue.created || new Date();
            return {
              externalId: c.externalId || fingerprint,
              fingerprint,
              author: author ? author._id : null,
              ...(author ? {} : { authorLabel: c.author?.displayName || c.author?.accountId || 'Jira' }),
              text: c.body,
              createdAt,
              updatedAt: c.updated || createdAt,
            };
          })
      : [];

    if (!plan.existing) {
      plan.action = 'create';
    } else if (options.mode === 'create') {
      plan.action = 'skip';
    } else {
      const known = new Set((plan.existing.comments || []).map((c) => c.externalId).filter(Boolean));
      plan.newComments = plan.comments.filter((c) => !known.has(c.externalId) && !known.has(c.fingerprint));
      plan.action = plan.existing.external?.importHash === plan.hash && !plan.newComments.length ? 'unchanged' : 'update';
    }
    counts[{ create: 'created', update: 'updated', unchanged: 'unchanged', skip: 'skipped' }[plan.action]] += 1;
  }

  // Velocity for sprints closed in Jira and created by this import.
  for (const s of sprintList) {
    const doc = tax.get('sprint', s.key);
    if (!doc?._new || doc.meta.status !== 'finished') continue;
    const inSprint = plans.filter((p) => p.mapped.sprintHistory.includes(s.key));
    const completed = inSprint.filter((p) => p.mapped.sprint === s.key && categoryOf(p.mapped.status) === 'done');
    const carried = inSprint.filter((p) => p.mapped.sprint !== s.key);
    const pts = (list) => list.reduce((a, p) => a + (p.mapped.complexity || 0), 0);
    doc.meta.report = {
      committedPoints: pts(inSprint),
      committedCount: inSprint.length,
      completedPoints: pts(completed),
      completedCount: completed.length,
      carriedOverTaskIds: carried.map((p) => p.taskId),
      carriedOverPoints: pts(carried),
      carriedTo: null,
      keptTaskIds: [],
      source: 'import',
    };
  }

  const currentSprint = options.setCurrentSprint && newCurrentSprint && !projectHasActive ? newCurrentSprint : null;
  counts.warnings = [...warnings.values()].reduce((a, w) => a + w.count, 0);
  const rows = [
    ...invalid.map((i) => ({ row: i.row, externalKey: i.externalKey, externalId: i.externalId, action: 'error', taskId: null, errors: i.errors.map((e) => e.code), warnings: [] })),
    ...plans.map((p) => ({
      row: p.issue.row,
      externalKey: p.issue.externalKey,
      externalId: p.issue.externalId,
      action: p.action,
      taskId: p.taskId,
      title: p.mapped.title,
      errors: [],
      warnings: p.issue.warnings.map((w) => w.code),
    })),
  ].sort((a, b) => a.row - b.row);

  const result = {
    dryRun,
    jobId: null,
    counts,
    rows,
    warnings: [...warnings.values()],
    taxonomiesCreated,
    currentSprint,
    idPlan: { projectKey: project.key, kept, renumbered: pending.length, reused: plans.filter((p) => p.existing).length, counterSeq: seq },
    files: bundle.files,
    entities: suggestion.entities,
    mapping,
  };
  if (dryRun) return result;

  // ======================= Execution =======================
  const running = await ImportJob.exists({ project: project._id, status: 'running', updatedAt: { $gt: new Date(Date.now() - 15 * 60000) } });
  if (running) throw importError(409, 'IMPORT_IN_PROGRESS', 'Un import est déjà en cours sur ce projet.');
  const job = await ImportJob.create({ project: project._id, createdBy: user._id, files: bundle.files, options, mapping, status: 'running' });
  let writeErrors = 0;
  try {
    if (createdTaxonomies.length) {
      const docs = await Taxonomy.insertMany(createdTaxonomies.map(({ _new, ...t }) => ({ ...t, project: project._id })));
      job.taxonomiesCreated = docs.map((d) => ({ id: d._id, kind: d.kind, key: d.key }));
    }
    for (const { id, patch } of sprintPatches) {
      await Taxonomy.updateOne({ _id: id }, { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`meta.${k}`, v])) });
    }
    await Counter.findByIdAndUpdate(project.key, { $max: { seq } }, { upsert: true });

    const createDoc = (plan) => {
      const m = plan.mapped;
      const { issue } = plan;
      const createdAt = issue.created || new Date();
      const updatedAt = issue.updated || createdAt;
      const history = [
        { at: createdAt, by: user._id, byLabel: user.displayName, field: 'created', from: null, to: m.status, note: `Importée depuis Jira (${issue.externalKey || issue.externalId}).` },
      ];
      for (let k = 1; k < m.sprintHistory.length; k++) {
        const from = m.sprintHistory[k - 1];
        history.push({ at: new Date(sprintEndOf(from) || createdAt), byLabel: 'Import Jira', field: 'sprint', from, to: m.sprintHistory[k], note: 'Report (historique Jira).' });
      }
      const last = m.sprintHistory[m.sprintHistory.length - 1];
      if (last && m.sprint !== last) {
        history.push({ at: new Date(sprintEndOf(last) || updatedAt), byLabel: 'Import Jira', field: 'sprint', from: last, to: m.sprint, note: 'Retour au backlog (historique Jira).' });
      }
      if (m.resolvedAt) history.push({ at: new Date(m.resolvedAt), byLabel: 'Import Jira', field: 'status', from: null, to: m.status, note: 'Résolue dans Jira.' });
      const url = issue.url || (options.site && issue.externalKey ? `${String(options.site).replace(/\/$/, '')}/browse/${issue.externalKey}` : undefined);
      return {
        project: project._id,
        taskId: plan.taskId,
        title: m.title,
        description: m.description,
        acceptance: m.acceptance,
        instructions: [],
        type: m.type || undefined,
        status: m.status,
        priority: m.priority || undefined,
        sprint: m.sprint,
        version: m.version || undefined,
        area: m.area || undefined,
        category: m.category || undefined,
        techno: m.techno || undefined,
        labels: m.labels,
        parent: m.parent,
        components: m.components,
        fixVersions: m.fixVersions,
        affectsVersions: m.affectsVersions,
        sprintHistory: m.sprintHistory,
        complexity: m.complexity,
        estimate: m.estimate,
        duration: m.duration,
        durationHours: hoursOf(m.duration),
        timeOriginalEstimateSec: m.timeOriginalEstimateSec ?? undefined,
        timeRemainingSec: m.timeRemainingSec ?? undefined,
        timeSpentSec: m.timeSpentSec ?? undefined,
        assignee: m.assignee,
        reporter: plan.reporterUser?._id || user._id,
        dueDate: m.dueDate ? new Date(`${m.dueDate}T00:00:00.000Z`) : null,
        resolution: m.resolution || undefined,
        resolvedAt: m.resolvedAt ? new Date(m.resolvedAt) : null,
        statusChangedAt: m.resolvedAt ? new Date(m.resolvedAt) : updatedAt,
        external: {
          source: 'jira',
          key: issue.externalKey || undefined,
          id: issue.externalId || undefined,
          url,
          importJob: job._id,
          assigneeName: plan.assigneeName,
          reporterName: plan.reporterUser ? undefined : plan.reporterName,
          importHash: plan.hash,
        },
        comments: plan.comments.map(({ fingerprint, ...c }) => c),
        history,
        createdAt,
        updatedAt,
      };
    };

    const rowByPlan = new Map(rows.map((r) => [`${r.row}`, r]));
    const creations = plans.filter((p) => p.action === 'create');
    for (let k = 0; k < creations.length; k += 500) {
      const chunk = creations.slice(k, k + 500);
      try {
        const inserted = await Task.insertMany(chunk.map(createDoc), { timestamps: false });
        job.createdTaskIds.push(...inserted.map((d) => d._id));
      } catch {
        // Retry one by one to attribute failures to their rows.
        for (const plan of chunk) {
          try {
            const [doc] = await Task.insertMany([createDoc(plan)], { timestamps: false });
            job.createdTaskIds.push(doc._id);
          } catch (e) {
            writeErrors += 1;
            const row = rowByPlan.get(`${plan.issue.row}`);
            if (row) {
              row.action = 'error';
              row.errors.push(e.code === 11000 ? 'DUPLICATE_ID' : 'WRITE_FAILED');
            }
          }
        }
      }
    }

    const trackedPatchFields = new Set([...TRACKED_FIELDS, ...PASSTHROUGH_FIELDS]);
    for (const plan of plans.filter((p) => p.action === 'update')) {
      const task = await Task.findById(plan.existing._id);
      if (!task) continue;
      const m = plan.mapped;
      const before = {};
      const after = {};
      if (task.external?.importHash !== plan.hash) {
        const patch = {};
        for (const [f, v] of Object.entries(m)) {
          if (['area', 'category', 'techno'].includes(f) && !v) continue; // never wipe local values Jira does not provide
          if (trackedPatchFields.has(f)) patch[f] = v;
        }
        for (const f of [...Object.keys(patch), ...EXTRA_FIELDS]) {
          const next = f in patch ? patch[f] : m[f];
          if (!sameValue(task[f], next)) {
            before[f] = plainValue(task[f]);
            after[f] = plainValue(next);
          }
        }
        applyPatchWithHistory(task, patch, user, `Ré-import Jira (${bundle.files.map((f) => f.name).join(', ')}).`, { categoryOf });
        for (const f of EXTRA_FIELDS) {
          if (f === 'resolvedAt') task.resolvedAt = m.resolvedAt ? new Date(m.resolvedAt) : null;
          else task[f] = m[f] ?? undefined;
        }
        task.set('external.importHash', plan.hash);
        task.set('external.importJob', job._id);
        task.set('external.assigneeName', plan.assigneeName);
      }
      const added = (plan.newComments || []).map(({ fingerprint, ...c }) => c);
      task.comments.push(...added);
      task.updatedAt = new Date();
      await task.save({ timestamps: false });
      job.updates.push({ task: task._id, before, after, commentIds: added.map((c) => c.externalId) });
    }

    if (currentSprint) await Project.updateOne({ _id: project._id }, { $set: { currentSprint } });

    counts.errors += writeErrors;
    job.status = writeErrors ? 'partial' : 'completed';
    job.counts = counts;
    job.rows = rows.slice(0, ROW_REPORT_CAP);
    job.warnings = result.warnings;
    job.finishedAt = new Date();
    await job.save();
    return { ...result, jobId: job._id, status: job.status };
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = new Date();
    await job.save().catch(() => {});
    throw err;
  }
}

// Undo the latest import: delete untouched created tasks, restore updated
// fields still holding imported values, remove imported comments and unused taxonomies.
async function rollbackImport({ project, user, jobId }) {
  const job = await ImportJob.findOne({ _id: jobId, project: project._id });
  if (!job) throw importError(404, 'JOB_NOT_FOUND', 'Import introuvable.');
  if (!['completed', 'partial'].includes(job.status)) throw importError(409, 'ROLLBACK_NOT_ALLOWED', 'Cet import ne peut pas être annulé.');
  const latest = await ImportJob.findOne({ project: project._id, status: { $in: ['completed', 'partial'] } }).sort({ createdAt: -1 });
  if (String(latest._id) !== String(job._id)) {
    throw importError(409, 'ROLLBACK_NOT_LATEST', 'Seul le dernier import peut être annulé.');
  }
  const report = { tasksDeleted: 0, tasksKept: [], tasksRestored: 0, taxonomiesDeleted: 0, taxonomiesArchived: 0 };

  const createdTasks = await Task.find({ _id: { $in: job.createdTaskIds } }, { taskId: 1, updatedAt: 1 }).lean();
  const deletable = createdTasks.filter((t) => t.updatedAt <= job.finishedAt);
  report.tasksKept = createdTasks.filter((t) => t.updatedAt > job.finishedAt).map((t) => ({ taskId: t.taskId, reason: "modifiée depuis l'import" }));
  if (deletable.length) report.tasksDeleted = (await Task.deleteMany({ _id: { $in: deletable.map((t) => t._id) } })).deletedCount;

  const { categoryOf } = await require('../../utils/taxonomyMeta').statusContext(project._id);
  const tracked = new Set([...TRACKED_FIELDS, ...PASSTHROUGH_FIELDS]);
  for (const u of job.updates) {
    const task = await Task.findById(u.task);
    if (!task) continue;
    const patch = {};
    for (const [f, value] of Object.entries(u.before || {})) {
      if (!sameValue(task[f], u.after?.[f])) continue; // changed again locally: keep
      if (tracked.has(f)) patch[f] = value;
      else if (f === 'resolvedAt') task.resolvedAt = value ? new Date(value) : null;
      else task[f] = value ?? undefined;
    }
    applyPatchWithHistory(task, patch, user, "Annulation de l'import Jira.", { categoryOf });
    const ids = new Set(u.commentIds || []);
    task.comments = task.comments.filter((c) => !ids.has(c.externalId));
    task.set('external.importHash', undefined);
    await task.save();
    report.tasksRestored += 1;
  }

  const p = await Project.findById(project._id);
  for (const t of job.taxonomiesCreated) {
    const doc = await Taxonomy.findById(t.id);
    if (!doc) continue;
    const field = t.kind === 'version' ? { $or: [{ version: t.key }, { fixVersions: t.key }, { affectsVersions: t.key }] } : t.kind === 'sprint' ? { $or: [{ sprint: t.key }, { sprintHistory: t.key }] } : { [t.kind]: t.key };
    const used = await Task.exists({ project: project._id, ...field });
    if (used) {
      doc.archived = true;
      await doc.save();
      report.taxonomiesArchived += 1;
    } else {
      await doc.deleteOne();
      report.taxonomiesDeleted += 1;
      if (t.kind === 'sprint' && p.currentSprint === t.key) p.currentSprint = null;
    }
  }
  if (p.isModified()) await p.save();

  job.status = 'rolledBack';
  job.rollback = { ...report, at: new Date(), by: user._id };
  await job.save();
  return report;
}

module.exports = { runJiraImport, rollbackImport, resolveSprintStates, assignSprint, primaryVersion };
