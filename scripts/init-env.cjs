// Creates server/.env and client/.env (never overwrites existing files).
//   npm run env:init   local / generic values from server|client/.env.example
//   npm run env:vps    VPS values for https://board.kantoaplo.com (deploy/vps/*.env.example),
//                      random JWT secret and MongoDB password, then prints the mongosh command.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VPS = process.argv.includes('--vps');
const created = [];
let mongoPassword = null;

function init(dir, example, transform) {
  const target = path.join(ROOT, dir, '.env');
  if (fs.existsSync(target)) return console.log(`= ${dir}/.env existe déjà (inchangé)`);
  let content = fs.readFileSync(path.join(ROOT, example), 'utf8');
  if (transform) content = transform(content);
  fs.writeFileSync(target, content, { mode: 0o600 });
  created.push(`${dir}/.env`);
  console.log(`+ ${dir}/.env créé`);
}

const jwt = () => crypto.randomBytes(48).toString('hex');

init('server', VPS ? 'deploy/vps/server.env.example' : 'server/.env.example', (s) => {
  let out = s.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwt()}`);
  if (VPS) {
    mongoPassword = crypto.randomBytes(24).toString('base64url');
    out = out.replace('CHANGER_MOT_DE_PASSE_MONGO', mongoPassword);
  }
  return out;
});
init('client', VPS ? 'deploy/vps/client.env.example' : 'client/.env.example');

if (VPS && mongoPassword) {
  console.log('\nCréez l’utilisateur MongoDB de l’application (mot de passe déjà écrit dans server/.env) :');
  console.log(
    `  mongosh "mongodb://127.0.0.1:27017/admin" -u admin -p --eval 'db.getSiblingDB("admin").createUser({ user: "kydos", pwd: "${mongoPassword}", roles: [{ role: "readWrite", db: "kydos_board" }] })'`
  );
} else if (created.length) {
  console.log('\nÀ vérifier maintenant :');
  console.log('  server/.env  MONGODB_URI (hôte, identifiants, nom de base), CLIENT_ORIGIN (URL publique), HOST=127.0.0.1 derrière nginx');
  console.log('  client/.env  VITE_PORT (front) et VITE_API_PROXY_TARGET (URL de l’API)');
}
