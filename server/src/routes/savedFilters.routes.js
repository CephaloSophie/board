const { Router } = require('express');
const { SavedFilter, sanitizeFilters, VIEWS, VISIBILITIES, GROUP_KEYS, SORT_KEYS } = require('../models/SavedFilter');
const { requireAuth } = require('../middleware/auth');
const { loadProject } = require('../middleware/project');

// Saved filters are personal: they stay usable on archived projects and by viewers.
const router = Router({ mergeParams: true });
router.use(requireAuth, loadProject);

const OWNER_FIELDS = 'username displayName color';
const sameId = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);

// Per-viewer projection: hide who starred/defaulted a filter, expose flags.
function present(filter, req) {
  const o = filter.toObject();
  const { starredBy = [], defaultFor = [], ...rest } = o;
  return {
    ...rest,
    isOwner: sameId(filter.owner, req.user._id),
    canEdit: canEdit(filter, req),
    isStarred: starredBy.some((id) => sameId(id, req.user._id)),
    isDefault: defaultFor.some((id) => sameId(id, req.user._id)),
    starCount: starredBy.length,
  };
}

function canView(filter, req) {
  return filter.visibility === 'shared' || sameId(filter.owner, req.user._id);
}

// Owner, or a project admin for shared filters.
function canEdit(filter, req) {
  return sameId(filter.owner, req.user._id) || (filter.visibility === 'shared' && req.projectRole === 'admin');
}

async function findVisible(req, res) {
  const filter = await SavedFilter.findOne({ _id: req.params.id, project: req.project._id }).populate('owner', OWNER_FIELDS);
  if (!filter || !canView(filter, req)) {
    res.status(404).json({ error: 'Filtre introuvable ou non partagé.', code: 'FILTER_NOT_FOUND' });
    return null;
  }
  return filter;
}

function validationError(body) {
  if (body.view !== undefined && !VIEWS.includes(body.view)) return 'Vue invalide.';
  if (body.groupBy !== undefined && !GROUP_KEYS.includes(body.groupBy)) return 'Regroupement invalide.';
  if (body.sort !== undefined && (typeof body.sort !== 'object' || !SORT_KEYS.includes(String(body.sort?.key)))) {
    return 'Clé de tri invalide.';
  }
  if (body.visibility !== undefined && !VISIBILITIES.includes(body.visibility)) return 'Visibilité invalide.';
  return null;
}

function applyBody(filter, body) {
  if (body.name !== undefined) filter.name = String(body.name).trim();
  if (body.description !== undefined) filter.description = String(body.description || '');
  if (body.filters !== undefined) filter.filters = sanitizeFilters(body.filters);
  if (body.view !== undefined) filter.view = body.view;
  if (body.groupBy !== undefined) filter.groupBy = body.groupBy;
  if (body.sort !== undefined) filter.sort = { key: String(body.sort.key), dir: Number(body.sort.dir) === -1 ? -1 : 1 };
  if (body.visibility !== undefined) filter.visibility = body.visibility;
}

async function nameTaken(req, ownerId, name, exceptId) {
  const q = { project: req.project._id, owner: ownerId, name };
  if (exceptId) q._id = { $ne: exceptId };
  return !!(await SavedFilter.exists(q));
}

router.get('/', async (req, res) => {
  const filters = await SavedFilter.find({
    project: req.project._id,
    $or: [{ owner: req.user._id }, { visibility: 'shared' }],
  })
    .populate('owner', OWNER_FIELDS)
    .sort({ name: 1 });
  res.json({ filters: filters.map((f) => present(f, req)) });
});

router.get('/:id', async (req, res) => {
  const filter = await findVisible(req, res);
  if (filter) res.json({ filter: present(filter, req) });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Le nom du filtre est requis.' });
  const invalid = validationError(body);
  if (invalid) return res.status(400).json({ error: invalid });
  if (await nameTaken(req, req.user._id, name)) {
    return res.status(409).json({ error: `Vous avez déjà un filtre nommé "${name}".` });
  }

  const filter = new SavedFilter({ project: req.project._id, owner: req.user._id, name });
  applyBody(filter, { ...body, filters: body.filters ?? {} });
  if (body.isStarred) filter.starredBy = [req.user._id];
  if (body.isDefault) {
    await SavedFilter.updateMany({ project: req.project._id }, { $pull: { defaultFor: req.user._id } });
    filter.defaultFor = [req.user._id];
  }
  await filter.save();
  await filter.populate('owner', OWNER_FIELDS);
  res.status(201).json({ filter: present(filter, req) });
});

router.post('/:id/duplicate', async (req, res) => {
  const source = await findVisible(req, res);
  if (!source) return;
  const name = String(req.body?.name || `${source.name} (copie)`).trim();
  if (await nameTaken(req, req.user._id, name)) {
    return res.status(409).json({ error: `Vous avez déjà un filtre nommé "${name}".` });
  }
  const copy = await SavedFilter.create({
    project: req.project._id,
    owner: req.user._id,
    name,
    description: source.description,
    filters: sanitizeFilters(source.filters),
    view: source.view,
    groupBy: source.groupBy,
    sort: source.sort,
    visibility: 'private',
  });
  await copy.populate('owner', OWNER_FIELDS);
  res.status(201).json({ filter: present(copy, req) });
});

router.patch('/:id', async (req, res) => {
  const filter = await findVisible(req, res);
  if (!filter) return;
  if (!canEdit(filter, req)) {
    return res.status(403).json({ error: 'Seul le propriétaire peut modifier ce filtre.' });
  }
  const body = req.body || {};
  const invalid = validationError(body);
  if (invalid) return res.status(400).json({ error: invalid });
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return res.status(400).json({ error: 'Le nom du filtre est requis.' });
    if (await nameTaken(req, filter.owner._id, name, filter._id)) {
      return res.status(409).json({ error: `Un filtre nommé "${name}" existe déjà pour ce propriétaire.` });
    }
  }
  applyBody(filter, body);
  await filter.save();
  res.json({ filter: present(filter, req) });
});

router.delete('/:id', async (req, res) => {
  const filter = await findVisible(req, res);
  if (!filter) return;
  if (!canEdit(filter, req)) {
    return res.status(403).json({ error: 'Seul le propriétaire peut supprimer ce filtre.' });
  }
  await filter.deleteOne();
  res.json({ ok: true });
});

// Personal flags — allowed on any filter the user can see.
router.put('/:id/star', async (req, res) => {
  const filter = await findVisible(req, res);
  if (!filter) return;
  const op = req.body?.starred === false ? '$pull' : '$addToSet';
  await SavedFilter.updateOne({ _id: filter._id }, { [op]: { starredBy: req.user._id } });
  const fresh = await SavedFilter.findById(filter._id).populate('owner', OWNER_FIELDS);
  res.json({ filter: present(fresh, req) });
});

router.put('/:id/default', async (req, res) => {
  const filter = await findVisible(req, res);
  if (!filter) return;
  // At most one default per user per project.
  await SavedFilter.updateMany({ project: req.project._id }, { $pull: { defaultFor: req.user._id } });
  if (req.body?.isDefault !== false) {
    await SavedFilter.updateOne({ _id: filter._id }, { $addToSet: { defaultFor: req.user._id } });
  }
  const fresh = await SavedFilter.findById(filter._id).populate('owner', OWNER_FIELDS);
  res.json({ filter: present(fresh, req) });
});

module.exports = router;
