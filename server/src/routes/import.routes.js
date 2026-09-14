const { Router } = require('express');
const { ImportJob } = require('../models/ImportJob');
const { requireAuth } = require('../middleware/auth');
const { loadProject, requireProjectRole, blockWritesIfArchived } = require('../middleware/project');
const { parseImportFiles } = require('../import/jira/parseFiles');
const { runJiraImport, rollbackImport } = require('../import/jira/importer');
const { importError } = require('../import/jira/text');

// Mounted after a 25 MB JSON parser (see index.js). Project admins only.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject, requireProjectRole('admin'), blockWritesIfArchived);

const MAX_FILE_CHARS = 20 * 1024 * 1024;

function bundleFrom(req) {
  const { files, options = {} } = req.body || {};
  for (const f of Array.isArray(files) ? files : []) {
    if (String(f?.content ?? '').length > MAX_FILE_CHARS) throw importError(413, 'PAYLOAD_TOO_LARGE', `${f.name} dépasse 20 Mo.`);
  }
  return parseImportFiles(files, {
    timezone: options.timezone || req.project.timezone || 'Europe/Paris',
    extractAcceptanceCriteria: options.extractAcceptance !== false,
  });
}

// Detect formats, suggest correspondences and simulate with them.
router.post('/jira/analyze', async (req, res) => {
  const bundle = bundleFrom(req);
  const result = await runJiraImport({
    project: req.project,
    user: req.user,
    bundle,
    mapping: req.body?.mapping,
    options: req.body?.options,
    dryRun: true,
  });
  res.json(result);
});

// { files, mapping, options, dryRun } — dryRun defaults to true.
router.post('/jira', async (req, res) => {
  const bundle = bundleFrom(req);
  const dryRun = req.body?.dryRun !== false;
  const result = await runJiraImport({
    project: req.project,
    user: req.user,
    bundle,
    mapping: req.body?.mapping,
    options: req.body?.options,
    dryRun,
  });
  res.status(dryRun ? 200 : 201).json(result);
});

router.get('/jobs', async (req, res) => {
  const jobs = await ImportJob.find({ project: req.project._id }, { rows: 0, updates: 0, mapping: 0 })
    .populate('createdBy', 'username displayName color')
    .sort({ createdAt: -1 })
    .limit(50);
  res.json({ jobs });
});

router.get('/jobs/:id', async (req, res) => {
  const job = await ImportJob.findOne({ _id: req.params.id, project: req.project._id }, { updates: 0 }).populate('createdBy', 'username displayName color');
  if (!job) return res.status(404).json({ error: 'Import introuvable.' });
  res.json({ job });
});

router.post('/jobs/:id/rollback', async (req, res) => {
  const report = await rollbackImport({ project: req.project, user: req.user, jobId: req.params.id });
  res.json({ report });
});

module.exports = router;
