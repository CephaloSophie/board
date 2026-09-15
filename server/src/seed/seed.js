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
const OVERWRITE = process.argv.includes('--overwrite');
const WRITE_OP = OVERWRITE ? '$set' : '$setOnInsert';

const DONE_STATUS_IDS = new Set(['tested', 'finished', 'confirmed']);
// Current release (sprint + version) of the seeded project; defaults to tasks.json meta.currentVersion.
const CURRENT_RELEASE = process.env.SEED_CURRENT_VERSION || null;
const DAY = 86400000;

function mondayUtc(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
}

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

// Some tasks.json rows carry a story-point value that is actually a duration
// string (e.g. "1 h", "0.5 h"). Coerce anything to a finite number of points,
// pulling the leading numeric part out of such strings.
function toPoints(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const toText = (v) => (Array.isArray(v) ? v.join('\n') : v === null || v === undefined ? '' : String(v));
const toList = (v) =>
  (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v]).map((x) => String(x));

// A few legacy rows (KB-390…395) were written with shifted fields: `type`
// holds the story points, `complexity` the duration, `description` the
// acceptance bullets, `acceptance` the implementation note and
// `estimate`/`duration` the real description. Put them back in place, then
// coerce every field to the type the Task schema expects.
function normalizeLegacyTask(t) {
  const shifted = typeof t.type === 'number' && Array.isArray(t.description);
  const src = shifted
    ? {
        ...t,
        type: 'feature',
        complexity: t.type,
        duration: t.complexity,
        estimate: t.complexity,
        description: t.estimate,
        acceptance: t.description,
        instructions: [...toList(t.instructions), ...toList(t.acceptance)],
      }
    : t;
  return {
    ...src,
    title: toText(src.title),
    description: toText(src.description),
    type: toText(src.type),
    module: toText(src.module),
    estimate: toText(src.estimate),
    duration: toText(src.duration),
    spec: toText(src.spec),
    instructions: toList(src.instructions),
    acceptance: toList(src.acceptance),
  };
}

// By default the seed only inserts what is missing, so re-running it never
// wipes edits made in the app (statuses, sprints, history…). Pass
// --overwrite to force every field back to the tasks.json values.
async function upsertTaxonomy(projectId, kind, key, fields) {
  return Taxonomy.findOneAndUpdate(
    { project: projectId, kind, key },
    { [WRITE_OP]: { ...fields, project: projectId, kind, key } },
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
      [WRITE_OP]: {
        key: 'KB',
        name: meta.project,
        vendor: meta.vendor,
        description: meta.description,
        currentVersion: CURRENT_RELEASE || meta.currentVersion,
        currentSprint: `sprint-${CURRENT_RELEASE || meta.currentVersion}`,
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

  // Release alignment: every version found in tasks.json that is older than the
  // current release (meta.currentVersion, 19.0.3) is published and its sprint
  // finished with a report; the current release gets an open version and the
  // single active sprint, dated this week. Older sprints are dated backwards.
  const currentRelease = CURRENT_RELEASE || meta.currentVersion;
  const legacyVersions = Array.from(new Set(data.tasks.map((t) => t.version).filter((v) => v && v !== currentRelease))).sort(
    compareVersions
  );
  const sprintLen = 7 * DAY; // project cadence: 1 week
  const currentStart = mondayUtc(new Date());
  const dayIso = (ms) => new Date(ms).toISOString();
  const currentSprintKey = `sprint-${currentRelease}`;

  for (const [i, v] of legacyVersions.entries()) {
    const startMs = currentStart.getTime() - (legacyVersions.length - i) * sprintLen;
    const endMs = startMs + sprintLen - DAY;
    const tasks = data.tasks.filter((t) => t.version === v);
    const done = tasks.filter((t) => DONE_STATUS_IDS.has(t.status));
    const open = tasks.filter((t) => !DONE_STATUS_IDS.has(t.status));
    const pointsOf = (list) => list.reduce((a, t) => a + toPoints(normalizeLegacyTask(t).complexity), 0);
    await upsertTaxonomy(project._id, 'version', v, {
      label: v,
      order: i,
      meta: { status: 'released', startDate: dayIso(startMs), releaseDate: dayIso(endMs), releasedAt: dayIso(endMs) },
    });
    await upsertTaxonomy(project._id, 'sprint', `sprint-${v}`, {
      label: `Sprint ${v}`,
      order: i,
      meta: {
        linkedVersion: v,
        status: 'finished',
        startDate: dayIso(startMs),
        endDate: dayIso(endMs),
        goal: `Livrer la version ${v}.`,
        closedAt: dayIso(endMs),
        report: {
          committedPoints: pointsOf(tasks),
          committedCount: tasks.length,
          completedPoints: pointsOf(done),
          completedCount: done.length,
          carriedOverTaskIds: [],
          carriedOverPoints: 0,
          carriedTo: null,
          keptTaskIds: open.map((t) => t.id),
          source: 'seed',
        },
      },
    });
  }

  await upsertTaxonomy(project._id, 'version', currentRelease, {
    label: currentRelease,
    order: legacyVersions.length,
    meta: { status: 'unreleased', startDate: currentStart.toISOString() },
  });
  await upsertTaxonomy(project._id, 'sprint', currentSprintKey, {
    label: `Sprint ${currentRelease}`,
    order: legacyVersions.length,
    meta: {
      linkedVersion: currentRelease,
      status: 'active',
      startDate: currentStart.toISOString(),
      endDate: dayIso(currentStart.getTime() + sprintLen - DAY),
      goal: `Livrer la version ${currentRelease}.`,
      startedAt: currentStart.toISOString(),
      startSnapshot: { at: currentStart.toISOString(), committedPoints: 0, committedCount: 0, taskIds: [] },
    },
  });

  console.log(`[seed] Seeding ${data.tasks.length} tasks...`);
  let maxSeq = 0;
  console.log(`[seed] Mode: ${OVERWRITE ? 'overwrite (--overwrite)' : 'insert missing only'}`);
  for (const raw of data.tasks) {
    const t = normalizeLegacyTask(raw);
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
        [WRITE_OP]: {
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
          complexity: toPoints(t.complexity),
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
  console.log(`[seed] Version et sprint courants : ${currentRelease}. Base déjà existante ? npm run release:align -- --dry-run`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
