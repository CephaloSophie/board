/**
 * BOARD-001 data migration — idempotent, safe to re-run (a second run reports 0 change).
 *
 *   npm run migrate:board-001              apply
 *   npm run migrate:board-001 -- --dry-run count what would change, write nothing
 *
 * Converts the legacy acceptance criteria (`Task.acceptance`, a list of strings)
 * into structured criteria (`Task.criteria[]`: text, done flag, comments). The
 * string list is kept as a mirror. Tasks that already have criteria are left
 * untouched. Without this migration the conversion still happens lazily, task by
 * task, the first time a task is opened.
 * Works on the raw collection so `updatedAt` and the history are not touched.
 */
const { mongoose } = require('../db');
const { Task } = require('../models/Task');

async function migrate({ dryRun = false, logger = console } = {}) {
  const T = Task.collection;
  const stats = { tasks: 0, criteria: 0 };
  const cursor = T.find(
    { 'acceptance.0': { $exists: true }, $or: [{ criteria: { $exists: false } }, { criteria: { $size: 0 } }] },
    { projection: { acceptance: 1, createdAt: 1 } }
  );
  for await (const task of cursor) {
    const at = task.createdAt || new Date();
    const criteria = (task.acceptance || [])
      .map((t) => String(t ?? '').trim())
      .filter(Boolean)
      .map((text) => ({ _id: new mongoose.Types.ObjectId(), text, done: false, doneAt: null, doneBy: null, createdBy: null, comments: [], createdAt: at, updatedAt: at }));
    if (!criteria.length) continue;
    stats.tasks += 1;
    stats.criteria += criteria.length;
    if (!dryRun) {
      await T.updateOne({ _id: task._id }, { $set: { criteria, acceptance: criteria.map((c) => c.text) } });
    }
  }
  logger.log(`[migrate:board-001] ${dryRun ? '(dry-run) ' : ''}${stats.tasks} tâche(s), ${stats.criteria} critère(s) convertis`);
  return { stats, total: stats.tasks };
}

if (require.main === module) {
  const { connectDb } = require('../db');
  connectDb()
    .then(() => migrate({ dryRun: process.argv.includes('--dry-run') }))
    .then(() => mongoose.disconnect())
    .catch((err) => {
      console.error('[migrate:board-001] failed', err);
      process.exit(1);
    });
}

module.exports = { migrate };
