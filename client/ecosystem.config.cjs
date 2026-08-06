// PM2 config for the client. Reads client/.env and runs the Vite server on
// VITE_PORT, proxying /api to VITE_API_PROXY_TARGET (the API server).
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
      if (!m) continue;
      out[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* no .env yet — fall back to defaults below */
  }
  return out;
}

const env = loadEnvFile(path.join(__dirname, '.env'));
const port = env.VITE_PORT || '7001';

module.exports = {
  apps: [
    {
      name: 'kydos-client',
      cwd: __dirname,
      // Vite dev server (hot reload); it auto-loads client/.env. No build step
      // needed. To serve a production build instead: run `npm run build` then
      // change script args to: `preview --host --port ${port}`.
      script: 'node_modules/vite/bin/vite.js',
      args: `--host --port ${port}`,
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        VITE_PORT: port,
        VITE_API_PROXY_TARGET: env.VITE_API_PROXY_TARGET || 'http://localhost:7002',
      },
    },
  ],
};
