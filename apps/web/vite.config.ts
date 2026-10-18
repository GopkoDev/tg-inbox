import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../..',
  // `ws` also proxies the inbox live socket (a WebSocket upgrade on /api/…/inbox/live).
  server: { proxy: { '/api': { target: 'http://localhost:3000', ws: true } } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
