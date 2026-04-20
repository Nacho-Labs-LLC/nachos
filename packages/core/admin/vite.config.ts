import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'frontend',
  plugins: [vue()],
  define: {
    // @iarna/toml references Node.js `global` — alias to globalThis for browser
    global: 'globalThis',
  },
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8082',
    },
  },
});
