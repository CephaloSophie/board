// Integration test harness: boots the real Express app against a throwaway
// MongoDB database, seeds two users and exposes a tiny fetch-based client.
// The database name MUST contain "test" — the harness drops it on start/stop.
process.env.MONGODB_URI =
  process.env.MONGODB_URI_TEST ||
  'mongodb://root:toor@127.0.0.1:27017/kydos_board_test?authSource=admin';
process.env.JWT_SECRET = 'test-secret';
process.env.KYDOS_QUIET = '1';

const { app } = require('../src/index');
const { connectDb, mongoose } = require('../src/db');
const { User } = require('../src/models/User');
const { hashPassword } = require('../src/utils/password');

const PASSWORD = 'secret-pass';

function assertTestDatabase() {
  const name = mongoose.connection.db?.databaseName || '';
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to run tests against non-test database "${name}".`);
  }
}

async function startTestServer() {
  await connectDb();
  assertTestDatabase();
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const passwordHash = await hashPassword(PASSWORD);
  const admin = await User.create({ username: 'admin', displayName: 'Admin Test', passwordHash, role: 'superadmin', email: 'admin@test.local' });
  const dev = await User.create({ username: 'dev', displayName: 'Dev Test', passwordHash, role: 'developer', email: 'dev@test.local' });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function request(method, path, token, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  function client(token) {
    return {
      get: (p) => request('GET', p, token),
      post: (p, b) => request('POST', p, token, b ?? {}),
      patch: (p, b) => request('PATCH', p, token, b ?? {}),
      put: (p, b) => request('PUT', p, token, b ?? {}),
      del: (p) => request('DELETE', p, token),
    };
  }

  async function login(username) {
    const r = await request('POST', '/auth/login', null, { username, password: PASSWORD });
    if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status}`);
    return r.body.token;
  }

  async function stop() {
    await new Promise((resolve) => server.close(resolve));
    assertTestDatabase();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  return { base, request, client, login, stop, users: { admin, dev } };
}

module.exports = { startTestServer, PASSWORD };
