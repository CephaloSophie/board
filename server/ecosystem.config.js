// PM2 config for the API server. Reads server/.env so a single source of
// truth drives both `node src/index.js` (via dotenv in config.js) and pm2.
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

module.exports = {
  apps: [
    {
      name: 'kydos-server',
      cwd: __dirname,
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: env.PORT || '7002',
        MONGODB_URI: env.MONGODB_URI || 'mongodb://root:toor@127.0.0.1:27017/bordjdddddddira?authSource=admin',
        JWT_SECRET: env.JWT_SECRET || 'dev-secret-change-me',
        JWT_EXPIRES_IN: env.JWT_EXPIRES_IN || '30d',
        CLIENT_ORIGIN: env.CLIENT_ORIGIN || 'http://localhost:7001',
      },
    },
  ],
};
