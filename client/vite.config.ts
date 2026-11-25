import { defineConfig } from 'vite';

// In development, /api requests go to the server. Set PORT if the server runs on another port.
const apiPort = process.env.PORT ?? '3000';

// Vite's built-in esbuild transform compiles TSX with the automatic React runtime.
// This avoids @vitejs/plugin-react and its Babel dependencies.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  server: {
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
});
