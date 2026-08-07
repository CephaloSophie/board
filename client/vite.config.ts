import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Reads client/.env (VITE_PORT, VITE_API_PROXY_TARGET) so the dev server,
// the preview server and pm2 all share the same configuration.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = Number(env.VITE_PORT) || 7001;
  const target = env.VITE_API_PROXY_TARGET || 'http://localhost:7002';
  const proxy = {
    '/api': { target, changeOrigin: true },
    // WebSocket endpoint for the realtime Planning Poker.
    '/ws': { target, ws: true, changeOrigin: true },
  };

  return {
    plugins: [react()],
    server: { port, proxy },
    preview: { port, proxy },
  };
});
