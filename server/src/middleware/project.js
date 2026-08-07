const { Project } = require('../models/Project');
const { ProjectMember } = require('../models/ProjectMember');
const { MANAGER_ROLES } = require('../models/User');

async function loadProject(req, res, next) {
  const key = String(req.params.projectKey || '').toUpperCase();
  const project = await Project.findOne({ key });
  if (!project) return res.status(404).json({ error: `Projet "${key}" introuvable.` });
  req.project = project;
  // Resolve the per-project role override for the current user (if any).
  if (req.user) {
    const pm = await ProjectMember.findOne({ project: project._id, user: req.user._id });
    req.projectRole = pm ? pm.role : null;
  }
  next();
}

// Effective role in the current project: the project-scoped override if set,
// otherwise the global account role. Superadmin is always superadmin.
function effectiveRole(req) {
  if (req.user?.role === 'superadmin') return 'superadmin';
  return req.projectRole || req.user?.role || null;
}

function isProjectManager(req) {
  return req.user?.role === 'superadmin' || MANAGER_ROLES.includes(effectiveRole(req));
}

function requireProjectManager(req, res, next) {
  if (isProjectManager(req)) return next();
  return res.status(403).json({ error: 'Droits insuffisants sur ce projet.' });
}

module.exports = { loadProject, effectiveRole, isProjectManager, requireProjectManager };
