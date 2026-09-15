const { User } = require('../models/User');
const { Notification } = require('../models/Notification');
const { projectRoleFor } = require('../middleware/project');
const { plainTextOf } = require('./plainText');

// "@username" not preceded by a word char, "@", "." or "/" (emails, paths); code spans are ignored.
const MENTION_RE = /(^|[^\w@./-])@([a-z0-9][a-z0-9._-]{0,39})/gi;

function mentionedUsernames(text) {
  const names = new Set();
  const source = String(text || '').replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ');
  for (const m of source.matchAll(MENTION_RE)) names.add(m[2].toLowerCase().replace(/[._-]+$/, ''));
  return [...names];
}

// Active users named in `text` who can see the project.
async function resolveMentions(project, text) {
  const names = mentionedUsernames(text);
  if (!names.length) return [];
  const users = await User.find({ username: { $in: names }, active: true });
  return users.filter((u) => projectRoleFor(project, u));
}

const excerptOf = plainTextOf;

/**
 * recipients: [{ user, type }] in priority order — a user only gets the first
 * matching notification, and the actor is never notified of their own action.
 */
async function notify(project, actor, base, recipients) {
  const seen = new Set([String(actor?._id ?? '')]);
  const docs = [];
  for (const r of recipients) {
    const id = r.user && String(r.user._id ?? r.user);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    docs.push({
      user: id,
      project: project._id,
      projectKey: project.key,
      type: r.type,
      actor: actor?._id || null,
      actorLabel: actor?.displayName,
      ...base,
      ...(r.data || {}),
    });
  }
  if (!docs.length) return 0;
  try {
    await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error('[notify]', err.message);
  }
  return docs.length;
}

module.exports = { mentionedUsernames, resolveMentions, excerptOf, notify };
