const { Router } = require('express');
const { User } = require('../models/User');
const { verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/jwt');
const { requireAuth } = require('../middleware/auth');

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }
  const user = await User.findOne({ username: String(username).toLowerCase().trim() });
  if (!user || !user.active) {
    return res.status(401).json({ error: "Identifiants incorrects." });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Identifiants incorrects." });
  const token = signToken(user);
  res.json({ token, user: user.toPublic() });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

module.exports = router;
