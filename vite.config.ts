import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `public/` is served at the site root, so the pipeline's output is reachable at
  // /data/lgd-2024/*. The only runtime fetch beyond static assets is the optional dataset API:
  // `/api` is proxied to the backend (db/server.mts) so the frontend stays same-origin and never
  // sees DATABASE_URL. The proxy is dev-only and harmless when the DB source is not in use.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.API_PORT ? Number(process.env.API_PORT) : 8787}`,
        changeOrigin: true,
      },
    },
  },
  // MapLibre constructs its tiling worker with { type: 'module' }, so the worker bundle
  // must be ES format. See src/features/map/maplibreWorker.ts.
  worker: { format: 'es' },
  build: { outDir: 'dist', sourcemap: true },
});
