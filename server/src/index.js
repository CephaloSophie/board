const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { connectDb } = require('./db');
const { port, clientOrigin } = require('./config');
const { initPoker } = require('./realtime/poker');
const { initRetro } = require('./realtime/retro');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const projectsRoutes = require('./routes/projects.routes');
const taxonomiesRoutes = require('./routes/taxonomies.routes');
const tasksRoutes = require('./routes/tasks.routes');
const eventsRoutes = require('./routes/events.routes');
const teamsRoutes = require('./routes/teams.routes');
const groupsRoutes = require('./routes/groups.routes');
const retrosRoutes = require('./routes/retros.routes');

const app = express();
app.use(cors({ origin: clientOrigin === '*' ? true : clientOrigin.split(','), credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/projects/:projectKey/taxonomies', taxonomiesRoutes);
app.use('/api/projects/:projectKey/tasks', tasksRoutes);
app.use('/api/projects/:projectKey/events', eventsRoutes);
app.use('/api/projects/:projectKey/teams', teamsRoutes);
app.use('/api/projects/:projectKey/groups', groupsRoutes);
app.use('/api/projects/:projectKey/retros', retrosRoutes);

// Serve the built SPA in production, if present.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur.' });
});

const server = http.createServer(app);

// WebSockets are used ONLY for the realtime ceremonies (Planning Poker + Retro).
// Both WSS run with noServer:true and a SINGLE shared upgrade router below —
// attaching multiple `ws` servers to one HTTP server (via the `server` option)
// makes them fight over the 'upgrade' event, which broke /wsretro while /ws
// worked. Routing by pathname ourselves is the canonical fix.
const pokerWss = initPoker();
const retroWss = initRetro();
server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    /* keep default */
  }
  if (pathname === '/ws') {
    pokerWss.handleUpgrade(req, socket, head, (ws) => pokerWss.emit('connection', ws, req));
  } else if (pathname === '/wsretro') {
    retroWss.handleUpgrade(req, socket, head, (ws) => retroWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
console.log('[ws] realtime ready: /ws (poker) + /wsretro (retro)');

async function main() {
  await connectDb();
  server.listen(port, () => console.log(`[server] listening on :${port}`));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
}

module.exports = { app, server };
