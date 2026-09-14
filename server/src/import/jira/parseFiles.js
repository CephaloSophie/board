const { parseCsv } = require('../csv');
const { createDateParser, toDateOnly } = require('./dates');
const { adfToText, wikiToText, extractAcceptance } = require('./markup');
const { normalizeName, sha1, importError } = require('./text');
const { isJiraExternalJson, convertExternalJson } = require('./externalJson');

/*
 * Turns the uploaded files into one normalized bundle, whatever the source:
 *   { files, issues: NormalizedIssue[], people: Map<ref, person>, sprints: Map, versions: Map, fields, warnings }
 * NormalizedIssue fields: row, externalId, externalKey, projectKey, url, summary, description,
 * acceptance, type {name, subtask, hierarchyLevel}, status {name, category, guessed}, priority,
 * resolution, assignee, reporter, created, updated, resolved, dueDate, fixVersions[], affectsVersions[],
 * components[], labels[], sprints[] (source order), numbers {"cf:story points": 5}, originalEstimateSec,
 * remainingEstimateSec, timeSpentSec, parent {id, key}, flagged, comments[], commentsTotal, warnings, errors.
 */

const MAX_FILES = 5;
const MAX_ISSUES = 10000;

// ---------- Format detection ----------
function detectFile(content) {
  const t = String(content || '').replace(/^﻿/, '').trimStart();
  if (t.startsWith('<?xml') || t.startsWith('<rss')) return { format: 'jira-xml' };
  if (t.startsWith('{') || t.startsWith('[')) {
    let data;
    try {
      data = JSON.parse(t);
    } catch {
      return { format: 'invalid-json' };
    }
    const isIssuesPage = (o) => o && Array.isArray(o.issues) && (!o.issues.length || (o.issues[0].key && o.issues[0].fields));
    if (isJiraExternalJson(data)) return { format: 'jira-external-json', data };
    if (isIssuesPage(data) || (Array.isArray(data) && data.length && data.every(isIssuesPage))) return { format: 'jira-issues-json', data };
    const values = Array.isArray(data) ? data : data.values;
    if (Array.isArray(values) && values.length) {
      if (values[0].name && ['future', 'active', 'closed'].includes(String(values[0].state).toLowerCase())) return { format: 'jira-sprints-json', data: values };
      if (values[0].name && typeof values[0].released === 'boolean') return { format: 'jira-versions-json', data: values };
    }
    return { format: 'unknown-json' };
  }
  return { format: 'csv' };
}

// ---------- Shared helpers ----------
const STATUS_CATEGORY = {
  todo: ['new', 'to do', 'todo', 'a faire', 'ouvert', 'open'],
  inprogress: ['indeterminate', 'in progress', 'en cours'],
  done: ['done', 'termine', 'terminee', 'fait', 'complete'],
};
function categoryFromJira(value) {
  const n = normalizeName(value);
  if (!n) return null;
  for (const [cat, names] of Object.entries(STATUS_CATEGORY)) if (names.includes(n)) return cat;
  return null;
}
const DONE_NAMES = ['done', 'closed', 'resolved', 'termine', 'terminee', 'ferme', 'fait', 'validated', 'accepted', 'valide', 'validee'];
const TODO_NAMES = ['backlog', 'open', 'new', 'nouveau', 'ouvert', 'to do', 'todo', 'a faire', 'selected for development', 'ready', 'pret'];
function guessCategory(statusName, resolution, resolved) {
  const n = normalizeName(statusName);
  if (resolution || resolved || DONE_NAMES.includes(n)) return 'done';
  if (TODO_NAMES.includes(n)) return 'todo';
  return 'inprogress';
}
const normResolution = (v) => (!v || ['unresolved', 'non resolu'].includes(normalizeName(v)) ? null : v);
const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

function parseCommentCell(cell, parseDate) {
  const i1 = cell.indexOf(';');
  const i2 = i1 < 0 ? -1 : cell.indexOf(';', i1 + 1);
  if (i2 > 0) {
    const created = parseDate(cell.slice(0, i1));
    if (created) return { created, authorRef: cell.slice(i1 + 1, i2).trim(), body: cell.slice(i2 + 1) };
  }
  return { created: null, authorRef: null, body: cell, warning: 'COMMENT_NO_META' };
}

function peopleRegistry() {
  const people = new Map();
  const add = (accountId, displayName, email) => {
    if (!accountId && !displayName) return null;
    const ref = accountId || `name:${displayName}`;
    const p = people.get(ref) || { ref, accountId: accountId || null, displayName: null, email: null };
    if (displayName && !p.displayName) p.displayName = displayName;
    if (email && !p.email) p.email = email;
    people.set(ref, p);
    return p;
  };
  return { people, add };
}

function withDescription(rawText, environment, extract) {
  const base = extract ? extractAcceptance(rawText) : { description: rawText, acceptance: [] };
  const description = environment ? `${base.description}${base.description ? '\n\n' : ''}Environnement : ${environment}` : base.description;
  return { description, acceptance: base.acceptance };
}

// ---------- CSV ----------
function normalizeHeader(h) {
  const s = String(h).replace(/^﻿/, '').trim().replace(/\s+/g, ' ');
  const cf = /^custom field \((.+)\)$/i.exec(s);
  if (cf) return `cf:${cf[1].trim().toLowerCase()}`;
  return s
    .replace(/^[Σσ]\s*/, 'sum:')
    .toLowerCase()
    .replace(/ version\/s$/, ' versions')
    .replace(/^component\/s$/, 'components');
}

const ALIASES = {
  summary: ['summary', 'résumé', 'resume'],
  key: ['issue key', 'work item key', 'key', 'clé de ticket'],
  id: ['issue id', 'work item id', 'id'],
  type: ['issue type', 'work type', 'work item type', 'type', 'type de ticket'],
  status: ['status', 'état', 'etat', 'statut'],
  statusCategory: ['status category', 'catégorie d’état', "catégorie d'état"],
  projectKey: ['project key'],
  priority: ['priority', 'priorité'],
  resolution: ['resolution', 'résolution'],
  assignee: ['assignee', 'responsable'],
  assigneeId: ['assignee id'],
  reporter: ['reporter', 'rapporteur'],
  reporterId: ['reporter id'],
  creator: ['creator'],
  creatorId: ['creator id'],
  created: ['created', 'date created', 'création'],
  updated: ['updated', 'date modified', 'mise à jour'],
  resolved: ['resolved', 'resolution date'],
  dueDate: ['due date', 'échéance'],
  affectsVersions: ['affects versions', 'affects version'],
  fixVersions: ['fix versions', 'fix version'],
  components: ['components', 'component', 'composants'],
  labels: ['labels', 'label', 'étiquettes'],
  description: ['description'],
  environment: ['environment'],
  originalEstimate: ['original estimate'],
  remainingEstimate: ['remaining estimate'],
  timeSpent: ['time spent'],
  sprints: ['sprint', 'cf:sprint'],
  parent: ['parent', 'parent id'],
  parentKey: ['parent key'],
  epicLink: ['cf:epic link', 'epic link'],
  flagged: ['cf:flagged', 'flagged'],
  comments: ['comment', 'comment body'],
  watchers: ['watchers'],
  watchersId: ['watchers id'],
};

function parseJiraCsv(content, { timezone, extractAcceptanceCriteria = true }) {
  const { headers, rows, delimiter } = parseCsv(content);
  const norm = headers.map(normalizeHeader);
  const index = new Map();
  for (const [canon, names] of Object.entries(ALIASES)) {
    for (const n of names) {
      const positions = norm.flatMap((h, i) => (h === n ? [i] : []));
      if (positions.length) {
        index.set(canon, positions);
        break;
      }
    }
  }
  if (!index.has('summary') || (!index.has('key') && !index.has('id'))) {
    throw importError(400, 'CSV_NOT_JIRA', 'Ce CSV ne ressemble pas à un export Jira (colonnes « Summary » et « Issue key » attendues).');
  }
  const known = new Set([...index.values()].flat());
  const unmappedColumns = [...new Set(headers.filter((h, i) => !known.has(i) && !norm[i].startsWith('sum:')))];

  const cell = (row, i) => String(row[i] ?? '').trim();
  const one = (row, canon) => {
    for (const i of index.get(canon) || []) {
      const v = cell(row, i);
      if (v) return v;
    }
    return null;
  };
  const many = (row, canon) => [...new Set((index.get(canon) || []).map((i) => cell(row, i)).filter(Boolean))];
  const parseDate = createDateParser(rows.map((r) => one(r, 'created')), { timezone });

  const { people, add } = peopleRegistry();
  for (const row of rows) {
    add(one(row, 'assigneeId'), one(row, 'assignee'));
    add(one(row, 'reporterId'), one(row, 'reporter'));
    add(one(row, 'creatorId'), one(row, 'creator'));
    const names = (index.get('watchers') || []).map((i) => cell(row, i));
    (index.get('watchersId') || []).map((i) => cell(row, i)).forEach((id, k) => id && add(id, names[k] || null));
  }
  const personByRef = (ref) => people.get(ref) || [...people.values()].find((p) => p.displayName === ref) || add(ref, null);

  const cfColumns = norm.flatMap((h, i) => (h.startsWith('cf:') ? [[h, i]] : []));
  const isLabelSingleColumn = (index.get('labels') || []).length === 1;

  const issues = rows.map((row, r) => {
    const warnings = [];
    const errors = [];
    const summary = one(row, 'summary');
    if (!summary) errors.push({ code: 'MISSING_SUMMARY', message: 'Résumé vide : ligne ignorée.' });
    const statusName = one(row, 'status') || '';
    const resolution = normResolution(one(row, 'resolution'));
    const resolved = parseDate(one(row, 'resolved'));
    let category = categoryFromJira(one(row, 'statusCategory'));
    const guessed = !category;
    if (!category) category = guessCategory(statusName, resolution, resolved);
    for (const f of ['created', 'updated', 'resolved']) {
      const raw = one(row, f);
      if (raw && !parseDate(raw)) warnings.push({ code: 'DATE_UNPARSEABLE', message: `Date illisible (${f}) : ${raw}` });
    }
    let labels = many(row, 'labels');
    if (isLabelSingleColumn) labels = [...new Set(labels.flatMap((l) => l.split(/[\s,]+/)).filter(Boolean))];
    const comments = (index.get('comments') || [])
      .map((i) => cell(row, i))
      .filter(Boolean)
      .map((c) => {
        const p = parseCommentCell(c, parseDate);
        if (p.warning) warnings.push({ code: p.warning, message: 'Commentaire sans date ni auteur.' });
        return { externalId: null, author: p.authorRef ? personByRef(p.authorRef) : null, created: p.created, updated: p.created, body: wikiToText(p.body) };
      });
    const parentValue = one(row, 'parent');
    const parentKey = one(row, 'parentKey') || one(row, 'epicLink');
    let parent = null;
    if (parentValue) parent = /^\d+$/.test(parentValue) ? { id: parentValue, key: null } : { id: null, key: parentValue };
    else if (parentKey) parent = { id: null, key: parentKey };
    const numbers = {};
    const texts = {};
    for (const [h, i] of cfColumns) {
      const raw = cell(row, i);
      const n = toNumber(raw);
      if (n !== null && /^-?[\d.,]+$/.test(raw)) numbers[h] = n;
      else if (raw) texts[h] = raw;
    }
    const key = one(row, 'key');
    const assigneeId = one(row, 'assigneeId');
    const assigneeName = one(row, 'assignee');
    const reporterId = one(row, 'reporterId');
    const reporterName = one(row, 'reporter');
    return {
      row: r + 1,
      externalId: one(row, 'id'),
      externalKey: key,
      projectKey: one(row, 'projectKey') || (key ? key.split('-')[0] : null),
      url: null,
      summary: summary || '',
      ...withDescription(wikiToText(one(row, 'description') || ''), wikiToText(one(row, 'environment') || ''), extractAcceptanceCriteria),
      type: { name: one(row, 'type') || 'Task', subtask: null, hierarchyLevel: null },
      status: { name: statusName, category, guessed },
      priority: one(row, 'priority'),
      resolution,
      assignee: assigneeId || assigneeName ? add(assigneeId, assigneeName) : null,
      reporter: reporterId || reporterName ? add(reporterId, reporterName) : null,
      created: parseDate(one(row, 'created')),
      updated: parseDate(one(row, 'updated')),
      resolved,
      dueDate: toDateOnly(one(row, 'dueDate'), parseDate),
      fixVersions: many(row, 'fixVersions'),
      affectsVersions: many(row, 'affectsVersions'),
      components: many(row, 'components'),
      labels,
      sprints: many(row, 'sprints').map((name) => ({ name, jiraId: null, state: null })),
      numbers,
      texts,
      originalEstimateSec: toNumber(one(row, 'originalEstimate')),
      remainingEstimateSec: toNumber(one(row, 'remainingEstimate')),
      timeSpentSec: toNumber(one(row, 'timeSpent')),
      parent,
      flagged: /impediment/i.test(one(row, 'flagged') || ''),
      comments,
      commentsTotal: comments.length,
      warnings,
      errors,
    };
  });

  const variant = norm.some((h) => ['assignee id', 'status category', 'parent summary'].includes(h))
    ? 'cloud'
    : headers.some((h) => /version\/s$|^component\/s$/i.test(h.trim()))
    ? 'datacenter'
    : 'unknown';
  const fieldLabels = Object.fromEntries(cfColumns.map(([h, i]) => [h, /\((.+)\)\s*$/.exec(headers[i])?.[1] || h.slice(3)]));
  return {
    meta: { format: 'jira-csv', variant, rows: rows.length, delimiter, dayFirst: parseDate.dayFirst, unmappedColumns },
    fieldLabels,
    issues,
    people,
    sprintRefs: [],
    versionRefs: [],
  };
}

// ---------- JSON (REST search) ----------
function parseLegacySprint(s) {
  const body = /\[(.*)\]$/.exec(s)?.[1] || '';
  const get = (k) => new RegExp(`(?:^|,)${k}=([^,]*)`).exec(body)?.[1];
  const nameM = /(?:^|,)name=(.*?),(?:startDate|endDate|completeDate|activatedDate|sequence|goal)=/.exec(body);
  const val = (v) => (v && v !== '<null>' ? v : null);
  return {
    jiraId: get('id') ? +get('id') : null,
    state: (get('state') || '').toLowerCase() || null,
    name: nameM ? nameM[1] : get('name'),
    startDate: val(get('startDate')),
    endDate: val(get('endDate')),
    completeDate: val(get('completeDate')),
    goal: val(get('goal')),
  };
}

function sprintRef(v) {
  if (typeof v === 'string') return /Sprint@|\[id=/.test(v) ? parseLegacySprint(v) : { name: v, jiraId: null, state: null };
  return {
    name: v.name,
    jiraId: v.id ?? null,
    state: v.state ? String(v.state).toLowerCase() : null,
    startDate: v.startDate || null,
    endDate: v.endDate || null,
    completeDate: v.completeDate || null,
    goal: v.goal || null,
  };
}

function versionRef(v) {
  return {
    name: v.name,
    jiraId: v.id ?? null,
    released: typeof v.released === 'boolean' ? v.released : null,
    releaseDate: v.releaseDate || null,
    startDate: v.startDate || null,
    archived: typeof v.archived === 'boolean' ? v.archived : null,
    description: v.description || null,
  };
}

function parseJiraIssuesJson(data, { extractAcceptanceCriteria = true }) {
  const pages = Array.isArray(data) ? data : [data];
  const names = Object.assign({}, ...pages.map((p) => p.names || {}));
  const raw = pages.flatMap((p) => p.issues || []);
  const nameOf = (id) => normalizeName(names[id] || '');
  const fieldIds = new Set(raw.flatMap((i) => Object.keys(i.fields || {})));

  let sprintField = [...fieldIds].find((k) => nameOf(k) === 'sprint');
  if (!sprintField) {
    sprintField = [...fieldIds].find((k) =>
      raw.some((i) => {
        const v = i.fields?.[k];
        return Array.isArray(v) && v.length && ((v[0] && typeof v[0] === 'object' && v[0].name && v[0].state) || (typeof v[0] === 'string' && /Sprint@/.test(v[0])));
      })
    );
  }
  const epicLinkField = [...fieldIds].find((k) => nameOf(k) === 'epic link');
  const flaggedField = [...fieldIds].find((k) => nameOf(k) === 'flagged');

  const fieldLabels = {};
  const { people, add } = peopleRegistry();
  const person = (p) => (p ? add(p.accountId || p.name || p.key || null, p.displayName || null, p.emailAddress || null) : null);
  const iso = (s) => {
    if (!s) return null;
    const d = new Date(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const text = (v) => (typeof v === 'string' ? wikiToText(v) : adfToText(v));
  const sprintRefs = [];
  const versionRefs = [];

  const issues = raw.map((issue, r) => {
    const f = issue.fields || {};
    const warnings = [];
    const errors = [];
    const summary = String(f.summary || '').trim();
    if (!summary) errors.push({ code: 'MISSING_SUMMARY', message: 'Résumé vide : ticket ignoré.' });
    const resolution = normResolution(f.resolution?.name);
    const resolved = iso(f.resolutiondate);
    let category = categoryFromJira(f.status?.statusCategory?.key);
    const guessed = !category;
    if (!category) category = guessCategory(f.status?.name, resolution, resolved);
    const sprints = (Array.isArray(f[sprintField]) ? f[sprintField] : []).map(sprintRef).filter((s) => s.name);
    sprintRefs.push(...sprints);
    const fixVersions = (f.fixVersions || []).map(versionRef);
    const affects = (f.versions || []).map(versionRef);
    versionRefs.push(...fixVersions, ...affects);
    const numbers = {};
    const texts = {};
    for (const [k, v] of Object.entries(f)) {
      if (!k.startsWith('customfield_') || v === null || v === undefined) continue;
      const cfKey = `cf:${nameOf(k) || k}`;
      fieldLabels[cfKey] = names[k] || k;
      if (typeof v === 'number') numbers[cfKey] = v;
      else if (typeof v === 'string' && v.trim()) texts[cfKey] = v.trim();
      else if (typeof v === 'object' && !Array.isArray(v) && typeof v.value === 'string') texts[cfKey] = v.value.trim(); // select lists
    }
    const comments = (f.comment?.comments || []).map((c) => ({
      externalId: c.id ? String(c.id) : null,
      author: person(c.author),
      created: iso(c.created),
      updated: iso(c.updated),
      body: text(c.body),
    }));
    const commentsTotal = f.comment?.total ?? comments.length;
    if (commentsTotal > comments.length) warnings.push({ code: 'COMMENTS_TRUNCATED', message: `${commentsTotal - comments.length} commentaire(s) absents de l'export.` });
    let parent = f.parent ? { id: f.parent.id ? String(f.parent.id) : null, key: f.parent.key || null } : null;
    if (!parent && epicLinkField && typeof f[epicLinkField] === 'string') parent = { id: null, key: f[epicLinkField] };
    let origin = null;
    try {
      origin = issue.self ? new URL(issue.self).origin : null;
    } catch {
      origin = null;
    }
    return {
      row: r + 1,
      externalId: issue.id ? String(issue.id) : null,
      externalKey: issue.key || null,
      projectKey: f.project?.key || (issue.key ? issue.key.split('-')[0] : null),
      url: origin && issue.key ? `${origin}/browse/${issue.key}` : null,
      summary,
      ...withDescription(text(f.description), text(f.environment), extractAcceptanceCriteria),
      type: { name: f.issuetype?.name || 'Task', subtask: f.issuetype?.subtask ?? null, hierarchyLevel: f.issuetype?.hierarchyLevel ?? null },
      status: { name: f.status?.name || '', category, guessed },
      priority: f.priority?.name || null,
      resolution,
      assignee: person(f.assignee),
      reporter: person(f.reporter),
      created: iso(f.created),
      updated: iso(f.updated),
      resolved,
      dueDate: f.duedate || null,
      fixVersions: fixVersions.map((v) => v.name),
      affectsVersions: affects.map((v) => v.name),
      components: (f.components || []).map((c) => c.name).filter(Boolean),
      labels: [...new Set(f.labels || [])],
      sprints,
      numbers,
      texts,
      originalEstimateSec: toNumber(f.timeoriginalestimate),
      remainingEstimateSec: toNumber(f.timeestimate),
      timeSpentSec: toNumber(f.timespent),
      parent,
      flagged: flaggedField ? !!(Array.isArray(f[flaggedField]) ? f[flaggedField].length : f[flaggedField]) : false,
      comments,
      commentsTotal,
      warnings,
      errors,
    };
  });

  return { meta: { format: 'jira-issues-json', variant: 'rest', rows: raw.length }, fieldLabels, issues, people, sprintRefs, versionRefs };
}

// ---------- Bundle ----------
const sprintIdentity = (s) => (s.jiraId !== null && s.jiraId !== undefined ? `id:${s.jiraId}` : `name:${normalizeName(s.name)}`);

function mergeRefs(map, ref, keyOf, override) {
  const byName = [...map.values()].find((x) => normalizeName(x.name) === normalizeName(ref.name));
  const key = keyOf(ref);
  const existing = map.get(key) || byName;
  if (!existing) {
    map.set(key, { ...ref });
    return;
  }
  for (const [k, v] of Object.entries(ref)) {
    if (v === null || v === undefined) continue;
    if (override || existing[k] === null || existing[k] === undefined) existing[k] = v;
  }
}

function parseImportFiles(files, options = {}) {
  if (!Array.isArray(files) || !files.length) throw importError(400, 'NO_FILES', 'Aucun fichier fourni.');
  if (files.length > MAX_FILES) throw importError(400, 'TOO_MANY_FILES', `${MAX_FILES} fichiers maximum.`);
  const described = [];
  let issueSource = null;
  const bundle = { issues: [], people: new Map(), sprints: new Map(), versions: new Map(), warnings: [] };
  const fileSprints = [];
  const fileVersions = [];
  const fieldLabels = {};

  for (const file of files) {
    const content = String(file?.content ?? '');
    const name = String(file?.name || 'fichier');
    const detected = detectFile(content);
    const info = { name, size: content.length, sha1: sha1(content), format: detected.format };
    if (detected.format === 'jira-xml') throw importError(400, 'UNSUPPORTED_FORMAT', `${name} : l'export XML n'est pas pris en charge, utilisez « CSV (All fields) » ou l'export JSON.`);
    if (detected.format === 'invalid-json' || detected.format === 'unknown-json') {
      throw importError(400, 'JSON_UNKNOWN_SHAPE', `${name} : JSON non reconnu (attendu : recherche de tickets, sprints d'un board ou versions d'un projet).`);
    }
    if (['csv', 'jira-issues-json', 'jira-external-json'].includes(detected.format)) {
      const kind = detected.format === 'csv' ? 'csv' : 'json';
      if (issueSource && issueSource !== kind) throw importError(400, 'MIXED_ISSUE_SOURCES', 'Fournissez les tickets soit en CSV, soit en JSON, pas les deux.');
      issueSource = kind;
      let parsed;
      if (kind === 'csv') parsed = parseJiraCsv(content, options);
      else if (detected.format === 'jira-external-json') {
        // Jira "External System Import" JSON: converted to the REST shape first (same code as npm run jira:convert).
        const converted = convertExternalJson(detected.data, options);
        parsed = parseJiraIssuesJson(converted.page, options);
        parsed.meta = { ...parsed.meta, format: 'jira-external-json', variant: 'external-system', conversion: converted.report };
        fileVersions.push(...converted.versions.map(versionRef));
      } else parsed = parseJiraIssuesJson(detected.data, options);
      Object.assign(info, parsed.meta);
      Object.assign(fieldLabels, parsed.fieldLabels || {});
      const offset = bundle.issues.length;
      for (const issue of parsed.issues) bundle.issues.push({ ...issue, row: offset + issue.row, file: name });
      for (const [ref, p] of parsed.people) if (!bundle.people.has(ref)) bundle.people.set(ref, p);
      parsed.sprintRefs.forEach((s) => mergeRefs(bundle.sprints, s, sprintIdentity, false));
      parsed.versionRefs.forEach((v) => mergeRefs(bundle.versions, v, (x) => normalizeName(x.name), false));
    } else if (detected.format === 'jira-sprints-json') {
      info.rows = detected.data.length;
      fileSprints.push(...detected.data.map(sprintRef));
    } else if (detected.format === 'jira-versions-json') {
      info.rows = detected.data.length;
      fileVersions.push(...detected.data.map(versionRef));
    }
    described.push(info);
  }
  if (!issueSource) throw importError(400, 'NO_ISSUES', 'Aucun fichier de tickets (CSV ou JSON de recherche) dans la sélection.');
  if (bundle.issues.length > MAX_ISSUES) throw importError(413, 'TOO_MANY_ISSUES', `${MAX_ISSUES} tickets maximum par import.`);

  // Issue-embedded sprint names become known sprints; dedicated files win on details.
  for (const issue of bundle.issues) for (const s of issue.sprints) mergeRefs(bundle.sprints, s, sprintIdentity, false);
  fileSprints.forEach((s) => mergeRefs(bundle.sprints, s, sprintIdentity, true));
  for (const issue of bundle.issues) for (const v of [...issue.fixVersions, ...issue.affectsVersions]) mergeRefs(bundle.versions, { name: v, jiraId: null, released: null }, (x) => normalizeName(x.name), false);
  fileVersions.forEach((v) => mergeRefs(bundle.versions, v, (x) => normalizeName(x.name), true));

  // Story points column: the most filled numeric custom field named like "story point(s)".
  const counts = new Map();
  for (const issue of bundle.issues) for (const k of Object.keys(issue.numbers)) counts.set(k, (counts.get(k) || 0) + 1);
  const candidates = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  // Text custom fields (e.g. « Catégorie ») can feed Kýdos taxonomies: category / techno.
  const textValues = new Map();
  for (const issue of bundle.issues) {
    for (const [k, v] of Object.entries(issue.texts || {})) {
      if (!textValues.has(k)) textValues.set(k, new Set());
      textValues.get(k).add(v);
    }
  }
  const textFields = [...textValues.entries()]
    .map(([key, values]) => ({ key, label: fieldLabels[key] || key.replace(/^cf:/, ''), distinct: values.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pickText = (re) => textFields.find((f) => re.test(f.key) && f.distinct <= 60)?.key || null;
  bundle.fields = {
    storyPoints: {
      candidates,
      suggested: candidates.find((k) => /story point/.test(k)) || candidates.find((k) => /point/.test(k)) || null,
    },
    textFields,
    category: { suggested: pickText(/^cf:(categorie|categories|category|categorie de ticket)$/) },
    techno: { suggested: pickText(/^cf:(techno|technos|technologie|technology|stack)$/) },
  };
  bundle.files = described;
  bundle.source = issueSource;
  return bundle;
}

module.exports = { parseImportFiles, detectFile, parseJiraCsv, parseJiraIssuesJson, parseCommentCell, parseLegacySprint, normalizeHeader };
