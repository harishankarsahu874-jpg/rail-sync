import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + WebSocket to the FastAPI backend on :8000.
// Production: FastAPI serves the built dist/ directly (single port).
export default defineConfig({
  plugins: [react()],
  // Provider configuration lives in the repository-level .env shared with FastAPI.
  envDir: '..',
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // Map rendering and analytics are large but independent; separate
        // chunks improve cache reuse and first-page parsing in the preview.
        manualChunks: {
          'map-vendor': ['maplibre-gl'],
          'chart-vendor': ['recharts'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
