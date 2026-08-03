import { defineConfig } from 'vite';

// VITE_API_TARGET lets the dev container point the proxy at the `api` service;
// inside a container, localhost is the container itself.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:8791';
const inContainer = !!process.env.VITE_API_TARGET;

export default defineConfig({
  server: {
    port: 5180,
    proxy: { '/api': apiTarget },
    // Bind-mounted source on Windows and macOS does not reliably deliver
    // filesystem events into a container, so hot reload needs polling there.
    watch: inContainer ? { usePolling: true, interval: 300 } : undefined,
  },
  build: { target: 'es2020' },
});
