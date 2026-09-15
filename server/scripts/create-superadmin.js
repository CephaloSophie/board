#!/usr/bin/env node
/**
 * Super admins depuis la console (utilise la base de server/.env).
 *
 *   npm run admin:create                                              questions interactives, mot de passe masqué
 *   npm run admin:create -- --username alice --name "Alice Martin" --email alice@kantoaplo.com
 *   npm run admin:create -- --username bob --promote                  compte existant → super admin (réactivé)
 *   npm run admin:create -- --username bob --promote --reset-password nouveau mot de passe
 *   npm run admin:list                                                super admins existants
 *
 * Mot de passe : saisi deux fois sans écho. Sans terminal (script, CI) : variable KYDOS_ADMIN_PASSWORD,
 * sinon un mot de passe aléatoire est généré et affiché une seule fois.
 */
const crypto = require('crypto');
const readline = require('readline');
const { User } = require('../src/models/User');
const { hashPassword } = require('../src/utils/password');

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;
const COLORS = ['#e6c46a', '#7ecb98', '#6b78ea', '#e85d70', '#b39ddb', '#4fb3bf', '#e0a458'];

function passwordProblem(password) {
  if (!password || password.length < MIN_PASSWORD) return `${MIN_PASSWORD} caractères minimum`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'au moins une lettre et un chiffre';
  return null;
}

function generatePassword() {
  return `${crypto.randomBytes(12).toString('base64url')}7k`;
}

/**
 * Creates a superadmin, or with `promote` upgrades an existing account (role, active,
 * optional new password). Throws an Error with a French message on invalid input.
 */
async function createSuperadmin({ username, displayName, email, password, promote = false, resetPassword = false }) {
  const login = String(username || '').trim().toLowerCase();
  if (!USERNAME_RE.test(login)) throw new Error('Identifiant invalide : 3 à 40 caractères (minuscules, chiffres, « . », « _ », « - »).');
  const mail = email ? String(email).trim().toLowerCase() : '';
  if (mail && !EMAIL_RE.test(mail)) throw new Error('E-mail invalide.');

  const existing = await User.findOne({ username: login });
  if (existing) {
    if (!promote) throw new Error(`« ${login} » existe déjà (rôle ${existing.role}). Ajoutez --promote pour le passer super admin.`);
    const changes = [];
    if (existing.role !== 'superadmin') {
      existing.role = 'superadmin';
      changes.push('rôle super admin');
    }
    if (!existing.active) {
      existing.active = true;
      changes.push('compte réactivé');
    }
    if (displayName && displayName.trim() !== existing.displayName) {
      existing.displayName = displayName.trim();
      changes.push('nom modifié');
    }
    if (mail && mail !== existing.email) {
      existing.email = mail;
      changes.push('e-mail modifié');
    }
    if (resetPassword) {
      const problem = passwordProblem(password);
      if (problem) throw new Error(`Mot de passe refusé : ${problem}.`);
      existing.passwordHash = await hashPassword(password);
      changes.push('mot de passe réinitialisé');
    }
    await existing.save();
    return { user: existing, created: false, changes };
  }

  if (!displayName || !String(displayName).trim()) throw new Error('Le nom affiché est requis (--name).');
  const problem = passwordProblem(password);
  if (problem) throw new Error(`Mot de passe refusé : ${problem}.`);
  const user = await User.create({
    username: login,
    displayName: String(displayName).trim(),
    email: mail || undefined,
    passwordHash: await hashPassword(password),
    role: 'superadmin',
    color: COLORS[(await User.countDocuments()) % COLORS.length],
    active: true,
  });
  return { user, created: true, changes: ['compte créé'] };
}

function listSuperadmins() {
  return User.find({ role: 'superadmin' }).sort({ createdAt: 1 }).lean();
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else args[key] = true;
  }
  return args;
}

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    if (hidden) rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(hidden ? answer : answer.trim());
    });
  });
}

async function askPassword() {
  for (;;) {
    const first = await prompt(`Mot de passe (${MIN_PASSWORD} caractères min., lettres et chiffres) : `, { hidden: true });
    const problem = passwordProblem(first);
    if (problem) {
      console.log(`  ✖ ${problem}`);
      continue;
    }
    const second = await prompt('Confirmer le mot de passe : ', { hidden: true });
    if (first !== second) {
      console.log('  ✖ Les deux saisies diffèrent.');
      continue;
    }
    return first;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { connectDb, mongoose } = require('../src/db');
  await connectDb();
  const dbName = mongoose.connection.db.databaseName;
  try {
    if (args.list) {
      const admins = await listSuperadmins();
      console.log(`Super admins de la base « ${dbName} » : ${admins.length}`);
      for (const a of admins) {
        console.log(`  ${a.active ? '●' : '○'} ${a.username.padEnd(20)} ${a.displayName}${a.email ? ` <${a.email}>` : ''}${a.active ? '' : ' (désactivé)'}`);
      }
      return;
    }

    const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    console.log(`Base : ${dbName}`);
    const username = args.username || (tty ? await prompt('Identifiant (ex. alice) : ') : '');
    if (!username) throw new Error('Identifiant requis : --username <identifiant>.');
    const existing = await User.findOne({ username: String(username).trim().toLowerCase() });
    if (existing && !args.promote) {
      throw new Error(`« ${existing.username} » existe déjà (rôle ${existing.role}). Relancez avec --promote (et --reset-password pour changer son mot de passe).`);
    }

    const displayName = args.name || (!existing && tty ? await prompt('Nom affiché (ex. Alice Martin) : ') : undefined);
    const email = typeof args.email === 'string' ? args.email : !existing && tty ? await prompt('E-mail (facultatif) : ') : undefined;
    const resetPassword = Boolean(args['reset-password']);
    let password = typeof args.password === 'string' ? args.password : process.env.KYDOS_ADMIN_PASSWORD;
    let generated = false;
    if (typeof args.password === 'string') console.warn('Attention : --password reste dans l’historique du shell ; préférez la saisie interactive.');
    if ((!existing || resetPassword) && !password) {
      if (tty) password = await askPassword();
      else {
        password = generatePassword();
        generated = true;
      }
    }

    const result = await createSuperadmin({ username, displayName, email, password, promote: Boolean(args.promote), resetPassword });
    const u = result.user;
    console.log(`✔ ${result.created ? 'Super admin créé' : 'Compte mis à jour'} : ${u.username} (${u.displayName}) — ${result.changes.join(', ') || 'aucun changement'}`);
    if (generated) console.log(`  Mot de passe généré (affiché une seule fois) : ${password}`);
    console.log('  Connexion : https://board.kantoaplo.com (changez le mot de passe depuis Utilisateurs si besoin).');
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { createSuperadmin, listSuperadmins, passwordProblem, parseArgs };

if (require.main === module) {
  main().catch((err) => {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  });
}
