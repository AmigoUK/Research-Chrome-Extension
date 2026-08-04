import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * E2E for the onboarding surfaces added in v1.2.0: the guide page, the
 * panel's Guide/Dashboard header buttons, and the getting-started checklist
 * that checks itself off from real project data and stays dismissed once
 * closed.
 */

const distPath = fileURLToPath(new URL('../dist', import.meta.url));

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
      '--no-sandbox',
    ],
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  extensionId = (sw as Worker).url().split('/')[2] ?? '';
  expect(extensionId).not.toBe('');
});

test.afterAll(async () => {
  await context.close();
});

const url = (...parts: string[]): string =>
  `chrome-extension://${extensionId}/${path.posix.join(...parts)}`;

test('the guide page renders its five steps and its dashboard button', async () => {
  const page = await context.newPage();
  await page.goto(url('src', 'onboarding', 'index.html'));
  await expect(page.locator('h1')).toHaveText('Five moves and it makes sense');
  await expect(page.locator('.step')).toHaveCount(5);
  await expect(page.locator('#openDashboard')).toBeVisible();
  await page.close();
});

test('the panel header reaches the guide and the dashboard', async () => {
  const page = await context.newPage();
  await page.goto(url('src', 'sidepanel', 'index.html'));
  await expect(page.locator('#guideBtn')).toBeVisible();
  await expect(page.locator('#dashBtn')).toBeVisible();

  // Guide opens as a new tab of the extension's own onboarding page.
  const guidePagePromise = context.waitForEvent('page');
  await page.locator('#guideBtn').click();
  const guidePage = await guidePagePromise;
  await guidePage.waitForLoadState('domcontentloaded');
  expect(guidePage.url()).toContain('src/onboarding/index.html');
  await guidePage.close();
  await page.close();
});

test('an unscriptable tab shows the honest no-access state, not "no page metadata"', async () => {
  // The panel-as-a-tab harness IS the field failure mode: Chrome refuses to
  // inject into this tab (extension page here; a spent activeTab grant in
  // real use), which used to render as "No page metadata / Open an article
  // to capture it" while the user was staring at an open article.
  const page = await context.newPage();
  await page.goto(url('src', 'sidepanel', 'index.html'));
  await expect(page.locator('#capType')).toHaveText('No access to this tab yet');
  const fileBtn = page.locator('#fileBtn');
  await expect(fileBtn).toHaveText('Allow reading pages');
  await expect(fileBtn).toBeEnabled();
  await page.close();
});

test('the checklist starts unchecked, checks off a filed source, and hides once dismissed', async () => {
  const page = await context.newPage();
  await page.goto(url('src', 'sidepanel', 'index.html'));
  await expect(page.locator('#activeName')).toHaveText('My Research');

  // Fresh profile: visible, with the file step still open.
  await expect(page.locator('#gsCard')).toBeVisible();
  const fileStep = page.locator('.gs-step', { hasText: 'File it into your project' });
  await expect(fileStep).not.toHaveClass(/done/);

  // File a source through the real pipeline; the data/changed broadcast
  // refreshes the open panel, no reload involved.
  await page.evaluate(async () => {
    const projects = (await chrome.runtime.sendMessage({ type: 'projects/list' })) as {
      data: Array<{ id: string }>;
    };
    await chrome.runtime.sendMessage({
      type: 'capture/page',
      input: {
        projectId: projects.data[0]!.id,
        url: 'https://example.org/onboarding-paper',
        type: 'article',
        metadata: { title: 'Onboarding paper under test' },
      },
    });
  });
  await expect(page.locator('.gs-step', { hasText: 'File it into your project' })).toHaveClass(
    /done/,
    { timeout: 5000 },
  );

  // Dismiss survives a reload — it is stored, not per-session.
  await page.locator('#gsDismiss').click();
  await expect(page.locator('#gsCard')).toBeHidden();
  await page.reload();
  await expect(page.locator('#activeName')).toHaveText('My Research');
  await expect(page.locator('#gsCard')).toBeHidden();
  await page.close();
});
