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
    rollupOptions: {
      // The PDF reader is web-accessible (not a manifest surface), so declare it
      // as an explicit Rollup HTML input for @crxjs to bundle (script + pdf.js).
      input: {
        pdfviewer: fileURLToPath(new URL('./src/pdfviewer/index.html', import.meta.url)),
        annotator: fileURLToPath(new URL('./src/content/annotator.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'annotator' ? 'annotator.js' : 'assets/[name]-[hash].js',
        // The annotator must be one file — a content script cannot import a
        // sibling chunk. Keep its dependencies inlined into it.
        manualChunks: (id) =>
          id.includes('/src/content/') || id.includes('dom-anchor') ? 'annotator' : undefined,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
