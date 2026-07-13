import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5180,
    proxy: { '/api': 'http://localhost:8791' },
  },
  build: { target: 'es2020' },
});
