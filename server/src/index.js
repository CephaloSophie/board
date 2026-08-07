const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { connectDb } = require('./db');
const { port, clientOrigin } = require('./config');
const { initPoker } = require('./realtime/poker');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const projectsRoutes = require('./routes/projects.routes');
const taxonomiesRoutes = require('./routes/taxonomies.routes');
const tasksRoutes = require('./routes/tasks.routes');
const eventsRoutes = require('./routes/events.routes');
const teamsRoutes = require('./routes/teams.routes');
const groupsRoutes = require('./routes/groups.routes');

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
// WebSockets are used ONLY for the realtime Planning Poker feature.
initPoker(server);

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
