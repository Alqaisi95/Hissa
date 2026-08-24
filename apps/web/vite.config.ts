import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxy = {
  '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  // The same proxy in dev and preview, so `vite preview` exercises the real API.
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 5173, proxy: apiProxy },
  build: { outDir: 'dist', sourcemap: true },
});
