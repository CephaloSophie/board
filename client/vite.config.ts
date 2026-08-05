import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
     host: '0.0.0.0',
    port: 7001,
    proxy: {
      '/api': {
        target:'http://localhost:7002',
        changeOrigin: true,
      },
    },
  },
});
