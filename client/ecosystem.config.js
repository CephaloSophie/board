module.exports = {
  apps: [{
    name: 'board-client',
    script: 'npx',
    args: 'serve -s build -l 7001',
    cwd: __dirname,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 7001,
      BROWSER: 'none'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
}