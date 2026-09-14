const { normalizeName } = require('./text');
const { statusCategoryOf } = require('../../utils/taxonomyMeta');

// Pre-filled correspondences Jira value → Kýdos taxonomy key (editable in the wizard).
// A mapping value is either an existing key (string) or { create: { label, color, category?, meta? } }.

const STATUS_SYNONYMS = [
  [['backlog', 'open', 'new', 'nouveau', 'ouvert', 'brouillon', 'draft'], 'draft'],
  [['to do', 'todo', 'a faire', 'selected for development', 'ready', 'pret'], 'pending'],
  [['in progress', 'en cours', 'doing', 'in development'], 'onprocess'],
  [['in test', 'testing', 'qa', 'en test'], 'tested'],
  [['in review', 'code review', 'review', 'en revue', 'a valider', 'validation'], 'needconfirmation'],
  [['done', 'closed', 'resolved', 'termine', 'terminee', 'ferme', 'fait'], 'finished'],
  [['validated', 'accepted', 'valide', 'validee'], 'confirmed'],
];

const PRIORITY_DEFAULTS = {
  highest: ['P0', '#e85d70'],
  blocker: ['P0', '#e85d70'],
  critical: ['P0', '#e85d70'],
  high: ['P1', '#e0a458'],
  major: ['P1', '#e0a458'],
  medium: ['P2', '#e6c46a'],
  minor: ['P2', '#9db4dd'],
  low: ['P3', '#9db4dd'],
  lowest: ['P3', '#6b7280'],
  trivial: ['P3', '#6b7280'],
};

const TYPE_DEFAULTS = [
  [['story', 'user story', 'recit'], 'story', '#7ecb98', { hierarchyLevel: 0 }],
  [['bug', 'defect', 'anomalie'], 'bug', '#e85d70', { isBug: true }],
  [['task', 'tache'], 'task', '#9db4dd', { hierarchyLevel: 0 }],
  [['epic', 'epopee'], 'epic', '#b39ddb', { isEpic: true, hierarchyLevel: 1 }],
  [['sub-task', 'subtask', 'sous-tache', 'sous tache'], 'subtask', '#6b78ea', { isSubtask: true, hierarchyLevel: -1 }],
  [['new feature', 'improvement', 'feature', 'amelioration'], 'feature', '#7ecb98', {}],
  [['spike', 'technical task', 'chore'], 'chore', '#6b7280', {}],
];

const CATEGORY_COLORS = { todo: '#9db4dd', inprogress: '#e6c46a', done: '#2f8f57' };

function countBy(items, keyOf) {
  const map = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
}

function suggestMapping({ bundle, taxonomies, users }) {
  const active = (kind) => taxonomies.filter((t) => t.kind === kind && !t.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
  const byLabel = (kind, name) =>
    active(kind).find((t) => normalizeName(t.label) === normalizeName(name) || normalizeName(t.meta?.jiraName) === normalizeName(name) || normalizeName(t.key) === normalizeName(name));
  const exists = (kind, key) => active(kind).some((t) => t.key === key);
  const issues = bundle.issues.filter((i) => !i.errors.length);

  // Statuses
  const statusEntities = [];
  const statusMapping = {};
  const statusNames = countBy(issues, (i) => i.status.name);
  for (const [name, count] of statusNames) {
    const sample = issues.find((i) => i.status.name === name);
    const category = sample.status.category;
    let suggested = null;
    let confidence = 'create';
    const label = byLabel('status', name);
    if (label) {
      suggested = label.key;
      confidence = 'name';
    } else {
      const syn = STATUS_SYNONYMS.find(([names]) => names.includes(normalizeName(name)));
      if (syn && exists('status', syn[1]) && statusCategoryOf(active('status').find((s) => s.key === syn[1])) === category) {
        suggested = syn[1];
        confidence = 'synonym';
      } else {
        const sameCategory = active('status').find((s) => statusCategoryOf(s) === category);
        if (sameCategory && category !== 'inprogress') {
          suggested = sameCategory.key;
          confidence = 'category';
        }
      }
    }
    statusMapping[name] = suggested || { create: { label: name, color: CATEGORY_COLORS[category], category } };
    statusEntities.push({ name, category, guessed: issues.some((i) => i.status.name === name && i.status.guessed), count, suggested, confidence });
  }

  // Priorities
  const priorityEntities = [];
  const priorityMapping = {};
  for (const [name, count] of countBy(issues, (i) => i.priority)) {
    const label = byLabel('priority', name);
    const def = PRIORITY_DEFAULTS[normalizeName(name)];
    let suggested = label?.key || (def && exists('priority', def[0]) ? def[0] : null);
    priorityMapping[name] = suggested || { create: { label: name, color: def?.[1] || '#6b7280' } };
    priorityEntities.push({ name, count, suggested, confidence: label ? 'name' : suggested ? 'default' : 'create' });
  }

  // Types
  const typeEntities = [];
  const typeMapping = {};
  for (const [name, count] of countBy(issues, (i) => i.type.name)) {
    const sample = issues.find((i) => i.type.name === name).type;
    const label = byLabel('type', name);
    const def =
      TYPE_DEFAULTS.find(([names]) => names.includes(normalizeName(name))) ||
      (sample.hierarchyLevel === 1 ? TYPE_DEFAULTS[3] : sample.subtask || sample.hierarchyLevel === -1 ? TYPE_DEFAULTS[4] : null);
    let suggested = label?.key || null;
    if (!suggested && def && exists('type', def[1])) suggested = def[1];
    typeMapping[name] = suggested || { create: { key: def?.[1], label: name, color: def?.[2] || '#6b7280', meta: def?.[3] || {} } };
    typeEntities.push({ name, count, subtask: sample.subtask, hierarchyLevel: sample.hierarchyLevel, suggested, confidence: label ? 'name' : suggested ? 'default' : 'create' });
  }

  // People
  const peopleEntities = [];
  const peopleMapping = {};
  const roles = new Map();
  const bump = (p, role) => {
    if (!p) return;
    const r = roles.get(p.ref) || {};
    r[role] = (r[role] || 0) + 1;
    roles.set(p.ref, r);
  };
  for (const i of issues) {
    bump(i.assignee, 'assignee');
    bump(i.reporter, 'reporter');
    i.comments.forEach((c) => bump(c.author, 'commenter'));
  }
  const activeUsers = users.filter((u) => u.active !== false);
  for (const [ref, r] of roles) {
    const p = bundle.people.get(ref) || { ref, displayName: ref };
    let match = null;
    let confidence = 'none';
    if (p.email) {
      match = activeUsers.find((u) => u.email && u.email.toLowerCase() === p.email.toLowerCase());
      if (match) confidence = 'email';
    }
    if (!match && p.displayName) {
      const same = activeUsers.filter((u) => normalizeName(u.displayName) === normalizeName(p.displayName));
      if (same.length === 1) {
        match = same[0];
        confidence = 'name';
      }
    }
    if (!match) {
      match = activeUsers.find((u) => (p.accountId && u.username === String(p.accountId).toLowerCase()) || (p.email && u.username === p.email.split('@')[0].toLowerCase()));
      if (match) confidence = 'username';
    }
    peopleMapping[ref] = match ? String(match._id) : null;
    peopleEntities.push({ ref, displayName: p.displayName, email: p.email, roles: r, suggested: match ? String(match._id) : null, confidence });
  }
  peopleEntities.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  const sprintEntities = [...bundle.sprints.values()].map((s) => ({
    name: s.name,
    jiraId: s.jiraId,
    state: s.state,
    startDate: s.startDate || null,
    endDate: s.endDate || null,
    goal: s.goal || null,
    count: issues.filter((i) => i.sprints.some((x) => normalizeName(x.name) === normalizeName(s.name))).length,
    existingKey: active('sprint').find((t) => (s.jiraId && String(t.meta?.jiraId) === String(s.jiraId)) || normalizeName(t.label) === normalizeName(s.name))?.key || null,
  }));
  const versionEntities = [...bundle.versions.values()].map((v) => ({
    name: v.name,
    released: v.released,
    releaseDate: v.releaseDate || null,
    count: issues.filter((i) => i.fixVersions.includes(v.name) || i.affectsVersions.includes(v.name)).length,
    exists: exists('version', v.name),
  }));

  return {
    entities: {
      statuses: statusEntities,
      priorities: priorityEntities,
      types: typeEntities,
      people: peopleEntities,
      sprints: sprintEntities,
      versions: versionEntities,
      components: [...countBy(issues.flatMap((i) => i.components.map((c) => ({ c }))), (x) => x.c)].map(([name, count]) => ({ name, count })),
      labels: [...countBy(issues.flatMap((i) => i.labels.map((l) => ({ l }))), (x) => x.l)].map(([name, count]) => ({ name, count })),
      fields: bundle.fields,
    },
    mapping: {
      statuses: statusMapping,
      priorities: priorityMapping,
      types: typeMapping,
      people: peopleMapping,
      sprints: {},
      fields: {
        storyPoints: bundle.fields.storyPoints.suggested,
        category: bundle.fields.category?.suggested || null,
        techno: bundle.fields.techno?.suggested || null,
      },
    },
  };
}

module.exports = { suggestMapping };
