/**
 * PM2 — Kýdos Board : l'API (server/) et le front (client/) en une commande.
 *
 *   pm2 start ecosystem.config.cjs                         production : API + front (client/dist servi par client/serve.cjs)
 *   KYDOS_ENV=development pm2 start ecosystem.config.cjs   développement : API redémarrée à chaque modification + Vite (hot reload)
 *
 * Réglages lus dans server/.env et client/.env (voir docs/INSTALLATION.md).
 * Surcharges ponctuelles : KYDOS_API_PORT, KYDOS_WEB_PORT, KYDOS_WEB_HOST, KYDOS_API_URL, KYDOS_MONGODB_URI.
 * Les secrets (MONGODB_URI, JWT_SECRET) restent dans server/.env : ils ne sont pas copiés dans PM2.
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
      if (m) out[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* no .env yet: defaults below */
  }
  return out;
}

const ROOT = __dirname;
const DEV = process.env.KYDOS_ENV === 'development';
const serverEnv = loadEnvFile(path.join(ROOT, 'server', '.env'));
const clientEnv = loadEnvFile(path.join(ROOT, 'client', '.env'));

const apiPort = process.env.KYDOS_API_PORT || serverEnv.PORT || '7002';
const webPort = process.env.KYDOS_WEB_PORT || clientEnv.VITE_PORT || '7001';
const localApi = `http://127.0.0.1:${apiPort}`;
const apiUrl = process.env.KYDOS_API_URL || (process.env.KYDOS_API_PORT ? localApi : clientEnv.VITE_API_PROXY_TARGET) || localApi;
const logFile = (name) => path.join(ROOT, 'logs', name);

const common = {
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  min_uptime: '10s',
  max_restarts: 15,
  exp_backoff_restart_delay: 500,
  kill_timeout: 8000,
  time: true,
  merge_logs: true,
};

const server = {
  ...common,
  name: 'kydos-server',
  cwd: path.join(ROOT, 'server'),
  script: 'src/index.js',
  max_memory_restart: '512M',
  out_file: logFile('server.out.log'),
  error_file: logFile('server.err.log'),
  env: {
    NODE_ENV: DEV ? 'development' : 'production',
    PORT: apiPort,
    ...(process.env.KYDOS_MONGODB_URI ? { MONGODB_URI: process.env.KYDOS_MONGODB_URI } : {}),
  },
  // PM2 watches the sources in development (restarts on new files too, unlike node --watch).
  ...(DEV ? { watch: ['src'], watch_delay: 800, ignore_watch: ['node_modules', 'test'] } : { watch: false }),
};

const client = DEV
  ? {
      ...common,
      name: 'kydos-client',
      cwd: path.join(ROOT, 'client'),
      script: 'node_modules/vite/bin/vite.js',
      args: `--host --port ${webPort} --strictPort`,
      out_file: logFile('client.out.log'),
      error_file: logFile('client.err.log'),
      env: { NODE_ENV: 'development', VITE_PORT: webPort, VITE_API_PROXY_TARGET: apiUrl },
    }
  : {
      ...common,
      name: 'kydos-client',
      cwd: path.join(ROOT, 'client'),
      script: 'serve.cjs',
      max_memory_restart: '256M',
      out_file: logFile('client.out.log'),
      error_file: logFile('client.err.log'),
      env: {
        NODE_ENV: 'production',
        WEB_PORT: webPort,
        WEB_HOST: process.env.KYDOS_WEB_HOST || clientEnv.WEB_HOST || '0.0.0.0',
        API_URL: apiUrl,
      },
    };

module.exports = { apps: [server, client] };
