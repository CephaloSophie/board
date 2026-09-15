/**
 * PM2 — production sur le VPS AlmaLinux 9 (217.160.186.250) : https://board.kantoaplo.com
 * Base MongoDB : boardKantoAplo. Les autres applications PM2 du serveur ne sont pas concernées
 * (seuls kydos-server et kydos-client sont déclarés ici).
 *
 *   npm run env:vps                  crée server/.env et client/.env avec les valeurs du VPS (secrets générés)
 *   npm run setup && npm run build
 *   npm run start:vps                démarre kydos-server + kydos-client
 *   pm2 save && pm2 startup          redémarrage automatique au boot
 *
 * nginx (/etc/nginx/conf.d/board.kantoaplo.com.conf, depuis deploy/nginx/) termine le HTTPS et relaie :
 *   https://board.kantoaplo.com/api/*  →  kydos-server  127.0.0.1:7002
 *   https://board.kantoaplo.com/*      →  kydos-client  127.0.0.1:7001  (client/dist)
 * Les deux processus n'écoutent que sur 127.0.0.1 : seul nginx est exposé (ports 80 / 443).
 *
 * Les secrets (MONGODB_URI, JWT_SECRET) restent dans server/.env (chmod 600) : ils sont vérifiés
 * au démarrage mais jamais recopiés dans PM2. Guide complet : VPSCONFIGURATION.md.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DOMAIN = process.env.KYDOS_DOMAIN || 'board.kantoaplo.com';
const PUBLIC_URL = `https://${DOMAIN}`;
const LOOPBACK = '127.0.0.1';
const API_PORT = process.env.KYDOS_API_PORT || '7002';
const WEB_PORT = process.env.KYDOS_WEB_PORT || '7001';
const SERVER_ENV_FILE = process.env.KYDOS_SERVER_ENV_FILE || path.join(ROOT, 'server', '.env');
const DB_NAME = process.env.KYDOS_DB_NAME || 'boardKantoAplo';
const LOGS = path.join(ROOT, 'logs');

function loadEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (m) out[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function git(args, fallback) {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
}

// Refuse to start production with missing or development secrets.
function readServerEnv() {
  if (!fs.existsSync(SERVER_ENV_FILE)) {
    throw new Error(`[kydos] ${SERVER_ENV_FILE} introuvable : lancez « npm run env:vps » (voir VPSCONFIGURATION.md §6).`);
  }
  const env = loadEnvFile(SERVER_ENV_FILE);
  const problems = [];
  if (!env.MONGODB_URI) problems.push('MONGODB_URI manquant');
  else if (/root:toor|CHANGER/i.test(env.MONGODB_URI)) problems.push('MONGODB_URI contient des identifiants de développement ou un mot de passe à changer');
  else {
    let dbName = '';
    try {
      dbName = decodeURIComponent(new URL(env.MONGODB_URI).pathname.replace(/^\//, ''));
    } catch {
      problems.push('MONGODB_URI illisible');
    }
    if (dbName !== DB_NAME) problems.push(`MONGODB_URI doit viser la base ${DB_NAME} (trouvé : « ${dbName || 'aucune'} »)`);
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) problems.push('JWT_SECRET absent ou trop court (32 caractères minimum)');
  else if (/change-me|CHANGER|dev-secret/i.test(env.JWT_SECRET)) problems.push('JWT_SECRET est une valeur par défaut');
  if (problems.length) throw new Error(`[kydos] server/.env invalide pour la production : ${problems.join(' ; ')}.`);
  return env;
}

// `pm2 deploy` evaluates this file on the local machine: no secret check there.
const isDeployCommand = process.argv.includes('deploy');
const serverEnv = isDeployCommand ? {} : readServerEnv();

const common = {
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  watch: false,
  min_uptime: '10s',
  max_restarts: 10,
  restart_delay: 2000,
  exp_backoff_restart_delay: 1000,
  kill_timeout: 10000,
  listen_timeout: 10000,
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'kydos-server',
      cwd: path.join(ROOT, 'server'),
      script: 'src/index.js',
      node_args: '--max-old-space-size=768',
      max_memory_restart: '900M',
      out_file: path.join(LOGS, 'server.out.log'),
      error_file: path.join(LOGS, 'server.err.log'),
      // Non-secret variables are fixed here and take precedence over server/.env.
      env: {
        NODE_ENV: 'production',
        PORT: API_PORT,
        HOST: LOOPBACK,
        CLIENT_ORIGIN: PUBLIC_URL,
        JWT_EXPIRES_IN: serverEnv.JWT_EXPIRES_IN || '30d',
        KYDOS_PUBLIC_URL: PUBLIC_URL,
      },
    },
    {
      ...common,
      name: 'kydos-client',
      cwd: path.join(ROOT, 'client'),
      script: 'serve.cjs',
      node_args: '--max-old-space-size=192',
      max_memory_restart: '256M',
      out_file: path.join(LOGS, 'client.out.log'),
      error_file: path.join(LOGS, 'client.err.log'),
      env: {
        NODE_ENV: 'production',
        WEB_PORT,
        WEB_HOST: LOOPBACK,
        API_URL: `http://${LOOPBACK}:${API_PORT}`,
      },
    },
  ],

  // Optional: deploy from your machine with `pm2 deploy ecosystem.vps.config.cjs production setup|update`.
  deploy: {
    production: {
      user: process.env.KYDOS_DEPLOY_USER || 'deploy',
      host: [process.env.KYDOS_DEPLOY_HOST || DOMAIN],
      ref: process.env.KYDOS_DEPLOY_REF || `origin/${git('rev-parse --abbrev-ref HEAD', 'main')}`,
      repo: process.env.KYDOS_DEPLOY_REPO || git('remote get-url origin', 'git@github.com:CephaloSophie/board.git'),
      path: process.env.KYDOS_DEPLOY_PATH || '/opt/board-kantoaplo-pm2',
      ssh_options: 'StrictHostKeyChecking=accept-new',
      'post-setup': 'echo "Créez maintenant les .env : cd source && npm run env:vps"',
      'post-deploy':
        '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; npm run setup && npm run build && npm run migrate && mkdir -p logs && pm2 startOrReload ecosystem.vps.config.cjs --update-env && pm2 save',
      env: { NODE_ENV: 'production' },
    },
  },
};
