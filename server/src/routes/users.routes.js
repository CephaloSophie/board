const { Router } = require('express');
const { User, ROLES } = require('../models/User');
const { hashPassword } = require('../utils/password');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);

// Every authenticated user can see the developer roster (needed for assignee pickers).
router.get('/', async (req, res) => {
  const users = await User.find({ active: true }).sort({ displayName: 1 });
  res.json({ users: users.map((u) => u.toPublic()) });
});

router.post('/', requireRole('superadmin'), async (req, res) => {
  const { username, email, displayName, password, role, color } = req.body || {};
  if (!username || !displayName || !password) {
    return res.status(400).json({ error: "username, displayName et password sont requis." });
  }
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ error: `role invalide (attendu: ${ROLES.join(', ')}).` });
  }
  const exists = await User.findOne({ username: username.toLowerCase().trim() });
  if (exists) return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    username: username.toLowerCase().trim(),
    email,
    displayName,
    passwordHash,
    role: role || 'developer',
    color,
  });
  res.status(201).json({ user: user.toPublic() });
});

router.patch('/:id', requireRole('superadmin'), async (req, res) => {
  const { displayName, email, role, color, active, password } = req.body || {};
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });

  if (displayName !== undefined) user.displayName = displayName;
  if (email !== undefined) user.email = email;
  if (color !== undefined) user.color = color;
  if (active !== undefined) user.active = active;
  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'role invalide.' });
    user.role = role;
  }
  if (password) user.passwordHash = await hashPassword(password);

  await user.save();
  res.json({ user: user.toPublic() });
});

router.delete('/:id', requireRole('superadmin'), async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ error: 'Vous ne pouvez pas vous supprimer vous-même.' });
  }
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable.' });
  // Soft-delete: keep history/task references (author/assignee) intact.
  user.active = false;
  await user.save();
  res.json({ ok: true });
});

module.exports = router;
