import { defineConfig } from '@playwright/test';

/**
 * E2E config. The extension must be built first (`npm run build`), then loaded
 * into a headed Chromium (extensions require headed mode — run under xvfb in
 * headless environments; `npm run test:e2e` wraps this with `xvfb-run`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
});
