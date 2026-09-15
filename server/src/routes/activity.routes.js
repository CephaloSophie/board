const { Router } = require('express');
const mongoose = require('mongoose');
const { Activity } = require('../models/Activity');
const { Project } = require('../models/Project');
const { requireAuth } = require('../middleware/auth');
const { loadProject, projectRoleFor } = require('../middleware/project');

const USER_FIELDS = 'username displayName color';
const SCOPES = ['task', 'comment', 'sprint', 'version', 'project', 'import'];
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
const dateOf = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * Query params: user (ids), scope, action, field, taskId, sprint, version,
 * from / to (ISO or YYYY-MM-DD, inclusive), q (text), limit, cursor ("<iso>|<id>").
 */
function buildMatch(query) {
  const and = [];
  const users = list(query.user).filter((id) => mongoose.isValidObjectId(id));
  if (users.length) and.push({ actor: { $in: users } });
  const scopes = list(query.scope).filter((s) => SCOPES.includes(s));
  if (scopes.length) and.push({ scope: { $in: scopes } });
  const actions = list(query.action);
  if (actions.length) and.push({ action: { $in: actions } });
  const fields = list(query.field);
  if (fields.length) and.push({ field: { $in: fields } });
  if (query.taskId) and.push({ taskId: String(query.taskId).trim().toUpperCase() });
  const sprints = list(query.sprint);
  if (sprints.length) and.push({ sprints: { $in: sprints } });
  const versions = list(query.version);
  if (versions.length) and.push({ versions: { $in: versions } });
  const from = dateOf(query.from);
  if (from) and.push({ at: { $gte: from } });
  const to = dateOf(query.to);
  if (to) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.to))) to.setUTCDate(to.getUTCDate() + 1);
    and.push({ at: { $lt: to } });
  }
  if (query.q && String(query.q).trim()) {
    const rx = new RegExp(escapeRegex(String(query.q).trim()), 'i');
    and.push({ $or: [{ taskId: rx }, { taskTitle: rx }, { note: rx }, { actorLabel: rx }, { to: rx }, { from: rx }] });
  }
  const [cursorAt, cursorId] = String(query.cursor || '').split('|');
  const at = dateOf(cursorAt);
  if (at && mongoose.isValidObjectId(cursorId)) {
    and.push({ $or: [{ at: { $lt: at } }, { at, _id: { $lt: new mongoose.Types.ObjectId(cursorId) } }] });
  }
  return and;
}

async function page(match, query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 200);
  const rows = await Activity.find(match).sort({ at: -1, _id: -1 }).limit(limit + 1).populate('actor', USER_FIELDS).lean();
  const entries = rows.slice(0, limit);
  const last = entries[entries.length - 1];
  return { entries, nextCursor: rows.length > limit && last ? `${new Date(last.at).toISOString()}|${last._id}` : null };
}

// /api/projects/:projectKey/activity
const projectRouter = Router({ mergeParams: true });
projectRouter.use(requireAuth, loadProject);
projectRouter.get('/', async (req, res) => {
  const and = buildMatch(req.query);
  const result = await page({ project: req.project._id, ...(and.length ? { $and: and } : {}) }, req.query);
  res.json({ ...result, entries: result.entries.map((e) => ({ ...e, projectKey: req.project.key })) });
});

// /api/activity?project=KB,KYDOS — every project the user can see.
const globalRouter = Router();
globalRouter.use(requireAuth);
globalRouter.get('/', async (req, res) => {
  const keys = list(req.query.project).map((k) => k.toUpperCase());
  const projects = (await Project.find(keys.length ? { key: { $in: keys } } : {}, { key: 1, name: 1, owner: 1, members: 1, access: 1 }).lean()).filter(
    (p) => projectRoleFor(p, req.user)
  );
  const byId = new Map(projects.map((p) => [String(p._id), p.key]));
  const and = buildMatch(req.query);
  const result = await page({ project: { $in: projects.map((p) => p._id) }, ...(and.length ? { $and: and } : {}) }, req.query);
  res.json({ ...result, entries: result.entries.map((e) => ({ ...e, projectKey: byId.get(String(e.project)) })) });
});

module.exports = { projectRouter, globalRouter };
