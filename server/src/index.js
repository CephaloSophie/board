const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { connectDb, mongoose } = require('./db');
const { port, clientOrigin } = require('./config');
const { catchAsyncErrors, errorStatus, errorMessage } = require('./utils/asyncErrors');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const projectsRoutes = require('./routes/projects.routes');
const taxonomiesRoutes = require('./routes/taxonomies.routes');
const tasksRoutes = require('./routes/tasks.routes');
const eventsRoutes = require('./routes/events.routes');
const savedFiltersRoutes = require('./routes/savedFilters.routes');
const membersRoutes = require('./routes/members.routes');
const sprintsRoutes = require('./routes/sprints.routes');
const versionsRoutes = require('./routes/versions.routes');
const importRoutes = require('./routes/import.routes');
const exportRoutes = require('./routes/export.routes');
const dashboardsRoutes = require('./routes/dashboards.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const activityRoutes = require('./routes/activity.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const attachmentsRoutes = require('./routes/attachments.routes');

const app = express();
app.use(cors({ origin: clientOrigin === '*' ? true : clientOrigin.split(','), credentials: true }));
// Large limit on the import endpoints only (Jira exports can weigh several MB).
app.use('/api/projects/:projectKey/import', express.json({ limit: '25mb' }));
// Base64 images (8 MB decoded ≈ 11 MB encoded).
app.use('/api/projects/:projectKey/attachments', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

const mount = (path, router) => app.use(path, catchAsyncErrors(router));
mount('/api/auth', authRoutes);
mount('/api/users', usersRoutes);
mount('/api/projects', projectsRoutes);
mount('/api/projects/:projectKey/taxonomies', taxonomiesRoutes);
mount('/api/projects/:projectKey/tasks', tasksRoutes);
mount('/api/projects/:projectKey/events', eventsRoutes);
mount('/api/projects/:projectKey/filters', savedFiltersRoutes);
mount('/api/projects/:projectKey/members', membersRoutes);
mount('/api/projects/:projectKey/sprints', sprintsRoutes);
mount('/api/projects/:projectKey/versions', versionsRoutes);
mount('/api/projects/:projectKey/import', importRoutes);
mount('/api/projects/:projectKey/export', exportRoutes);
mount('/api/projects/:projectKey/dashboards', dashboardsRoutes);
mount('/api/projects/:projectKey/analytics', analyticsRoutes);
mount('/api/projects/:projectKey/activity', activityRoutes.projectRouter);
mount('/api/projects/:projectKey/attachments', attachmentsRoutes.projectRouter);
mount('/api/activity', activityRoutes.globalRouter);
mount('/api/notifications', notificationsRoutes);
mount('/api/files', attachmentsRoutes.fileRouter);

app.use('/api', (req, res) => res.status(404).json({ error: `Route inconnue : ${req.method} ${req.originalUrl}` }));

// Serve the built SPA in production, if present.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = errorStatus(err);
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: errorMessage(err, status),
    ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}),
    ...(err.missing ? { missing: err.missing } : {}),
  });
});

async function main() {
  await connectDb();
  // HOST=127.0.0.1 keeps the API private behind a reverse proxy (default: all interfaces).
  const host = process.env.HOST;
  const onListen = () => console.log(`[server] listening on ${host || ''}:${port}`);
  const server = host ? app.listen(port, host, onListen) : app.listen(port, onListen);
  // PM2 reload / stop: finish in-flight requests, then close MongoDB.
  const shutdown = (signal) => {
    console.log(`[server] ${signal} reçu, arrêt propre…`);
    server.close(() => mongoose.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 7000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
}

module.exports = { app };
