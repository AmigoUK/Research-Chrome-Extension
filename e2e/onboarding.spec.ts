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

test('the guide page renders its six steps and its dashboard button', async () => {
  const page = await context.newPage();
  await page.goto(url('src', 'onboarding', 'index.html'));
  await expect(page.locator('h1')).toHaveText('Six moves and it makes sense');
  await expect(page.locator('.step')).toHaveCount(6);
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

test("a pending update shows the what's-new banner until dismissed, and dismissal sticks", async () => {
  // The store updates extensions silently; the SW records the update in
  // storage on onInstalled. Seed that flag the same way and drive the banner.
  const page = await context.newPage();
  await page.goto(url('src', 'sidepanel', 'index.html'));
  await page.evaluate(() => chrome.storage.local.set({ whatsNewVersion: '9.9.9' }));
  await page.reload();
  const banner = page.locator('#whatsNew');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Updated to v9.9.9');
  await expect(page.locator('#whatsNew a')).toHaveAttribute('href', /releases/);

  await page.locator('#whatsNewDismiss').click();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.locator('#activeName')).toHaveText('My Research');
  await expect(page.locator('#whatsNew')).toBeHidden();
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

// Last in the file deliberately: these are the tests here that open the
// dashboard, and the dashboard seeds its own default project the moment it
// finds none — running them before the tests above would leave those racing
// a "My Research Project" seed instead of the side panel's own "My Research".
test('the guide’s Outline step opens the dashboard already on that route', async () => {
  const page = await context.newPage();
  await page.goto(url('src', 'onboarding', 'index.html'));

  const dashboardPagePromise = context.waitForEvent('page');
  await page.locator('#openOutline').click();
  const dashboardPage = await dashboardPagePromise;
  await dashboardPage.waitForLoadState('domcontentloaded');
  expect(dashboardPage.url()).toContain('src/options/index.html#outline');
  // The dashboard reads its topbar title from `state.route` — 'Outline' here
  // is proof the URL fragment actually landed, not just that the dashboard
  // opened at its default Overview.
  await expect(dashboardPage.locator('#viewTitle')).toHaveText('Outline');
  await dashboardPage.close();
  await page.close();
});

// The regression this covers: openOptionsPage() only focuses an
// already-open dashboard tab rather than reloading it, so a handoff that
// relied on that reload (the old storage-parked "pending route") would
// silently do nothing here. chrome.tabs.create() always opens a fresh tab
// regardless of what is already open, so this must pass exactly like the
// no-tab-open case above.
test('the Outline step still lands on Outline with a dashboard tab already open', async () => {
  const existingDashboard = await context.newPage();
  await existingDashboard.goto(url('src', 'options', 'index.html'));
  await expect(existingDashboard.locator('#viewTitle')).toHaveText('Overview');

  const page = await context.newPage();
  await page.goto(url('src', 'onboarding', 'index.html'));
  const newDashboardPagePromise = context.waitForEvent('page');
  await page.locator('#openOutline').click();
  const newDashboardPage = await newDashboardPagePromise;
  await newDashboardPage.waitForLoadState('domcontentloaded');
  expect(newDashboardPage.url()).toContain('src/options/index.html#outline');
  await expect(newDashboardPage.locator('#viewTitle')).toHaveText('Outline');

  // The pre-existing tab was merely left alone, not hijacked into Outline —
  // this handoff never touches a tab it didn't itself open.
  await expect(existingDashboard.locator('#viewTitle')).toHaveText('Overview');

  await newDashboardPage.close();
  await existingDashboard.close();
  await page.close();
});
