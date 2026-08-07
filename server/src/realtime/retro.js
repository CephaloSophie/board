/**
 * Real-time interactive Retrospective over WebSockets (same channel family as
 * the poker, but its own path /wsretro). A retro is persisted in Mongo; the
 * live session mutates that document and broadcasts state to the room.
 *
 * Phases: lobby → rating → ssc → voting → actions → closing → done.
 * Reveal gates keep individual ratings / stickies / votes hidden until the
 * facilitator reveals them (avoids anchoring / groupthink).
 */
const { WebSocketServer } = require('ws');
const url = require('url');
const { verifyToken } = require('../utils/jwt');
const { User } = require('../models/User');
const { Retro } = require('../models/Retro');
const { ProjectMember } = require('../models/ProjectMember');
const { MANAGER_ROLES } = require('../models/User');

// retroId -> { clients:Set<ws> }
const rooms = new Map();
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { clients: new Set() });
  return rooms.get(id);
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function presenceList(room) {
  const seen = new Map();
  for (const ws of room.clients) {
    if (ws.user && !seen.has(ws.user.id)) seen.set(ws.user.id, ws.user);
  }
  return Array.from(seen.values());
}

function isFacilitator(retro, user) {
  return String(retro.facilitator) === user.id || user.role === 'superadmin' || MANAGER_ROLES.includes(user.role);
}

function avg(nums) {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

// Public view of the retro, gated by reveal flags and the requesting user.
function view(retro, room, user) {
  const meVote = retro.votes.filter((v) => String(v.user) === user.id);
  const v = {
    id: retro._id,
    sprint: retro.sprint,
    team: retro.team,
    title: retro.title,
    facilitator: retro.facilitator,
    phase: retro.phase,
    status: retro.status,
    invited: retro.invited,
    absent: retro.absent,
    online: presenceList(room).map((u) => u.id),

    // rating phase
    ratingRevealed: retro.ratingRevealed,
    myRating: (retro.ratings.find((r) => String(r.user) === user.id) || {}).value ?? null,
    ratedBy: retro.ratings.map((r) => String(r.user)),
    ratings: retro.ratingRevealed ? retro.ratings : undefined,
    ratingAvg: retro.ratingRevealed ? avg(retro.ratings.map((r) => r.value).filter((x) => x != null)) : undefined,

    // ssc phase
    sscRevealed: retro.sscRevealed,
    timerEndsAt: retro.timerEndsAt,
    speakerOrder: retro.speakerOrder,
    speakerIndex: retro.speakerIndex,
    // Before reveal, each user sees only their own stickies; after reveal, all.
    stickies: retro.sscRevealed ? retro.stickies : retro.stickies.filter((s) => String(s.author) === user.id),
    stickyCounts: retro.stickies.reduce((m, s) => {
      m[String(s.author)] = (m[String(s.author)] || 0) + 1;
      return m;
    }, {}),

    // voting phase
    votesConfig: retro.votesConfig,
    myVotes: meVote.map((x) => ({ stickyId: x.stickyId, points: x.points })),
    votesRevealed: retro.votesRevealed,
    voteScores: retro.votesRevealed
      ? retro.votes.reduce((m, x) => {
          m[x.stickyId] = (m[x.stickyId] || 0) + x.points;
          return m;
        }, {})
      : undefined,

    // actions
    actionItems: retro.actionItems,

    // closing
    retroRatingRevealed: retro.retroRatingRevealed,
    myRetroRating: (retro.retroRatings.find((r) => String(r.user) === user.id) || {}).value ?? null,
    retroRatingAvg: retro.retroRatingRevealed ? avg(retro.retroRatings.map((r) => r.value).filter((x) => x != null)) : undefined,
  };
  return v;
}

async function broadcast(room, retro) {
  for (const ws of room.clients) send(ws, { type: 'retro', retro: view(retro, room, ws.user) });
}

async function handle(ws, room, data) {
  const retro = await Retro.findById(ws.retroId);
  if (!retro) return;
  const user = ws.user;
  const fac = isFacilitator(retro, user);

  switch (data.type) {
    case 'setPhase': {
      if (!fac) return;
      const order = ['lobby', 'rating', 'ssc', 'voting', 'actions', 'closing', 'done'];
      if (!order.includes(data.phase)) return;
      retro.phase = data.phase;
      if (retro.status === 'draft') retro.status = 'running';
      if (data.phase === 'done') retro.status = 'done';
      // On entering SSC, build a random speaker order among present, non-absent invited.
      if (data.phase === 'ssc' && (!retro.speakerOrder || retro.speakerOrder.length === 0)) {
        const absent = new Set(retro.absent.map(String));
        const present = presenceList(room).map((u) => u.id).filter((id) => !absent.has(id));
        retro.speakerOrder = present.sort(() => Math.random() - 0.5);
        retro.speakerIndex = 0;
      }
      break;
    }
    case 'toggleAbsent': {
      if (!fac) return;
      const id = String(data.userId);
      const set = new Set(retro.absent.map(String));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      retro.absent = Array.from(set);
      break;
    }
    case 'rate': {
      if (retro.ratingRevealed) return;
      retro.ratings = retro.ratings.filter((r) => String(r.user) !== user.id);
      retro.ratings.push({ user: user._id, value: Number(data.value) });
      break;
    }
    case 'revealRatings': {
      if (!fac) return;
      retro.ratingRevealed = true;
      break;
    }
    case 'addSticky': {
      if (retro.sscRevealed) return;
      if (!['start', 'stop', 'continue'].includes(data.column)) return;
      retro.stickies.push({ id: data.id || String(Date.now()) + Math.random().toString(36).slice(2), author: user._id, column: data.column, text: (data.text || '').slice(0, 500) });
      break;
    }
    case 'editSticky': {
      const s = retro.stickies.find((x) => x.id === data.id);
      if (!s) return;
      if (String(s.author) !== user.id && !fac) return;
      s.text = (data.text || '').slice(0, 500);
      break;
    }
    case 'deleteSticky': {
      const s = retro.stickies.find((x) => x.id === data.id);
      if (!s) return;
      if (String(s.author) !== user.id && !fac) return;
      retro.stickies = retro.stickies.filter((x) => x.id !== data.id);
      break;
    }
    case 'setTimer': {
      if (!fac) return;
      const mins = Math.max(0, Number(data.minutes) || 0);
      retro.timerEndsAt = mins > 0 ? new Date(Date.now() + mins * 60000) : null;
      break;
    }
    case 'revealSsc': {
      if (!fac) return;
      retro.sscRevealed = true;
      retro.timerEndsAt = null;
      break;
    }
    case 'nextSpeaker': {
      // The current speaker or the facilitator can pass the mic.
      const current = retro.speakerOrder[retro.speakerIndex];
      if (!fac && String(current) !== user.id) return;
      if (retro.speakerIndex < retro.speakerOrder.length - 1) retro.speakerIndex += 1;
      break;
    }
    case 'setVotesConfig': {
      if (!fac) return;
      retro.votesConfig = {
        perPerson: Math.max(1, Number(data.perPerson) || 4),
        minPer: Math.max(1, Number(data.minPer) || 1),
        maxPer: Math.max(1, Number(data.maxPer) || 2),
      };
      break;
    }
    case 'vote': {
      if (retro.votesRevealed) return;
      const cfg = retro.votesConfig;
      const stickyId = data.stickyId;
      const points = Math.round(Number(data.points) || 0);
      // Remove any existing vote by this user on this sticky.
      retro.votes = retro.votes.filter((v) => !(String(v.user) === user.id && v.stickyId === stickyId));
      if (points > 0) {
        const clamped = Math.min(cfg.maxPer, Math.max(cfg.minPer, points));
        // Enforce total budget across all the user's votes.
        const used = retro.votes.filter((v) => String(v.user) === user.id).reduce((a, v) => a + v.points, 0);
        if (used + clamped <= cfg.perPerson) {
          retro.votes.push({ user: user._id, stickyId, points: clamped });
        }
      }
      break;
    }
    case 'revealVotes': {
      if (!fac) return;
      retro.votesRevealed = true;
      break;
    }
    case 'selectActions': {
      if (!fac) return;
      // data.stickyIds: proposals promoted to next-sprint goals.
      const chosen = Array.isArray(data.stickyIds) ? data.stickyIds : [];
      const scores = retro.votes.reduce((m, v) => {
        m[v.stickyId] = (m[v.stickyId] || 0) + v.points;
        return m;
      }, {});
      retro.actionItems = chosen.map((sid) => {
        const s = retro.stickies.find((x) => x.id === sid);
        return { stickyId: sid, text: s ? s.text : '', fromUser: s ? s.author : undefined, score: scores[sid] || 0, done: false };
      });
      break;
    }
    case 'rateRetro': {
      if (retro.retroRatingRevealed) return;
      retro.retroRatings = retro.retroRatings.filter((r) => String(r.user) !== user.id);
      retro.retroRatings.push({ user: user._id, value: Number(data.value) });
      break;
    }
    case 'revealRetroRating': {
      if (!fac) return;
      retro.retroRatingRevealed = true;
      break;
    }
    case 'delegate': {
      if (!fac) return;
      if (data.userId) retro.facilitator = data.userId;
      break;
    }
    default:
      return;
  }

  await retro.save();
  await broadcast(room, retro);
}

function initRetro(server) {
  const wss = new WebSocketServer({ server, path: '/wsretro' });

  wss.on('connection', async (ws, req) => {
    try {
      const { query } = url.parse(req.url, true);
      const token = query.token;
      const retroId = query.retro;
      if (!token || !retroId) return ws.close(4001, 'missing token/retro');
      const payload = verifyToken(token);
      const dbUser = await User.findById(payload.sub);
      if (!dbUser || !dbUser.active) return ws.close(4003, 'invalid user');
      const retro = await Retro.findById(retroId);
      if (!retro) return ws.close(4004, 'retro not found');

      const pm = await ProjectMember.findOne({ project: retro.project, user: dbUser._id });
      const effectiveRole = dbUser.role === 'superadmin' ? 'superadmin' : pm ? pm.role : dbUser.role;
      ws.user = { id: dbUser._id.toString(), _id: dbUser._id, displayName: dbUser.displayName, color: dbUser.color, role: effectiveRole };
      ws.retroId = retroId;
      const room = getRoom(retroId);
      room.clients.add(ws);

      send(ws, { type: 'retro', retro: view(retro, room, ws.user) });
      await broadcast(room, retro); // refresh presence for everyone

      ws.on('message', (buf) => {
        let data;
        try { data = JSON.parse(buf.toString()); } catch { return; }
        handle(ws, room, data).catch((e) => send(ws, { type: 'error', message: e.message }));
      });

      ws.on('close', async () => {
        room.clients.delete(ws);
        if (room.clients.size === 0) { rooms.delete(retroId); return; }
        const fresh = await Retro.findById(retroId);
        if (fresh) broadcast(room, fresh);
      });
    } catch (e) {
      try { ws.close(4000, 'error'); } catch { /* noop */ }
    }
  });

  console.log('[ws] Retrospective WebSocket ready on /wsretro');
  return wss;
}

module.exports = { initRetro };
