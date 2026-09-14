const crypto = require('crypto');
const { Router } = require('express');
const { Attachment } = require('../models/Attachment');
const { requireAuth } = require('../middleware/auth');
const { loadProject, requireWriteAccess, blockWritesIfArchived } = require('../middleware/project');
const { httpError } = require('../utils/httpError');

const MAX_BYTES = 8 * 1024 * 1024;
// Raster images only (no SVG: it can carry scripts). The signature is checked, not just the declared type.
const SIGNATURES = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => b.subarray(0, 4).toString('ascii') === 'GIF8',
  'image/webp': (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

const safeName = (name) =>
  String(name || 'image')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';

// POST /api/projects/:projectKey/attachments { name, data: base64 | data URL, taskId? }
const projectRouter = Router({ mergeParams: true });
projectRouter.use(requireAuth, loadProject, blockWritesIfArchived, requireWriteAccess);
projectRouter.post('/', async (req, res) => {
  const b = req.body || {};
  const raw = String(b.data || '');
  const dataUrl = /^data:([\w/+.-]+);base64,/.exec(raw);
  const buffer = Buffer.from(dataUrl ? raw.slice(dataUrl[0].length) : raw, 'base64');
  if (!buffer.length) throw httpError(400, 'ATTACHMENT_EMPTY', 'Fichier vide.');
  if (buffer.length > MAX_BYTES) throw httpError(413, 'ATTACHMENT_TOO_LARGE', 'Image trop lourde (8 Mo maximum).');
  const mimeType = Object.keys(SIGNATURES).find((type) => SIGNATURES[type](buffer));
  if (!mimeType) throw httpError(415, 'ATTACHMENT_TYPE', 'Format non pris en charge (PNG, JPEG, GIF ou WebP).');

  const name = safeName(b.name);
  const attachment = await Attachment.create({
    project: req.project._id,
    publicId: crypto.randomBytes(18).toString('base64url'),
    uploader: req.user._id,
    taskId: b.taskId ? String(b.taskId).toUpperCase() : undefined,
    name,
    mimeType,
    size: buffer.length,
    data: buffer,
  });
  res.status(201).json({
    attachment: { id: attachment._id, name, mimeType, size: buffer.length, url: `/api/files/${attachment.publicId}/${encodeURIComponent(name)}` },
  });
});

// GET /api/files/:publicId/:name — public by unguessable id so <img> works without auth headers.
const fileRouter = Router();
fileRouter.get('/:publicId/:name?', async (req, res) => {
  const file = await Attachment.findOne({ publicId: req.params.publicId }, { data: 1, mimeType: 1, name: 1 }).lean();
  if (!file) return res.status(404).json({ error: 'Fichier introuvable.' });
  res.set({
    'Content-Type': file.mimeType,
    'Content-Disposition': `inline; filename="${file.name}"`,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
  });
  res.send(Buffer.from(file.data.buffer ?? file.data));
});

module.exports = { projectRouter, fileRouter, MAX_BYTES };
