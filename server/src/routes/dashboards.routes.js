const { Router } = require('express');
const { Dashboard } = require('../models/Dashboard');
const { sanitizeFilters } = require('../models/SavedFilter');
const { requireAuth } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');
const { sanitizeWidgets, TEMPLATES } = require('../dashboards/widgets');

// Dashboards are personal configuration: usable by every project reader, even on archived projects.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

const USER_FIELDS = 'username displayName color';
const sameId = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);
const canView = (d, req) => d.visibility === 'shared' || sameId(d.owner, req.user._id);
const canEdit = (d, req) => sameId(d.owner, req.user._id) || (d.visibility === 'shared' && req.projectRole === 'admin');

function present(d, req, { withWidgets = true } = {}) {
  const { starredBy = [], defaultFor = [], widgets = [], ...rest } = d.toObject ? d.toObject() : d;
  return {
    ...rest,
    ...(withWidgets ? { widgets } : { widgetCount: widgets.length }),
    isOwner: sameId(d.owner, req.user._id),
    canEdit: canEdit(d, req),
    isStarred: starredBy.some((id) => sameId(id, req.user._id)),
    isDefault: defaultFor.some((id) => sameId(id, req.user._id)),
  };
}

async function findVisible(req, res) {
  const d = await Dashboard.findOne({ _id: req.params.id, project: req.project._id }).populate('owner', USER_FIELDS);
  if (!d || !canView(d, req)) {
    res.status(404).json({ error: 'Dashboard introuvable ou non partagé.', code: 'DASHBOARD_NOT_FOUND' });
    return null;
  }
  return d;
}

const nameTaken = (req, owner, name, exceptId) =>
  Dashboard.exists({ project: req.project._id, owner, name, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });

router.get('/', async (req, res) => {
  const list = await Dashboard.find({ project: req.project._id, $or: [{ owner: req.user._id }, { visibility: 'shared' }] })
    .populate('owner', USER_FIELDS)
    .sort({ name: 1 });
  res.json({ dashboards: list.map((d) => present(d, req, { withWidgets: false })), templates: Object.keys(TEMPLATES) });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Le nom du dashboard est requis.' });
  if (await nameTaken(req, req.user._id, name)) return res.status(409).json({ error: `Vous avez déjà un dashboard nommé "${name}".` });
  const template = TEMPLATES[b.template] || TEMPLATES.blank;
  const d = new Dashboard({
    project: req.project._id,
    owner: req.user._id,
    updatedBy: req.user._id,
    name,
    description: String(b.description || ''),
    visibility: b.visibility === 'shared' ? 'shared' : 'private',
    globalFilters: sanitizeFilters(b.globalFilters || template.globalFilters),
    widgets: sanitizeWidgets(b.widgets || template.widgets),
    starredBy: b.isStarred ? [req.user._id] : [],
  });
  if (b.isDefault) {
    await Dashboard.updateMany({ project: req.project._id }, { $pull: { defaultFor: req.user._id } });
    d.defaultFor = [req.user._id];
  }
  await d.save();
  await d.populate('owner', USER_FIELDS);
  res.status(201).json({ dashboard: present(d, req) });
});

router.get('/:id', async (req, res) => {
  const d = await findVisible(req, res);
  if (d) res.json({ dashboard: present(d, req) });
});

// Optimistic concurrency: `revision` must match, otherwise 409 REVISION_CONFLICT.
router.patch('/:id', async (req, res) => {
  const d = await findVisible(req, res);
  if (!d) return;
  if (!canEdit(d, req)) return res.status(403).json({ error: 'Seul le propriétaire peut modifier ce dashboard.' });
  const b = req.body || {};
  const set = { updatedBy: req.user._id };
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return res.status(400).json({ error: 'Le nom du dashboard est requis.' });
    if (await nameTaken(req, d.owner._id, name, d._id)) return res.status(409).json({ error: `Un dashboard nommé "${name}" existe déjà.` });
    set.name = name;
  }
  if (b.description !== undefined) set.description = String(b.description || '');
  if (b.visibility !== undefined) set.visibility = b.visibility === 'shared' ? 'shared' : 'private';
  if (b.globalFilters !== undefined) set.globalFilters = sanitizeFilters(b.globalFilters);
  if (b.widgets !== undefined) set.widgets = sanitizeWidgets(b.widgets);
  const updated = await Dashboard.findOneAndUpdate(
    { _id: d._id, revision: Number(b.revision) },
    { $set: set, $inc: { revision: 1 } },
    { new: true }
  ).populate('owner', USER_FIELDS);
  if (!updated) {
    const current = await Dashboard.findById(d._id).populate('updatedBy', USER_FIELDS).lean();
    return res.status(409).json({
      error: 'Ce dashboard a été modifié entre-temps.',
      code: 'REVISION_CONFLICT',
      current: { revision: current.revision, updatedAt: current.updatedAt, updatedBy: current.updatedBy?.displayName || null },
    });
  }
  res.json({ dashboard: present(updated, req) });
});

router.delete('/:id', async (req, res) => {
  const d = await findVisible(req, res);
  if (!d) return;
  if (!canEdit(d, req)) return res.status(403).json({ error: 'Seul le propriétaire peut supprimer ce dashboard.' });
  await d.deleteOne();
  res.json({ ok: true });
});

router.post('/:id/duplicate', async (req, res) => {
  const d = await findVisible(req, res);
  if (!d) return;
  const name = String(req.body?.name || `${d.name} (copie)`).trim();
  if (await nameTaken(req, req.user._id, name)) return res.status(409).json({ error: `Vous avez déjà un dashboard nommé "${name}".` });
  const copy = await Dashboard.create({
    project: req.project._id,
    owner: req.user._id,
    updatedBy: req.user._id,
    name,
    description: d.description,
    visibility: 'private',
    globalFilters: d.globalFilters,
    widgets: sanitizeWidgets(d.widgets.map((w) => (w.toObject ? w.toObject() : w))),
  });
  await copy.populate('owner', USER_FIELDS);
  res.status(201).json({ dashboard: present(copy, req) });
});

router.put('/:id/star', async (req, res) => {
  const d = await findVisible(req, res);
  if (!d) return;
  await Dashboard.updateOne({ _id: d._id }, { [req.body?.starred === false ? '$pull' : '$addToSet']: { starredBy: req.user._id } });
  res.json({ dashboard: present(await Dashboard.findById(d._id).populate('owner', USER_FIELDS), req) });
});

router.put('/:id/default', async (req, res) => {
  const d = await findVisible(req, res);
  if (!d) return;
  await Dashboard.updateMany({ project: req.project._id }, { $pull: { defaultFor: req.user._id } });
  if (req.body?.isDefault !== false) await Dashboard.updateOne({ _id: d._id }, { $addToSet: { defaultFor: req.user._id } });
  res.json({ dashboard: present(await Dashboard.findById(d._id).populate('owner', USER_FIELDS), req) });
});

module.exports = router;
