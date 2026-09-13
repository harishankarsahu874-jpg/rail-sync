import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// envDir '..' => Vite reads the repo-root .env.production (committed keys),
// so `npm run build` needs ZERO environment variables, locally or in Docker.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: { '/api': 'http://localhost:8000' },
  },
  build: {
    outDir: 'dist',
    manualChunks: {
      'map-vendor': ['maplibre-gl'],
      'chart-vendor': ['recharts'],
      'react-vendor': ['react', 'react-dom', 'react-router-dom'],
    },
  },
});
