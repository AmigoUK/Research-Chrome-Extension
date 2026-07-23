import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath, URL } from 'node:url';
import manifest from './src/manifest.config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('./src/adapters', import.meta.url)),
    },
  },
  plugins: [crx({ manifest })],
  build: {
    target: 'esnext',
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
