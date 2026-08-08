/**
 * Real-time Planning Poker over WebSockets.
 *
 * Scope: this is the ONLY realtime feature — a lightweight, in-memory poker
 * session per event ("room"). Votes are ephemeral (kept in memory during the
 * ceremony); only the final chosen estimate is persisted to the task.
 *
 * Protocol (JSON messages):
 *   client → server: { type: 'start'|'vote'|'reveal'|'cancel'|'estimate', ... }
 *   server → client: { type: 'presence'|'session'|'error', ... }
 *
 * Auth: the socket connects to /ws?token=<JWT>&event=<eventId>. The token is
 * verified once on connect; the user then joins that event's room.
 */
const { WebSocketServer } = require('ws');
const url = require('url');
const { verifyToken } = require('../utils/jwt');
const { User, MANAGER_ROLES } = require('../models/User');
const { Event } = require('../models/Event');
const { Group } = require('../models/Group');
const { Team } = require('../models/Team');
const { Task } = require('../models/Task');
const { ProjectMember } = require('../models/ProjectMember');
const { applyPatchWithHistory } = require('../utils/taskHistory');

// roomId (eventId) -> { clients: Set<ws>, session: null | {...} }
const rooms = new Map();

function getRoom(eventId) {
  if (!rooms.has(eventId)) rooms.set(eventId, { clients: new Set(), session: null });
  return rooms.get(eventId);
}

function presenceList(room) {
  const seen = new Map();
  for (const ws of room.clients) {
    if (ws.user && !seen.has(ws.user.id)) {
      seen.set(ws.user.id, { id: ws.user.id, displayName: ws.user.displayName, color: ws.user.color, role: ws.user.role });
    }
  }
  return Array.from(seen.values());
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Public view of the session. `revealed` gates whether vote *values* are sent;
// before reveal, only the list of who voted is exposed (values hidden).
function sessionView(room, forUser) {
  const s = room.session;
  if (!s) return { active: false };
  const voters = Array.from(s.votes.keys());
  const base = {
    active: true,
    taskId: s.taskId,
    taskTitle: s.taskTitle,
    deck: s.deck,
    durationSec: s.durationSec,
    startedAt: s.startedAt,
    launcherId: s.launcherId,
    launcherName: s.launcherName,
    allowMode: s.allow.mode,
    allowedUserIds: s.allowedUserIds ? Array.from(s.allowedUserIds) : null,
    voters, // ids that have voted (values hidden)
    revealed: s.revealed,
    myVote: s.votes.has(forUser.id) ? s.votes.get(forUser.id) : null,
  };
  if (s.revealed) {
    const votes = {};
    const numeric = [];
    const distribution = {};
    for (const [uid, val] of s.votes) {
      votes[uid] = val;
      distribution[val] = (distribution[val] || 0) + 1;
      const n = parseFloat(val);
      if (Number.isFinite(n)) numeric.push(n);
    }
    base.votes = votes;
    base.voterNames = s.voterNames; // id -> name snapshot
    base.distribution = distribution;
    base.suggestion = median(numeric);
    base.agreement = numeric.length > 0 && new Set(numeric).size === 1;
  }
  return base;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastSession(room) {
  for (const ws of room.clients) send(ws, { type: 'session', ...sessionView(room, ws.user) });
}
function broadcastPresence(room) {
  const members = presenceList(room);
  for (const ws of room.clients) send(ws, { type: 'presence', members });
}

async function resolveAllowed(projectId, allow) {
  // Returns a Set of allowed userIds, or null for "everyone connected".
  if (!allow || allow.mode === 'all') return null;
  const ids = allow.ids || [];
  if (allow.mode === 'users') return new Set(ids.map(String));
  if (allow.mode === 'group' || allow.mode === 'tag') {
    const groups = await Group.find({ _id: { $in: ids }, project: projectId });
    const set = new Set();
    for (const g of groups) for (const m of g.members) set.add(String(m));
    return set;
  }
  if (allow.mode === 'team') {
    const teams = await Team.find({ _id: { $in: ids }, project: projectId });
    const set = new Set();
    for (const t of teams) for (const m of t.members) set.add(String(m.user));
    return set;
  }
  if (allow.mode === 'role') {
    // Everyone whose *effective* project role is one of the selected roles.
    const roleSet = new Set(ids);
    const overrides = await ProjectMember.find({ project: projectId });
    const overrideMap = new Map(overrides.map((o) => [String(o.user), o.role]));
    const users = await User.find({ active: true }, '_id role');
    const set = new Set();
    for (const u of users) {
      const eff = u.role === 'superadmin' ? 'superadmin' : overrideMap.get(String(u._id)) || u.role;
      if (roleSet.has(eff)) set.add(String(u._id));
    }
    return set;
  }
  return null;
}

const isManager = (role) => MANAGER_ROLES.includes(role);

async function handleMessage(ws, room, data) {
  const user = ws.user;
  const s = room.session;

  switch (data.type) {
    case 'start': {
      // Only managers (SM/PO/lead/PM/superadmin) may launch a vote.
      if (!isManager(user.role)) return send(ws, { type: 'error', message: "Seul un manager (SM/PO…) peut lancer un vote." });
      const deck = Array.isArray(data.deck) && data.deck.length ? data.deck.map(String) : ['0.5', '1', '2', '3', '5', '8', '13', '?'];
      const allow = data.allow && ['all', 'group', 'tag', 'users', 'team', 'role'].includes(data.allow.mode)
        ? { mode: data.allow.mode, ids: data.allow.ids || [] }
        : { mode: 'all', ids: [] };
      const allowedUserIds = await resolveAllowed(ws.projectId, allow);
      room.session = {
        taskId: data.taskId || null,
        taskTitle: data.taskTitle || '',
        deck,
        durationSec: Math.max(5, Math.min(3600, Number(data.durationSec) || 60)),
        startedAt: Date.now(),
        launcherId: user.id,
        launcherName: user.displayName,
        allow,
        allowedUserIds,
        votes: new Map(),
        voterNames: {},
        revealed: false,
      };
      broadcastSession(room);
      return;
    }
    case 'vote': {
      if (!s || s.revealed) return;
      if (s.allowedUserIds && !s.allowedUserIds.has(user.id)) {
        return send(ws, { type: 'error', message: "Vous n'êtes pas autorisé à voter sur ce vote." });
      }
      if (!s.deck.includes(String(data.value))) return;
      s.votes.set(user.id, String(data.value));
      s.voterNames[user.id] = user.displayName;
      broadcastSession(room);
      return;
    }
    case 'unvote': {
      if (!s || s.revealed) return;
      s.votes.delete(user.id);
      broadcastSession(room);
      return;
    }
    case 'reveal': {
      if (!s) return;
      if (user.id !== s.launcherId && !isManager(user.role)) return; // only launcher / manager
      s.revealed = true;
      broadcastSession(room);
      return;
    }
    case 'cancel': {
      if (!s) return;
      if (user.id !== s.launcherId && !isManager(user.role)) return;
      room.session = null;
      broadcastSession(room);
      return;
    }
    case 'estimate': {
      if (!s) return;
      if (user.id !== s.launcherId && !isManager(user.role)) return;
      const value = parseFloat(data.value);
      if (s.taskId && Number.isFinite(value)) {
        const task = await Task.findOne({ project: ws.projectId, taskId: s.taskId });
        if (task) {
          applyPatchWithHistory(task, { complexity: value }, { _id: user._id, displayName: user.displayName }, 'Estimation Planning Poker.');
          await task.save();
        }
      }
      room.session = null;
      broadcastSession(room);
      for (const c of room.clients) send(c, { type: 'estimated', taskId: s.taskId, value });
      return;
    }
    default:
      return;
  }
}

function initPoker() {
  // noServer: the shared upgrade router in index.js routes /ws to this wss.
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws, req) => {
    try {
      const { query } = url.parse(req.url, true);
      const token = query.token;
      const eventId = query.event;
      if (!token || !eventId) return ws.close(4001, 'missing token/event');
      const payload = verifyToken(token);
      const dbUser = await User.findById(payload.sub);
      if (!dbUser || !dbUser.active) return ws.close(4003, 'invalid user');
      const event = await Event.findById(eventId);
      if (!event) return ws.close(4004, 'event not found');

      // Effective role in this project (override wins, except superadmin).
      const pm = await ProjectMember.findOne({ project: event.project, user: dbUser._id });
      const effectiveRole = dbUser.role === 'superadmin' ? 'superadmin' : (pm ? pm.role : dbUser.role);

      ws.user = { id: dbUser._id.toString(), _id: dbUser._id, displayName: dbUser.displayName, color: dbUser.color, role: effectiveRole };
      ws.projectId = event.project;
      ws.roomId = eventId;
      const room = getRoom(eventId);
      room.clients.add(ws);

      // Initial state to the newcomer, presence to everyone.
      send(ws, { type: 'session', ...sessionView(room, ws.user) });
      broadcastPresence(room);

      ws.on('message', (buf) => {
        let data;
        try { data = JSON.parse(buf.toString()); } catch { return; }
        handleMessage(ws, room, data).catch((e) => send(ws, { type: 'error', message: e.message }));
      });

      ws.on('close', () => {
        room.clients.delete(ws);
        if (room.clients.size === 0) rooms.delete(eventId);
        else broadcastPresence(room);
      });
    } catch (e) {
      try { ws.close(4000, 'error'); } catch { /* noop */ }
    }
  });

  return wss;
}

module.exports = { initPoker };
