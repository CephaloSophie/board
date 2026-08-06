/**
 * Seeds the database for the Kýdos Belote project from the legacy
 * tasks.json referential (project meta, taxonomies, tasks) and creates the
 * two default superadmin accounts. Safe to re-run: it upserts by natural key.
 *
 * Usage: node src/seed/seed.js  (or `npm run seed`)
 */
const fs = require('fs');
const path = require('path');
const { connectDb, mongoose } = require('../db');
const { User } = require('../models/User');
const { Project } = require('../models/Project');
const { Taxonomy } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { Counter } = require('../models/Counter');
const { hashPassword } = require('../utils/password');

const DATA_PATH = path.join(__dirname, '..', '..', '..', 'tasks.json');
const DEFAULT_PASSWORD = '@bloardKydos';

const DONE_STATUS_IDS = new Set(['tested', 'finished', 'confirmed']);

function versionSortKey(v) {
  const parts = String(v)
    .split('.')
    .map((p) => (Number.isFinite(+p) ? +p : -1));
  return parts;
}

function compareVersions(a, b) {
  const pa = versionSortKey(a);
  const pb = versionSortKey(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return String(a).localeCompare(String(b));
}

async function upsertUser({ username, email, displayName, role, color }) {
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const user = await User.findOneAndUpdate(
    { username },
    { $setOnInsert: { username, email, displayName, role, color, passwordHash, active: true } },
    { new: true, upsert: true }
  );
  return user;
}

async function upsertTaxonomy(projectId, kind, key, fields) {
  return Taxonomy.findOneAndUpdate(
    { project: projectId, kind, key },
    { $set: { ...fields, project: projectId, kind, key } },
    { new: true, upsert: true }
  );
}

async function run() {
  await connectDb();
  const raw = fs.readFileSync(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const meta = data.meta;

  console.log('[seed] Creating default superadmins...');
  const ameur = await upsertUser({
    username: 'ameur',
    email: 'ameurhamdouni10@gmail.com',
    displayName: 'Ameur Hamdouni',
    role: 'superadmin',
    color: '#e6c46a',
  });
  const hamido = await upsertUser({
    username: 'hamido',
    email: 'hamido@kydos.local',
    displayName: 'Hamido',
    role: 'superadmin',
    color: '#7ecb98',
  });

  console.log(`[seed] Upserting project ${meta.project}...`);
  const project = await Project.findOneAndUpdate(
    { key: 'KB' },
    {
      $set: {
        key: 'KB',
        name: meta.project,
        vendor: meta.vendor,
        description: meta.description,
        currentVersion: meta.currentVersion,
        complexityScale: meta.complexityScale,
        sprintDurationValue: 1,
        sprintDurationUnit: 'weeks',
        owner: ameur._id,
      },
    },
    { new: true, upsert: true }
  );

  console.log('[seed] Seeding taxonomies...');
  for (const [i, s] of (meta.statuses || []).entries()) {
    await upsertTaxonomy(project._id, 'status', s.id, {
      label: s.label,
      color: s.color,
      description: s.description,
      order: i,
      meta: { isDone: DONE_STATUS_IDS.has(s.id) },
    });
  }
  for (const [i, p] of (meta.priorities || []).entries()) {
    await upsertTaxonomy(project._id, 'priority', p.id, { label: p.label, color: p.color, order: i });
  }
  for (const [i, a] of (meta.areas || []).entries()) {
    await upsertTaxonomy(project._id, 'area', a.id, { label: a.label, order: i });
  }
  for (const [i, t] of (meta.types || []).entries()) {
    await upsertTaxonomy(project._id, 'type', t, { label: t, order: i });
  }
  for (const [i, t] of (meta.technos || []).entries()) {
    await upsertTaxonomy(project._id, 'techno', t, { label: t, order: i });
  }
  for (const [i, c] of (meta.categories || []).entries()) {
    await upsertTaxonomy(project._id, 'category', c, { label: c, order: i });
  }

  // Default agile ceremony/event types. meta.features selects which sections
  // the event editor renders; meta.icon is the emoji shown in listings.
  const DEFAULT_EVENT_TYPES = [
    { key: 'refinement', label: 'Refinement', color: '#6b78ea', icon: '🔍', features: ['participants', 'backlog', 'estimation', 'agenda', 'actions', 'decisions'] },
    { key: 'grooming', label: 'Grooming', color: '#7ecb98', icon: '🌱', features: ['participants', 'backlog', 'estimation', 'agenda'] },
    { key: 'technical', label: 'Point technique', color: '#e6c46a', icon: '🛠️', features: ['participants', 'agenda', 'decisions', 'actions', 'backlog'] },
    { key: 'architecture', label: 'Point architecture', color: '#b39ddb', icon: '🏛️', features: ['participants', 'adr', 'decisions', 'actions'] },
    { key: 'demo_prep', label: 'Préparation démo', color: '#e0a458', icon: '🎬', features: ['participants', 'demo', 'backlog', 'agenda'] },
    { key: 'retro', label: 'Rétrospective', color: '#e85d70', icon: '🔄', features: ['participants', 'decisions', 'actions', 'notes'] },
  ];
  for (const [i, e] of DEFAULT_EVENT_TYPES.entries()) {
    await upsertTaxonomy(project._id, 'eventType', e.key, {
      label: e.label,
      color: e.color,
      order: i,
      meta: { icon: e.icon, features: e.features },
    });
  }

  const distinctVersions = Array.from(new Set(data.tasks.map((t) => t.version).filter(Boolean))).sort(
    compareVersions
  );
  for (const [i, v] of distinctVersions.entries()) {
    await upsertTaxonomy(project._id, 'version', v, { label: v, order: i });
  }
  // Sprints start out mirroring versions 1:1 — a reasonable default that
  // teams can immediately reshape (rename, merge, add new ones) since sprint
  // is tracked as its own independent field on every task. Each sprint gets
  // a status (draft/ready/active/finished) inferred from its position vs
  // the project's currentVersion, plus placeholder start/end dates spaced
  // sprintDurationDays apart from a fixed anchor.
  const sprintLen = 7; // matches Project.sprintDurationDays default
  const anchor = new Date('2026-07-20T00:00:00.000Z').getTime();
  const currentIdx = distinctVersions.indexOf(meta.currentVersion);
  let currentSprintKey = null;
  for (const [i, v] of distinctVersions.entries()) {
    const startDate = new Date(anchor + i * sprintLen * 24 * 3600 * 1000).toISOString();
    const endDate = new Date(anchor + (i + 1) * sprintLen * 24 * 3600 * 1000 - 1).toISOString();
    let status = 'draft';
    if (currentIdx >= 0) {
      if (i < currentIdx) status = 'finished';
      else if (i === currentIdx) status = 'active';
      else if (i === currentIdx + 1) status = 'ready';
    }
    const key = `sprint-${v}`;
    if (status === 'active') currentSprintKey = key;
    await upsertTaxonomy(project._id, 'sprint', key, {
      label: `Sprint ${v}`,
      order: i,
      meta: { linkedVersion: v, status, startDate, endDate, goal: `Livrer la version ${v}.` },
    });
  }

  if (currentSprintKey && !project.currentSprint) {
    project.currentSprint = currentSprintKey;
    await project.save();
  }

  console.log(`[seed] Seeding ${data.tasks.length} tasks...`);
  let maxSeq = 0;
  for (const t of data.tasks) {
    const numMatch = /(\d+)$/.exec(t.id);
    if (numMatch) maxSeq = Math.max(maxSeq, parseInt(numMatch[1], 10));

    const history = (t.history || []).map((h) => ({
      at: new Date(h.at),
      by: h.by === 'ameur' ? ameur._id : undefined,
      byLabel: h.by === 'ameur' ? undefined : h.by,
      field: 'status',
      from: null,
      to: h.status,
      note: h.note,
    }));

    await Task.findOneAndUpdate(
      { project: project._id, taskId: t.id },
      {
        $set: {
          project: project._id,
          taskId: t.id,
          title: t.title,
          description: t.description || '',
          area: t.area,
          module: t.module,
          type: t.type,
          status: t.status,
          priority: t.priority,
          version: t.version,
          sprint: t.version ? `sprint-${t.version}` : null,
          techno: t.techno,
          category: t.category,
          estimate: t.estimate,
          duration: t.duration,
          complexity: t.complexity || 0,
          spec: t.spec,
          instructions: t.instructions || [],
          acceptance: t.acceptance || [],
          reporter: ameur._id,
          history,
          createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
          updatedAt: t.updatedAt ? new Date(t.updatedAt) : undefined,
        },
      },
      { upsert: true, setDefaultsOnInsert: true, timestamps: false }
    );
  }

  await Counter.findByIdAndUpdate(project.key, { $max: { seq: maxSeq } }, { upsert: true });

  console.log('[seed] Done.');
  console.log(`[seed] Superadmins: ameur / hamido — password: ${DEFAULT_PASSWORD}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
