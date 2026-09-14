const { Project } = require('../models/Project');

const ROLE_RANK = { viewer: 1, member: 2, admin: 3 };

/**
 * Effective role of `user` on `project`: superadmins and the owner are admins,
 * listed members keep their role, other active users are members of an
 * 'open' project and have no access to a 'members' one (null).
 */
function projectRoleFor(project, user) {
  if (!project || !user) return null;
  if (user.role === 'superadmin') return 'admin';
  const uid = String(user._id ?? user.id);
  if (project.owner && String(project.owner._id ?? project.owner) === uid) return 'admin';
  const member = (project.members || []).find((m) => String(m.user?._id ?? m.user) === uid);
  if (member) return member.role;
  return project.access === 'members' ? null : 'member';
}

async function loadProject(req, res, next) {
  const key = String(req.params.projectKey || '').toUpperCase();
  const project = await Project.findOne({ key });
  const role = projectRoleFor(project, req.user);
  // Same answer for "missing" and "not allowed": never reveal a private project.
  if (!project || !role) return res.status(404).json({ error: `Projet "${key}" introuvable.` });
  req.project = project;
  req.projectRole = role;
  next();
}

function requireProjectRole(minRole) {
  return (req, res, next) => {
    if ((ROLE_RANK[req.projectRole] || 0) >= ROLE_RANK[minRole]) return next();
    return res.status(403).json({
      error: minRole === 'admin' ? 'Action réservée aux administrateurs du projet.' : 'Droits insuffisants sur ce projet.',
      code: 'PROJECT_ROLE_REQUIRED',
    });
  };
}

// Viewers may read everything but change nothing.
function requireWriteAccess(req, res, next) {
  if (req.method === 'GET' || req.projectRole !== 'viewer') return next();
  return res.status(403).json({ error: 'Accès en lecture seule sur ce projet.', code: 'READ_ONLY_ROLE' });
}

function blockWritesIfArchived(req, res, next) {
  if (req.method === 'GET' || !req.project?.archived) return next();
  return res.status(423).json({ error: 'Projet archivé : lecture seule.', code: 'PROJECT_ARCHIVED' });
}

module.exports = { loadProject, projectRoleFor, requireProjectRole, requireWriteAccess, blockWritesIfArchived, ROLE_RANK };
