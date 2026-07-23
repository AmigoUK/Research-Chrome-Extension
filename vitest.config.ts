import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('./src/adapters', import.meta.url)),
    },
  },
  test: {
    // Domain-core unit tests run in Node (no chrome.* dependency).
    // IndexedDB-backed adapter tests opt into jsdom per-file via
    // `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
    },
  },
});
