/**
 * Production web server for the built SPA (client/dist), without dependencies:
 * static files with cache headers, SPA fallback to index.html, and /api
 * proxied (streamed, any size) to the API server.
 *
 *   npm run build && node serve.cjs        (PM2 : ecosystem.config.cjs à la racine)
 *
 * Env: WEB_PORT (défaut VITE_PORT de client/.env ou 7001), WEB_HOST (0.0.0.0),
 * API_URL (défaut VITE_API_PROXY_TARGET ou http://127.0.0.1:7002).
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

function loadEnvFile(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
      if (m) out[m[1]] = (m[2] || '').trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* optional */
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(__dirname, '.env'));
const PORT = Number(process.env.WEB_PORT || fileEnv.VITE_PORT || 7001);
const HOST = process.env.WEB_HOST || fileEnv.WEB_HOST || '0.0.0.0';
const API = new URL(process.env.API_URL || fileEnv.VITE_API_PROXY_TARGET || 'http://127.0.0.1:7002');
const DIST = path.join(__dirname, 'dist');
const INDEX = path.join(DIST, 'index.html');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function proxy(req, res) {
  const transport = API.protocol === 'https:' ? https : http;
  const upstream = transport.request(
    {
      protocol: API.protocol,
      hostname: API.hostname,
      port: API.port || (API.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: API.host,
        'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
        'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http',
        'x-forwarded-host': req.headers.host || '',
      },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    console.error(`[web] API injoignable (${API.origin}) : ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API injoignable.', code: 'API_UNREACHABLE' }));
  });
  req.pipe(upstream);
}

function sendFile(req, res, file, status = 200) {
  const ext = path.extname(file).toLowerCase();
  const immutable = file.startsWith(path.join(DIST, 'assets') + path.sep);
  res.writeHead(status, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(req, res);
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, dist: fs.existsSync(INDEX) }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  if (!fs.existsSync(INDEX)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Front non construit : lancez « npm run build » puis redémarrez kydos-client.');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const file = path.resolve(DIST, `.${pathname}`);
  if (!file.startsWith(DIST + path.sep) && file !== DIST) {
    res.writeHead(403);
    return res.end();
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isFile()) return sendFile(req, res, file);
    // Missing asset files are real 404s; every other route belongs to the SPA router.
    if (pathname.startsWith('/assets/') || path.extname(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Introuvable.');
    }
    sendFile(req, res, INDEX);
  });
});

server.listen(PORT, HOST, () => console.log(`[web] front sur http://${HOST}:${PORT} (API : ${API.origin})`));

function shutdown(signal) {
  console.log(`[web] ${signal} reçu, arrêt propre…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
