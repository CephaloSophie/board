const { normalizeName } = require('./text');

/*
 * Jira "External System Import" JSON  →  REST search page ({ names, issues[] }).
 *
 * Input (Jira JSON importer format):
 *   { projects: [{ key, name, versions?, components?, issues: [{ externalId, key?, summary, issueType,
 *     status?, priority?, resolution?, resolutionDate?, assignee?, reporter?, created?, updated?, duedate?,
 *     labels?, components?, fixedVersions?, affectedVersions?, description?, originalEstimate?, timeSpent?,
 *     estimate?, comments?: [{ body, author, created }], customFieldValues?: [{ fieldName, fieldType, value }] }] }],
 *   links?: [{ name, sourceId, destinationId }] }
 *
 * The output is what the regular JSON importer reads, so both the CLI converter
 * (scripts/jira-convert.js) and the in-app import share this single mapping.
 */

const STORY_POINTS_FIELD = 'customfield_19000';
const EFFORT_POINTS = { XS: 1, S: 2, M: 5, L: 8, XL: 13, XXL: 21 };
const DONE_STATUSES = ['done', 'closed', 'resolved', 'termine', 'terminee', 'ferme', 'fait', 'validated'];
const PROGRESS_STATUSES = ['in progress', 'en cours', 'in review', 'review', 'testing', 'in test', 'a valider'];

function isJiraExternalJson(data) {
  return !!data && !Array.isArray(data) && Array.isArray(data.projects) && data.projects.some((p) => Array.isArray(p?.issues));
}

// "PT2H30M", "P1DT2H", 7200 (seconds) or "2h" → seconds.
function durationSeconds(value, hoursPerDay = 8) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const iso = /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(String(value).trim());
  if (iso) {
    const [, w = 0, d = 0, h = 0, m = 0, s = 0] = iso.map((x) => Number(x) || 0);
    return Math.round(((w * 5 + d) * hoursPerDay + h) * 3600 + m * 60 + s);
  }
  let total = 0;
  const re = /([\d.,]+)\s*(w|d|j|h|m)/gi;
  let match;
  while ((match = re.exec(String(value)))) {
    const n = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toLowerCase();
    total += unit === 'w' ? n * 5 * hoursPerDay * 3600 : unit === 'd' || unit === 'j' ? n * hoursPerDay * 3600 : unit === 'h' ? n * 3600 : n * 60;
  }
  return total ? Math.round(total) : null;
}

function statusCategoryKey(name) {
  const n = normalizeName(name);
  if (DONE_STATUSES.includes(n)) return 'done';
  if (PROGRESS_STATUSES.includes(n)) return 'indeterminate';
  return 'new';
}

// Default creation date when the export has none: an "audit-YYYY-MM-DD" style label, else the conversion time.
function inferredDate(issue, fallback) {
  const label = (issue.labels || []).map(String).find((l) => /(\d{4}-\d{2}-\d{2})/.test(l));
  const day = label && /(\d{4}-\d{2}-\d{2})/.exec(label)[1];
  return day ? `${day}T09:00:00.000+0200` : fallback;
}

const person = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return { accountId: value.accountId || value.name || value.key || null, displayName: value.displayName || value.name || null, emailAddress: value.emailAddress || value.email || null };
  const s = String(value);
  return { accountId: s, displayName: s, emailAddress: /@/.test(s) ? s : null };
};

function convertExternalJson(data, options = {}) {
  const hoursPerDay = Number(options.hoursPerDay) || 8;
  const effortPoints = { ...EFFORT_POINTS, ...(options.effortPoints || {}) };
  const now = new Date().toISOString();
  const names = { [STORY_POINTS_FIELD]: 'Story Points' };
  const fieldIds = new Map();
  const idFor = (fieldName) => {
    if (!fieldIds.has(fieldName)) {
      const id = `customfield_${19001 + fieldIds.size}`;
      fieldIds.set(fieldName, id);
      names[id] = fieldName;
    }
    return fieldIds.get(fieldName);
  };

  const linkLines = new Map();
  const addLink = (id, line) => {
    if (!linkLines.has(id)) linkLines.set(id, []);
    linkLines.get(id).push(line);
  };
  for (const l of data.links || []) {
    if (!l?.sourceId || !l?.destinationId) continue;
    addLink(l.sourceId, `${l.name || 'Lié à'} → ${l.destinationId}`);
    addLink(l.destinationId, `${l.name || 'Lié à'} ← ${l.sourceId}`);
  }

  const report = { projects: data.projects.length, issues: 0, customFields: [], effortToPoints: 0, statusDefaulted: 0, datesInferred: 0, links: (data.links || []).length };
  const issues = [];
  const versions = [];

  for (const project of data.projects) {
    for (const v of project.versions || []) {
      versions.push({ name: v.name, id: v.externalId || v.id, released: typeof v.released === 'boolean' ? v.released : null, releaseDate: v.releaseDate || null, startDate: v.startDate || null, description: v.description || null });
    }
    for (const issue of project.issues || []) {
      const externalId = String(issue.externalId || issue.key || `${project.key}-${issues.length + 1}`);
      const custom = {};
      const metaLines = [];
      let effort = null;
      for (const cf of issue.customFieldValues || []) {
        if (!cf?.fieldName) continue;
        const value = Array.isArray(cf.value) ? cf.value.join(', ') : cf.value;
        if (value === null || value === undefined || value === '') continue;
        const name = String(cf.fieldName);
        if (/^(story points?|story point estimate)$/i.test(name) && Number.isFinite(Number(value))) {
          custom[STORY_POINTS_FIELD] = Number(value);
          continue;
        }
        custom[idFor(name)] = typeof value === 'number' ? value : String(value);
        if (/^(effort|taille|size|t-shirt)$/i.test(name)) effort = String(value).trim().toUpperCase();
        // Only list values the Jira description does not already state (audit exports repeat them in a header line).
        if (!String(issue.description || '').includes(String(value))) metaLines.push(`* *${name}* : ${value}`);
      }
      if (custom[STORY_POINTS_FIELD] === undefined && effort && effortPoints[effort] !== undefined) {
        custom[STORY_POINTS_FIELD] = effortPoints[effort];
        report.effortToPoints += 1;
      }

      const created = issue.created || inferredDate(issue, now);
      if (!issue.created) report.datesInferred += 1;
      const statusName = issue.status || options.defaultStatus || 'To Do';
      if (!issue.status) report.statusDefaulted += 1;
      const links = linkLines.get(externalId) || [];
      const description = [
        issue.description || '',
        metaLines.length ? `h3. Champs Jira\n${metaLines.join('\n')}` : '',
        links.length ? `h3. Tickets liés\n${links.map((l) => `* ${l}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      issues.push({
        id: externalId,
        key: String(issue.key || externalId),
        fields: {
          summary: issue.summary || '',
          issuetype: { name: issue.issueType || 'Task', subtask: /sub-?task|sous-t/i.test(issue.issueType || '') },
          project: { key: project.key, name: project.name },
          status: { name: statusName, statusCategory: { key: statusCategoryKey(statusName) } },
          priority: issue.priority ? { name: issue.priority } : null,
          resolution: issue.resolution ? { name: issue.resolution } : null,
          resolutiondate: issue.resolutionDate || issue.resolutiondate || null,
          assignee: person(issue.assignee),
          reporter: person(issue.reporter),
          created,
          updated: issue.updated || created,
          duedate: issue.duedate || issue.dueDate || null,
          labels: (issue.labels || []).map(String),
          components: (issue.components || []).map((c) => ({ name: typeof c === 'object' ? c.name : String(c) })),
          fixVersions: (issue.fixedVersions || []).map((v) => ({ name: typeof v === 'object' ? v.name : String(v) })),
          versions: (issue.affectedVersions || []).map((v) => ({ name: typeof v === 'object' ? v.name : String(v) })),
          description,
          timeoriginalestimate: durationSeconds(issue.originalEstimate, hoursPerDay),
          timeestimate: durationSeconds(issue.estimate, hoursPerDay),
          timespent: durationSeconds(issue.timeSpent, hoursPerDay),
          [STORY_POINTS_FIELD]: custom[STORY_POINTS_FIELD] ?? null,
          ...custom,
          comment: {
            comments: (issue.comments || []).map((c, i) => ({
              id: `${externalId}-c${i + 1}`,
              author: person(c.author),
              created: c.created || created,
              updated: c.updated || c.created || created,
              body: c.body || '',
            })),
            total: (issue.comments || []).length,
          },
        },
      });
    }
  }
  report.issues = issues.length;
  report.customFields = [...fieldIds.keys()];
  return { page: { isLast: true, source: 'jira-external-system-import', names, issues }, versions, report };
}

module.exports = { isJiraExternalJson, convertExternalJson, durationSeconds, EFFORT_POINTS };
