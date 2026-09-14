const { Router } = require('express');
const mongoose = require('mongoose');
const { Notification } = require('../models/Notification');
const { requireAuth } = require('../middleware/auth');

// Current user's notifications. The client loads them once per page load
// (no websocket / polling) and marks them read explicitly.
const router = Router();
router.use(requireAuth);

const unreadCount = (userId) => Notification.countDocuments({ user: userId, read: false });

router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const filter = { user: req.user._id, ...(['1', 'true'].includes(String(req.query.unread)) ? { read: false } : {}) };
  const [notifications, unread] = await Promise.all([
    Notification.find(filter).sort({ read: 1, createdAt: -1 }).limit(limit).populate('actor', 'username displayName color').lean(),
    unreadCount(req.user._id),
  ]);
  res.json({ notifications, unread });
});

// { ids: [...] } or { all: true }
router.post('/read', async (req, res) => {
  const b = req.body || {};
  const filter = { user: req.user._id, read: false };
  if (!b.all) {
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return res.status(400).json({ error: 'ids ou all requis.', code: 'NO_NOTIFICATIONS' });
    filter._id = { $in: ids };
  }
  const result = await Notification.updateMany(filter, { $set: { read: true, readAt: new Date() } });
  res.json({ updated: result.modifiedCount, unread: await unreadCount(req.user._id) });
});

// Removes notifications already read.
router.delete('/read', async (req, res) => {
  const result = await Notification.deleteMany({ user: req.user._id, read: true });
  res.json({ deleted: result.deletedCount });
});

module.exports = router;
