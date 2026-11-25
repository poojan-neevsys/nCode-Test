import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Development only: the Vite dev server forwards /api requests to the Express server.
const apiProxyTarget =
  process.env.API_PROXY_TARGET?.trim() || `http://localhost:${process.env.PORT?.trim() || '3000'}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiProxyTarget,
    },
  },
});
