import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Standalone build for the web-page content script. It must be exactly ONE
// self-contained file with no import/export statements — a content script
// cannot import a sibling chunk, and (more importantly) it must never be
// reachable as a shared chunk from the main crxjs build, or Rollup can fold
// it into the service worker bundle and evaluate its document/window
// listeners in the SW context, crashing the SW on startup. See
// vite.config.ts for the incident this guards against.
export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@adapters': fileURLToPath(new URL('./src/adapters', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    // Must NOT wipe dist/ — this build runs after the main `vite build` and
    // has to preserve its output (manifest, service worker, side panel, etc).
    emptyOutDir: false,
    target: 'esnext',
    sourcemap: true,
    lib: {
      entry: fileURLToPath(new URL('./src/content/annotator.ts', import.meta.url)),
      formats: ['iife'],
      name: 'ContextNotesAnnotator',
      fileName: () => 'annotator.js',
    },
    rollupOptions: {
      output: {
        // A single IIFE has no exports, so Rollup would otherwise attach the
        // last statement's value to `window.ContextNotesAnnotator`. Nothing
        // reads that global; leaving it is harmless but this keeps the
        // output free of an `export` artifact some bundlers still emit for
        // named UMD/IIFE builds.
        extend: false,
      },
    },
  },
});
