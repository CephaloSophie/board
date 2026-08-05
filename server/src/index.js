const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { connectDb } = require('./db');
const { port, clientOrigin } = require('./config');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const projectsRoutes = require('./routes/projects.routes');
const taxonomiesRoutes = require('./routes/taxonomies.routes');
const tasksRoutes = require('./routes/tasks.routes');

const app = express();
app.use(cors({ origin: clientOrigin === '*' ? true : clientOrigin.split(','), credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/projects/:projectKey/taxonomies', taxonomiesRoutes);
app.use('/api/projects/:projectKey/tasks', tasksRoutes);

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

async function main() {
  await connectDb();
  app.listen(port, () => console.log(`[server] listening on :${port}`));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
}

module.exports = { app };
