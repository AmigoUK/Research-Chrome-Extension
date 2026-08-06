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
    // `minimum_chrome_version` is 116; Chrome has supported native
    // `<link rel="modulepreload">` since 66, so Vite's legacy-browser
    // polyfill is dead weight here — and it logs a "preloaded but not used"
    // console warning on every extension page, including a reviewer's.
    modulePreload: { polyfill: false },
    rollupOptions: {
      // The PDF reader is opened by extension-page URL (not a manifest surface
      // and NOT web-accessible — the manifest deliberately declares no
      // web_accessible_resources), so declare it as an explicit Rollup HTML
      // input for @crxjs to bundle (script + pdf.js).
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
        // The onboarding guide is opened by URL (first install, the panel's
        // Guide button), not declared in the manifest — same as the reader.
        onboarding: fileURLToPath(new URL('./src/onboarding/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
