// Checks that the API and the front answer.
//   npm run health        ports from ecosystem.config.cjs / .env files
//   npm run health:vps    ecosystem.vps.config.cjs + public HTTPS checks (board.kantoaplo.com)
const VPS = process.argv.includes('--vps');
const config = require(VPS ? '../ecosystem.vps.config.cjs' : '../ecosystem.config.cjs');

const server = config.apps.find((a) => a.name === 'kydos-server');
const client = config.apps.find((a) => a.name === 'kydos-client');
const apiPort = server.env.PORT;
const webPort = client.env.WEB_PORT || client.env.VITE_PORT;
const checks = [
  ['API', `http://127.0.0.1:${apiPort}/api/health`],
  ['Front', `http://127.0.0.1:${webPort}${client.script === 'serve.cjs' ? '/healthz' : '/'}`],
  ['Front → API', `http://127.0.0.1:${webPort}/api/health`],
];
if (VPS) {
  const origin = server.env.CLIENT_ORIGIN;
  checks.push(['HTTPS front', `${origin}/healthz`], ['HTTPS API', `${origin}/api/health`], ['HTTP → HTTPS', origin.replace(/^https:/, 'http:') + '/', 301]);
}

(async () => {
  let ok = true;
  for (const [name, url, expected] of checks) {
    try {
      const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const good = expected ? res.status === expected : res.ok;
      console.log(`${good ? '✔' : '✖'} ${name.padEnd(13)} ${res.status}  ${url}`);
      ok = ok && good;
    } catch (err) {
      console.log(`✖ ${name.padEnd(13)} ${err.cause?.code || err.name}  ${url}`);
      ok = false;
    }
  }
  process.exit(ok ? 0 : 1);
})();
