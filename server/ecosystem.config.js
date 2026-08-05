module.exports = {
  apps: [{
    name: 'board-server',
    script: './src/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 7002,
      MONGO_URI: 'mongodb://root:toor@127.0.0.1:27017/bordjira1?authSource=admin',
      JWT_SECRET: 'change-me-in-production',
      JWT_EXPIRES_IN: '30d',
      CLIENT_ORIGIN: 'http://217.160.186.250:7001'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
}