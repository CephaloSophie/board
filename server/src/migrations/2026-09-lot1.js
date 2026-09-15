/**
 * Lot 1 data migration — idempotent, safe to re-run (a second run reports 0 change).
 *
 *   npm run migrate              apply
 *   npm run migrate -- --dry-run count what would change, write nothing
 *
 * Steps (per project): status categories, bug type flag, explicit backlog
 * (sprint "backlog" → null), single active sprint aligned with currentSprint,
 * version release status, derived task dates, project access/estimation/defaults.
 * Works on raw collections so Mongoose defaults never hide missing fields and
 * `updatedAt` is left untouched.
 */
const { mongoose } = require('../db');
const { Project } = require('../models/Project');
const { Taxonomy } = require('../models/Taxonomy');
const { Task } = require('../models/Task');
const { statusCategoryOf } = require('../utils/taxonomyMeta');
const { hoursOf } = require('../utils/duration');
const { compareVersions } = require('../utils/versions');

async function migrate({ dryRun = false, logger = console } = {}) {
  const stats = {};
  const bump = (key, n = 1) => {
    stats[key] = (stats[key] || 0) + n;
  };
  const write = async (fn) => {
    if (!dryRun) await fn();
  };
  const P = Project.collection;
  const X = Taxonomy.collection;
  const T = Task.collection;

  const projects = await P.find({}).toArray();
  for (const project of projects) {
    const pid = project._id;
    const tax = await X.find({ project: pid }).toArray();
    const ofKind = (kind) => tax.filter((t) => t.kind === kind);
    const setMeta = (item, meta) => {
      item.meta = meta;
      return write(() => X.updateOne({ _id: item._id }, { $set: { meta } }));
    };

    // 1. Status categories (+ derived isDone).
    for (const s of ofKind('status')) {
      const category = statusCategoryOf(s);
      const isDone = category === 'done';
      if (s.meta?.category !== category || s.meta?.isDone !== isDone) {
        await setMeta(s, { ...(s.meta || {}), category, isDone });
        bump('statusCategory');
      }
    }
    const doneKeys = new Set(ofKind('status').filter((s) => statusCategoryOf(s) === 'done').map((s) => s.key));

    // 2. Bug type flag.
    for (const t of ofKind('type')) {
      if (t.key === 'bug' && t.meta?.isBug === undefined) {
        await setMeta(t, { ...(t.meta || {}), isBug: true });
        bump('typeIsBug');
      }
    }

    // 3. Explicit backlog: tasks without sprint instead of a "backlog" pseudo-sprint.
    const backlog = ofKind('sprint').find((s) => s.key === 'backlog');
    if (backlog) {
      const backlogTasks = await T.find({ project: pid, sprint: 'backlog' }, { projection: { _id: 1 } }).toArray();
      for (const t of backlogTasks) {
        await write(() =>
          T.updateOne(
            { _id: t._id },
            {
              $set: { sprint: null },
              $push: {
                history: {
                  _id: new mongoose.Types.ObjectId(),
                  at: new Date(),
                  byLabel: 'migration',
                  field: 'sprint',
                  from: 'backlog',
                  to: null,
                  note: 'Migration : backlog explicite',
                },
              },
            }
          )
        );
        bump('backlogTasks');
      }
      if (!backlog.archived) {
        backlog.archived = true;
        await write(() => X.updateOne({ _id: backlog._id }, { $set: { archived: true } }));
        bump('backlogArchived');
      }
    }

    // 4. A single active sprint, and currentSprint pointing at it.
    const sprints = ofKind('sprint').filter((s) => !s.archived);
    const active = sprints.filter((s) => s.meta?.status === 'active');
    let keep =
      active.find((s) => s.key === project.currentSprint) ||
      [...active].sort((a, b) => new Date(b.meta?.startDate || 0) - new Date(a.meta?.startDate || 0))[0] ||
      null;
    for (const s of active) {
      if (s === keep) continue;
      await setMeta(s, { ...s.meta, status: 'finished' });
      bump('extraActiveSprintsFinished');
    }
    if (!keep && project.currentSprint) {
      const current = sprints.find((s) => s.key === project.currentSprint);
      if (current && current.meta?.status !== 'finished') {
        await setMeta(current, { ...(current.meta || {}), status: 'active' });
        keep = current;
        bump('currentSprintActivated');
      }
    }
    const expectedCurrent = keep ? keep.key : null;
    if ((project.currentSprint ?? null) !== expectedCurrent) {
      await write(() => P.updateOne({ _id: pid }, { $set: { currentSprint: expectedCurrent } }));
      bump('currentSprintAligned');
    }

    // 5. Version release status.
    for (const v of ofKind('version')) {
      if (v.meta?.status) continue;
      const released = !!project.currentVersion && compareVersions(v.key, project.currentVersion) < 0;
      await setMeta(v, { ...(v.meta || {}), status: released ? 'released' : 'unreleased' });
      bump('versionStatus');
    }

    // 6. Derived task fields (statusChangedAt doubles as the "migrated" marker).
    const tasks = await T.find(
      { project: pid, statusChangedAt: { $exists: false } },
      { projection: { status: 1, history: 1, duration: 1, labels: 1, updatedAt: 1, createdAt: 1 } }
    ).toArray();
    for (const t of tasks) {
      const statusEntries = (t.history || [])
        .filter((h) => (h.field === 'status' || h.field === 'created') && h.at)
        .sort((a, b) => new Date(a.at) - new Date(b.at));
      const last = statusEntries[statusEntries.length - 1];
      const fallback = t.updatedAt || t.createdAt || new Date();
      const set = {
        statusChangedAt: last ? new Date(last.at) : fallback,
        durationHours: hoursOf(t.duration),
        resolvedAt: null,
      };
      if (doneKeys.has(t.status)) {
        const lastDone = [...statusEntries].reverse().find((h) => doneKeys.has(h.to));
        set.resolvedAt = lastDone ? new Date(lastDone.at) : fallback;
      }
      if (!Array.isArray(t.labels)) set.labels = [];
      await write(() => T.updateOne({ _id: t._id }, { $set: set }));
      bump('tasks');
    }

    // 7. Project settings introduced by Lot 1.
    const set = {};
    if (!project.access) set.access = 'open';
    if (!Array.isArray(project.members)) set.members = [];
    if ((!Array.isArray(project.members) || !project.members.length) && project.owner) {
      set.members = [{ _id: new mongoose.Types.ObjectId(), user: project.owner, role: 'admin', addedAt: new Date() }];
    }
    if (!project.timezone) set.timezone = 'Europe/Paris';
    if (!Array.isArray(project.workingDays)) set.workingDays = [1, 2, 3, 4, 5];
    if (!project.estimation) set.estimation = { unit: 'points', scale: [1, 2, 3, 5, 8, 13] };
    if (!project.defaults) {
      const todo = ofKind('status')
        .filter((s) => !s.archived && statusCategoryOf(s) === 'todo')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      const defaults = {};
      const preferred = todo.find((s) => (s.order || 0) >= 1) || todo[0];
      if (preferred) defaults.status = preferred.key;
      if (ofKind('type').some((t) => t.key === 'feature')) defaults.type = 'feature';
      if (ofKind('priority').some((p) => p.key === 'P2')) defaults.priority = 'P2';
      set.defaults = defaults;
    }
    if (Object.keys(set).length) {
      await write(() => P.updateOne({ _id: pid }, { $set: set }));
      bump('projectFields');
    }
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  logger.log(`[migrate] ${dryRun ? '(dry-run) ' : ''}${projects.length} projet(s), ${total} changement(s)`, stats);
  return { stats, total };
}

if (require.main === module) {
  const { connectDb } = require('../db');
  connectDb()
    .then(() => migrate({ dryRun: process.argv.includes('--dry-run') }))
    .then(() => mongoose.disconnect())
    .catch((err) => {
      console.error('[migrate] failed', err);
      process.exit(1);
    });
}

module.exports = { migrate };
