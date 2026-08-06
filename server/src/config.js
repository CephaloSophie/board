const path = require('path');
// Load the server's own .env regardless of the process working directory
// (pm2, a parent folder, docker…) — dotenv otherwise only looks in cwd.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

module.exports = {
  port: process.env.PORT || 7002,
  mongoUri:
    process.env.MONGODB_URI ||
    'mongodb://root:toor@127.0.0.1:27017/bordjdddddddira?authSource=admin',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:7001',
};
