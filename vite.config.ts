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
      //
      // The annotator content script is NOT built here. It used to be a second
      // Rollup input folded into an 'annotator' chunk via manualChunks, but
      // Rollup then treated dist/annotator.js as a shared chunk and had the
      // service worker bundle import from it — evaluating content-script code
      // (document/window listeners) in the SW context, which crashes it on
      // startup. It is now built as a fully standalone IIFE by
      // vite.annotator.config.ts, run as a second build step after this one.
      input: {
        pdfviewer: fileURLToPath(new URL('./src/pdfviewer/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
