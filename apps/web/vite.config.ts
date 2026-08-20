import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API answers under /api in production too, so the proxy forwards the
    // path unchanged: dev and production speak identical URLs.
    proxy: {
      '/api': {
        target: process.env.POLARIS_API ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
