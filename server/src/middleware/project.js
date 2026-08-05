const { Project } = require('../models/Project');

async function loadProject(req, res, next) {
  const key = String(req.params.projectKey || '').toUpperCase();
  const project = await Project.findOne({ key });
  if (!project) return res.status(404).json({ error: `Projet "${key}" introuvable.` });
  req.project = project;
  next();
}

module.exports = { loadProject };
