import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

const API_TARGET = process.env.TESSERA_API_TARGET ?? 'http://127.0.0.1:8080';

// Root is this package dir; resolve tsconfig paths from the repo root.
export default defineConfig({
  root: __dirname,
  plugins: [react(), tsconfigPaths({ root: '../../' })],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/health': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
