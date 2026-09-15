const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { startTestServer } = require('./helpers');
const { createSuperadmin, listSuperadmins, passwordProblem, parseArgs } = require('../scripts/create-superadmin');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'create-superadmin.js');
let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.stop();
});

const run = (args, env = {}) =>
  execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, KYDOS_QUIET: '1', ...env }, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

test('arguments and password rules', () => {
  assert.deepEqual(parseArgs(['--username', 'alice', '--promote', '--name', 'Alice M']), { username: 'alice', promote: true, name: 'Alice M' });
  assert.ok(passwordProblem('court1'));
  assert.ok(passwordProblem('sanschiffres'));
  assert.equal(passwordProblem('Kantoaplo2026'), null);
});

test('creates a superadmin who can log in, refuses duplicates and weak input', async () => {
  const r = await createSuperadmin({ username: ' Alice ', displayName: 'Alice Martin', email: 'Alice@Kantoaplo.com', password: 'Kantoaplo2026' });
  assert.equal(r.created, true);
  assert.equal(r.user.username, 'alice');
  assert.equal(r.user.role, 'superadmin');
  assert.equal(r.user.email, 'alice@kantoaplo.com');
  const login = await ctx.request('POST', '/auth/login', null, { username: 'alice', password: 'Kantoaplo2026' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'superadmin');

  await assert.rejects(createSuperadmin({ username: 'alice', displayName: 'x', password: 'Kantoaplo2026' }), /existe déjà/);
  await assert.rejects(createSuperadmin({ username: 'a!', displayName: 'x', password: 'Kantoaplo2026' }), /Identifiant invalide/);
  await assert.rejects(createSuperadmin({ username: 'bruno', displayName: 'Bruno', password: 'faible' }), /Mot de passe refusé/);
  await assert.rejects(createSuperadmin({ username: 'bruno', displayName: 'Bruno', email: 'pas-un-mail', password: 'Kantoaplo2026' }), /E-mail invalide/);
});

test('promotes and reactivates an existing account, optionally resetting its password', async () => {
  await ctx.users.dev.updateOne({ active: false });
  const r = await createSuperadmin({ username: 'dev', promote: true, resetPassword: true, password: 'NouveauPass42' });
  assert.equal(r.created, false);
  assert.deepEqual(r.changes, ['rôle super admin', 'compte réactivé', 'mot de passe réinitialisé']);
  const login = await ctx.request('POST', '/auth/login', null, { username: 'dev', password: 'NouveauPass42' });
  assert.equal(login.body.user.role, 'superadmin');
  assert.deepEqual((await listSuperadmins()).map((u) => u.username).sort(), ['admin', 'alice', 'dev']);
});

test('console command works without a terminal (generated password, list, clear errors)', () => {
  const out = run(['--username', 'chloe', '--name', 'Chloé Dupont', '--email', 'chloe@kantoaplo.com']);
  assert.match(out, /Super admin créé : chloe/);
  assert.match(out, /Mot de passe généré \(affiché une seule fois\) : \S{18,}/);

  const withEnv = run(['--username', 'david', '--name', 'David'], { KYDOS_ADMIN_PASSWORD: 'DavidPass2026' });
  assert.doesNotMatch(withEnv, /Mot de passe généré/);

  assert.match(run(['--list']), /Super admins de la base « kydos_board_test » : 5/);
  assert.throws(() => run(['--username', 'chloe', '--name', 'Autre']), (err) => /existe déjà/.test(err.stderr) && err.status === 1);
});
