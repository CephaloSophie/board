module.exports = {
  apps: [{
    name: 'board-client',
    script: './node_modules/.bin/vite',
    args: '--host 0.0.0.0 --port 7001',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development',
      BROWSER: 'none'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
}