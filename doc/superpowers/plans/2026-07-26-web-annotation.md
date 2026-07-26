# Web-page Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user select text on any web page and save a highlight or note anchored to that exact passage, see those highlights repaint on return, and manage the notes from the side panel — with no standing access to every site.

**Architecture:** An injected ISOLATED-world content script (shadow-DOM UI only: a selection toolbar + absolutely-positioned highlight overlays) talks to the service worker through two new append-only messages. Annotating auto-files the page (find-or-create `Document` by URL, then reuse `capturePage`) into a canonical active project held in `chrome.storage.local`. Activation is hybrid: `activeTab` on demand, then per-origin `registerContentScripts` after the first annotation. Notes are edited in a new side-panel "On this page" view. Reuses `src/core/anchoring/web.ts`, the `Annotation` model (`kind: 'web'`), and `capturePage` unchanged. No IndexedDB schema change.

**Tech Stack:** TypeScript 5.9 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vite 6 + `@crxjs/vite-plugin` 2.7, MV3 `chrome.scripting`/`chrome.permissions`/`chrome.storage`, `idb` (schema v5, unchanged), Vitest + `fake-indexeddb` + jsdom, Playwright.

## Global Constraints

- **No CDN / no remote code** — every asset ships in the extension (MV3 requirement). Copied verbatim from `CLAUDE.md`.
- **`src/core` stays pure** — no `chrome.*`, no IndexedDB types, no DOM (except `src/core/anchoring/web.ts`, DOM by nature, tested under jsdom). Storage via ports only.
- **Migrations are append-only; this feature adds none** — reuse `Annotation` (`kind: 'web'`), do not bump `DB_VERSION`, do not touch `migrations[1]`–`migrations[5]`.
- **Record domain changes in the router**, not in a surface.
- **Escape at the sink** — anything interpolated into `innerHTML` goes through `esc()`; ids in a `querySelector` through `CSS.escape()`. Build DOM programmatically where practical.
- **Message types are `domain/verb`**; files `kebab-case.ts`; types `PascalCase`; functions/vars `camelCase`.
- **A `position: fixed`/injected popover repositions on scroll, it does not close.**
- **CI must stay green:** `npm run typecheck && npm run lint && npm test && npm run build`, plus the E2E job.

---

### Task 1: Content-script build foundation

Emit the annotator as a **single self-contained file at a stable path** (`dist/annotator.js`) so `chrome.scripting.executeScript({ files })` and `registerContentScripts({ js })` can reference it. This is the plan's main build risk — de-risk it first with a stub before any logic depends on it.

**Files:**
- Create: `src/content/annotator.ts` (stub)
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: a built artifact at `dist/annotator.js`, self-contained (no `import` of sibling chunks), referenced at runtime by the literal path `'annotator.js'`.

- [ ] **Step 1: Create the stub content script**

`src/content/annotator.ts`:
```ts
/**
 * Injected web-page annotator (ISOLATED world). Bundled as a standalone,
 * self-contained file at dist/annotator.js so the service worker can inject it
 * with chrome.scripting and register it per-origin. Logic arrives in later tasks.
 */
console.debug('[context-notes] annotator loaded');
```

- [ ] **Step 2: Add a stable-name Rollup entry**

Modify `vite.config.ts` `build.rollupOptions` to add the entry and pin its filename, and keep the annotator self-contained (no shared chunk):
```ts
    rollupOptions: {
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
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds; `dist/annotator.js` exists.

- [ ] **Step 4: Verify the artifact is present and self-contained**

Run: `test -f dist/annotator.js && grep -c "context-notes] annotator loaded" dist/annotator.js && ! grep -Eq "^import|from ['\"]\\./assets/" dist/annotator.js && echo SELF_CONTAINED`
Expected: prints a count `≥ 1` then `SELF_CONTAINED`.
**If it is not self-contained** (the grep finds a sibling import): widen the `manualChunks` predicate to fold the offending module id into the `'annotator'` chunk, rebuild, re-verify. **If `manualChunks` cannot force a single file** (crxjs override), fall back to a dedicated second Vite build config that builds only `src/content/annotator.ts` with `build.lib`/`inlineDynamicImports: true` into `dist/annotator.js`, wired as a `build` npm sub-step; document the choice in a comment in `vite.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/content/annotator.ts vite.config.ts
git commit -m "build: emit the web annotator as a stable self-contained bundle"
```

---

### Task 2: Core use-case — find-or-create by URL, and annotate

The domain logic behind `web/annotate` and `web/annotationsForUrl`, pure and unit-tested. Reuses `capturePage`; dedups by **URL** (not DOI) so a DOI-less page annotated twice reuses one document.

**Files:**
- Create: `src/core/usecases/web-annotation.ts`
- Test: `test/core/web-annotation.test.ts`

**Interfaces:**
- Consumes: `capturePage` (`src/core/usecases/capture.ts`), `CaptureInput`/`CaptureDeps`, `RepositorySet`, `Annotation`, `WebAnchor`, `Id`.
- Produces:
  - `findDocumentByUrl(repos: RepositorySet, projectId: Id, url: string): Promise<Document | undefined>`
  - `annotateWebPage(repos, input: CaptureInput, anchor: WebAnchor, deps: CaptureDeps): Promise<{ document: Document; annotation: Annotation; createdDocument: boolean }>`

- [ ] **Step 1: Write the failing test**

`test/core/web-annotation.test.ts`:
```ts
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openContextNotesDB } from '../../src/adapters/idb/db';
import { createRepositories } from '../../src/adapters/idb/repositories';
import { annotateWebPage, findDocumentByUrl } from '../../src/core/usecases/web-annotation';
import type { RepositorySet } from '../../src/core/ports/repositories';
import type { CaptureInput } from '../../src/core/usecases/capture';
import type { WebAnchor } from '../../src/core/model/types';

let repos: RepositorySet;
let counter = 0;
let tick = 0;
const deps = { newId: () => `id-${++tick}`, now: () => new Date(Date.UTC(2026, 6, 26, 0, 0, ++tick)).toISOString() };

const input = (url: string): CaptureInput => ({
  projectId: 'p1',
  url,
  type: 'webpage',
  metadata: { title: 'A page' },
});
const anchor: WebAnchor = { kind: 'web', selectors: [{ type: 'textQuote', exact: 'passage' }] };

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  repos = createRepositories(await openContextNotesDB(`web-anno-${counter++}`));
  tick = 0;
});

describe('annotateWebPage', () => {
  it('creates the document on first annotation, then reuses it by URL', async () => {
    const first = await annotateWebPage(repos, input('https://ex.org/a'), anchor, deps);
    expect(first.createdDocument).toBe(true);

    const second = await annotateWebPage(repos, input('https://ex.org/a'), anchor, deps);
    expect(second.createdDocument).toBe(false);
    expect(second.document.id).toBe(first.document.id);

    const docs = await repos.documents.listByProject('p1');
    expect(docs).toHaveLength(1);
    const notes = await repos.annotations.listByDocument(first.document.id);
    expect(notes).toHaveLength(2);
    expect(notes[0]?.anchor.kind).toBe('web');
  });

  it('findDocumentByUrl returns undefined when nothing is filed', async () => {
    expect(await findDocumentByUrl(repos, 'p1', 'https://ex.org/none')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- web-annotation`
Expected: FAIL — cannot find module `../../src/core/usecases/web-annotation`.

- [ ] **Step 3: Write the implementation**

`src/core/usecases/web-annotation.ts`:
```ts
/**
 * Web-annotation use-cases. Filing is keyed on URL, not DOI: `capturePage`
 * dedups by DOI only, so a DOI-less page annotated twice would otherwise spawn
 * a second document and split its notes. We look up by URL first and only fall
 * through to `capturePage` when nothing matches.
 *
 * Pure — id and clock are injected, storage is reached through the ports.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Annotation, Document, Id, WebAnchor } from '../model/types';
import { capturePage, type CaptureDeps, type CaptureInput } from './capture';

export async function findDocumentByUrl(
  repos: RepositorySet,
  projectId: Id,
  url: string,
): Promise<Document | undefined> {
  const docs = await repos.documents.listByProject(projectId);
  return docs.find((d) => d.url === url);
}

export async function annotateWebPage(
  repos: RepositorySet,
  input: CaptureInput,
  anchor: WebAnchor,
  deps: CaptureDeps,
): Promise<{ document: Document; annotation: Annotation; createdDocument: boolean }> {
  const existing = await findDocumentByUrl(repos, input.projectId, input.url);
  let document = existing;
  let createdDocument = false;
  if (!document) {
    const captured = await capturePage(repos, input, deps);
    document = captured.document;
    createdDocument = !captured.deduped;
  }

  const now = deps.now();
  const annotation: Annotation = {
    id: deps.newId(),
    projectId: document.projectId,
    documentId: document.id,
    anchor,
    content: '',
    tags: [],
    status: 'draft',
    author: 'me',
    createdAt: now,
    updatedAt: now,
  };
  await repos.annotations.put(annotation);
  return { document, annotation, createdDocument };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- web-annotation`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/usecases/web-annotation.ts test/core/web-annotation.test.ts
git commit -m "feat(core): annotateWebPage — find-or-create a web document by URL, then anchor a note"
```

---

### Task 3: Messages and router wiring for web annotation

Add the two append-only messages and their router cases; the router records domain changes.

**Files:**
- Modify: `src/core/messages.ts` (append two entries near the `annotations/*` group)
- Modify: `src/core/router.ts` (add two cases; import the use-case + `findDocumentByUrl`)
- Test: `test/core/router.test.ts` (extend)

**Interfaces:**
- Consumes: `annotateWebPage`, `findDocumentByUrl` (Task 2); `recordDocumentPut`, `recordAnnotationPut` (existing).
- Produces:
  - `web/annotate { input: CaptureInput; anchor: WebAnchor; withNote: boolean }` → `{ documentId: Id; annotationId: Id }`
  - `web/annotationsForUrl { projectId: Id; url: string }` → `{ documentId: Id | null; annotations: Annotation[] }`

- [ ] **Step 1: Write the failing test**

Append to the `describe('handleRequest', …)` block in `test/core/router.test.ts`:
```ts
  it('annotates a web page and reads the notes back by URL', async () => {
    const anchor = { kind: 'web' as const, selectors: [{ type: 'textQuote' as const, exact: 'x' }] };
    const input = { projectId: 'p1', url: 'https://ex.org/a', type: 'webpage' as const, metadata: { title: 'A' } };

    const res = await handleRequest(repos, { type: 'web/annotate', input, anchor, withNote: true });
    expect(res.ok).toBe(true);
    const ids = res.ok ? (res.data as { documentId: string; annotationId: string }) : null;
    expect(ids?.documentId).toBeTruthy();

    const forUrl = await handleRequest(repos, {
      type: 'web/annotationsForUrl',
      projectId: 'p1',
      url: 'https://ex.org/a',
    });
    const payload = forUrl.ok ? (forUrl.data as { documentId: string | null; annotations: unknown[] }) : null;
    expect(payload?.documentId).toBe(ids?.documentId);
    expect(payload?.annotations).toHaveLength(1);

    const none = await handleRequest(repos, {
      type: 'web/annotationsForUrl',
      projectId: 'p1',
      url: 'https://ex.org/other',
    });
    expect(none.ok && (none.data as { documentId: string | null }).documentId).toBeNull();
  });
```

- [ ] **Step 2: Add the message types**

In `src/core/messages.ts`, after the `annotations/delete` line, add:
```ts
  'web/annotate': {
    req: { input: CaptureInput; anchor: WebAnchor; withNote: boolean };
    res: { documentId: Id; annotationId: Id };
  };
  'web/annotationsForUrl': {
    req: { projectId: Id; url: string };
    res: { documentId: Id | null; annotations: Annotation[] };
  };
```
Ensure `WebAnchor` and `CaptureInput` are imported at the top of `messages.ts` (add `WebAnchor` to the `./model/types` import; `CaptureInput` is already imported for `capture/page`).

- [ ] **Step 3: Add the router cases**

In `src/core/router.ts`, import the use-case near the other use-case imports:
```ts
import { annotateWebPage, findDocumentByUrl } from './usecases/web-annotation';
```
Add these cases (next to `annotations/*`):
```ts
      case 'web/annotate': {
        const { document, annotation, createdDocument } = await annotateWebPage(
          repos,
          request.input,
          request.anchor,
          capture,
        );
        if (createdDocument) await recordDocumentPut(repos, capture, undefined, document);
        await recordAnnotationPut(repos, capture, undefined, annotation);
        return ok({ documentId: document.id, annotationId: annotation.id }) as Result;
      }
      case 'web/annotationsForUrl': {
        const document = await findDocumentByUrl(repos, request.projectId, request.url);
        const annotations = document
          ? (await repos.annotations.listByDocument(document.id)).filter((a) => a.anchor.kind === 'web')
          : [];
        return ok({ documentId: document?.id ?? null, annotations }) as Result;
      }
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- router` then `npm run typecheck`
Expected: router tests PASS (the exhaustiveness `never` guard now compiles); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/core/messages.ts src/core/router.ts test/core/router.test.ts
git commit -m "feat(core): web/annotate and web/annotationsForUrl routes"
```

---

### Task 4: Canonical active project in chrome.storage.local

Give the feature an unambiguous target project shared across surfaces. Closes audit finding #13. A tiny adapter both surfaces and the content script use.

**Files:**
- Create: `src/adapters/chrome/active-project.ts`
- Modify: `src/sidepanel/main.ts` (replace the `storage.session` calls from v0.26.0 Fix 3 with this adapter)
- Modify: `src/options/main.ts` (`switchProject` persists; startup restores)

**Interfaces:**
- Produces:
  - `getActiveProjectId(): Promise<string | null>`
  - `setActiveProjectId(id: string): Promise<void>`
  - key constant `ACTIVE_PROJECT_KEY = 'activeProjectId'` in `chrome.storage.local`.

- [ ] **Step 1: Create the adapter**

`src/adapters/chrome/active-project.ts`:
```ts
/**
 * The one canonical "active project", shared by the side panel, the dashboard
 * and the injected annotator. Lives in chrome.storage.local (persistent, and
 * readable from a content script) so a web annotation always has an unambiguous
 * project to file into.
 */
const ACTIVE_PROJECT_KEY = 'activeProjectId';

export async function getActiveProjectId(): Promise<string | null> {
  try {
    const got = await chrome.storage.local.get(ACTIVE_PROJECT_KEY);
    const id = got[ACTIVE_PROJECT_KEY];
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

export async function setActiveProjectId(id: string): Promise<void> {
  try {
    await chrome.storage.local.set({ [ACTIVE_PROJECT_KEY]: id });
  } catch {
    // Best-effort: a failed persist just falls back to the first project.
  }
}
```

- [ ] **Step 2: Use it in the side panel**

In `src/sidepanel/main.ts`, delete the local `ACTIVE_PROJECT_KEY`/`persistActiveProject`/`restoreActiveProject` added in v0.26.0 and import the adapter:
```ts
import { getActiveProjectId, setActiveProjectId } from '../adapters/chrome/active-project';
```
Replace the body of `restoreActiveProject` with:
```ts
async function restoreActiveProject(): Promise<void> {
  const id = await getActiveProjectId();
  if (id && state.projects.some((p) => p.id === id)) state.activeProjectId = id;
}
```
and replace `persistActiveProject(projectId)` calls in `switchProject` with `setActiveProjectId(projectId)`.

- [ ] **Step 3: Use it in the dashboard**

In `src/options/main.ts`, import the adapter; in `switchProject` (`:422`) add `void setActiveProjectId(id)` after setting `state.activeProjectId`; in `loadProjects` (`:252`), after projects load and before defaulting to `projects[0]`, restore: `const saved = await getActiveProjectId(); if (saved && state.projects.some((p) => p.id === saved)) state.activeProjectId = saved;`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Manual check + commit**

Load `dist/` unpacked, switch project in the dashboard, reopen the side panel → it shows the same active project. Then:
```bash
git add src/adapters/chrome/active-project.ts src/sidepanel/main.ts src/options/main.ts
git commit -m "feat: canonical active project in chrome.storage.local, shared across surfaces"
```

---

### Task 5: Service-worker glue — activate, register per-origin, broadcast

The `chrome.*` side that the pure router cannot hold: injecting the annotator, opting an origin in, opening the side panel, and broadcasting changes.

**Files:**
- Create: `src/background/annotator-control.ts`
- Modify: `src/background/service-worker.ts` (register the listeners)
- Modify: `src/manifest.config.ts` (add `permissions: 'tabs'`? no — keep least privilege; add nothing. Host access stays optional.)

**Interfaces:**
- Produces (runtime messages handled OUTSIDE `handleRequest`, in a `chrome.runtime.onMessage` listener keyed on a `control` field so they never collide with router messages):
  - `{ control: 'annotator/activate' }` → injects `annotator.js` into the active tab via `chrome.scripting.executeScript`.
  - `{ control: 'annotator/registerOrigin', origin: string }` → requests the origin's host permission and, if granted, `registerContentScripts`. Returns `{ registered: boolean }`.
  - `{ control: 'annotator/changed', url: string }` → re-broadcast to all extension contexts + the tab (so side panel reloads and content script repaints).

- [ ] **Step 1: Write the control module**

`src/background/annotator-control.ts`:
```ts
/**
 * Service-worker glue for the web annotator. Everything here is chrome.* — it is
 * deliberately outside the pure router. Control messages carry a `control` field
 * so they never collide with the typed domain messages.
 */
const ANNOTATOR_FILE = 'annotator.js';

export interface ControlMessage {
  control: 'annotator/activate' | 'annotator/registerOrigin' | 'annotator/changed';
  origin?: string;
  url?: string;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function activate(): Promise<{ ok: boolean }> {
  const tabId = await activeTabId();
  if (tabId == null) return { ok: false };
  await chrome.scripting.executeScript({ target: { tabId }, files: [ANNOTATOR_FILE] });
  return { ok: true };
}

async function registerOrigin(origin: string): Promise<{ registered: boolean }> {
  const pattern = `${origin}/*`;
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return { registered: false };
  const id = `annotator-${origin.replace(/[^a-z0-9]/gi, '-')}`;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [id] });
  } catch {
    // not registered yet — fine
  }
  await chrome.scripting.registerContentScripts([
    { id, matches: [pattern], js: [ANNOTATOR_FILE], world: 'ISOLATED', runAt: 'document_idle' },
  ]);
  return { registered: true };
}

/** Tell every context (side panel + the tab's content script) that a URL changed. */
async function broadcast(url: string): Promise<void> {
  chrome.runtime.sendMessage({ control: 'annotator/changed', url }).catch(() => {});
  const tabId = await activeTabId();
  if (tabId != null) chrome.tabs.sendMessage(tabId, { control: 'annotator/changed', url }).catch(() => {});
}

/** Wire the control listener. Returns synchronously; replies are async. */
export function registerAnnotatorControl(): void {
  chrome.runtime.onMessage.addListener((message: ControlMessage, _sender, sendResponse) => {
    if (!message || typeof message.control !== 'string') return; // not ours — let the router handle it
    void (async () => {
      if (message.control === 'annotator/activate') sendResponse(await activate());
      else if (message.control === 'annotator/registerOrigin' && message.origin)
        sendResponse(await registerOrigin(message.origin));
      else if (message.control === 'annotator/changed' && message.url) {
        await broadcast(message.url);
        sendResponse({ ok: true });
      }
    })();
    return true;
  });
}
```

- [ ] **Step 2: Register it in the service worker**

In `src/background/service-worker.ts`, import and call after `registerMessageRouter(...)`:
```ts
import { registerAnnotatorControl } from './annotator-control';
// …
registerAnnotatorControl();
```
Note: the router's own listener ignores messages it does not recognise by returning an error result, and this listener ignores messages without a `control` field, so the two coexist on `onMessage`.

- [ ] **Step 3: Verify build + guard against router collision**

Run: `npm run typecheck && npm run build`
Expected: green. Confirm `handleRequest` returns an error (not a throw) for a `{ control }` message — the messaging adapter already wraps errors, and control messages are handled/answered by the control listener first.

- [ ] **Step 4: Commit**

```bash
git add src/background/annotator-control.ts src/background/service-worker.ts
git commit -m "feat(background): annotator activation, per-origin registration, change broadcast"
```

---

### Task 6: Content script — selection toolbar, create anchor, paint

Wire the real annotator: a shadow-DOM toolbar on selection, `createWebAnchor`, send `web/annotate`, paint the new highlight as overlay rects. Reposition on scroll/resize.

**Files:**
- Modify: `src/content/annotator.ts` (replace the stub)
- Create: `src/content/annotator.css` (imported as an inline string)

**Interfaces:**
- Consumes: `createWebAnchor`, `resolveWebAnchor` (`src/core/anchoring/web.ts`); `scanDocumentRaw`, `buildCaptureInput` (`src/adapters/chrome/page-scan.ts`); `getActiveProjectId` (Task 4); `web/annotate` message (Task 3); control messages (Task 5).
- Produces: a self-contained content script that renders highlights and posts annotations.

- [ ] **Step 1: Implement the annotator core (create + paint)**

Replace `src/content/annotator.ts` with:
```ts
/**
 * Injected web-page annotator (ISOLATED world). Renders only inside a shadow
 * root — a selection toolbar and absolutely-positioned highlight overlays. It
 * never wraps or mutates page nodes (that would break page layout/reactivity):
 * highlights are overlay rects computed from Range.getClientRects().
 */
import { createWebAnchor, resolveWebAnchor } from '../core/anchoring/web';
import { scanDocumentRaw, buildCaptureInput } from '../adapters/chrome/page-scan';
import { getActiveProjectId } from '../adapters/chrome/active-project';
import type { Annotation, WebAnchor } from '../core/model/types';
import annotatorCss from './annotator.css?inline';

const HOST_ID = 'context-notes-annotator';

interface Painted {
  annotation: Annotation;
  anchor: WebAnchor;
}

const painted: Painted[] = [];

function shadowRoot(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (host?.shadowRoot) return host.shadowRoot;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: absolute; top: 0; left: 0; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = annotatorCss;
  root.appendChild(style);
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.appendChild(layer);
  document.body.appendChild(host);
  return root;
}

function overlayLayer(): HTMLElement {
  return shadowRoot().querySelector('.layer') as HTMLElement;
}

function pageRects(range: Range): DOMRect[] {
  return [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
}

function paintOne(id: string, rects: DOMRect[], moved: boolean): void {
  const layer = overlayLayer();
  const sx = window.scrollX;
  const sy = window.scrollY;
  for (const r of rects) {
    const ov = document.createElement('div');
    ov.className = `ov${moved ? ' moved' : ''}`;
    ov.dataset.id = id;
    ov.style.left = `${r.left + sx}px`;
    ov.style.top = `${r.top + sy}px`;
    ov.style.width = `${r.width}px`;
    ov.style.height = `${r.height}px`;
    ov.addEventListener('click', () => {
      chrome.runtime.sendMessage({ control: 'annotator/focus', id }).catch(() => {});
    });
    layer.appendChild(ov);
  }
}

function repaintAll(): void {
  overlayLayer().replaceChildren();
  for (const p of painted) {
    const range = resolveWebAnchor(document.body, p.anchor);
    paintOne(p.annotation.id, range ? pageRects(range) : [], false);
  }
}

async function commit(range: Range, withNote: boolean): Promise<void> {
  const anchor = createWebAnchor(document.body, range);
  const scan = scanDocumentRaw();
  const projectId = (await getActiveProjectId()) ?? '';
  const input = buildCaptureInput(scan, projectId);
  const res = (await chrome.runtime.sendMessage({ type: 'web/annotate', input, anchor, withNote })) as
    | { ok: true; data: { documentId: string; annotationId: string } }
    | { ok: false; error: string };
  if (!res.ok) return;
  paintOne(res.data.annotationId, pageRects(range), false);
  window.getSelection()?.removeAllRanges();
  hideToolbar();
  // Let the service worker open the side panel + broadcast the change.
  chrome.runtime.sendMessage({ control: 'annotator/changed', url: scan.url }).catch(() => {});
}
```
(The selection toolbar and `hideToolbar` are added in Step 2; `annotatorCss` and reposition wiring below.)

- [ ] **Step 2: Add the selection toolbar and lifecycle**

Append to `src/content/annotator.ts`:
```ts
let toolbar: HTMLElement | null = null;

function hideToolbar(): void {
  toolbar?.remove();
  toolbar = null;
}

function showToolbar(x: number, y: number, range: Range): void {
  hideToolbar();
  const el = document.createElement('div');
  el.className = 'toolbar';
  for (const [label, withNote] of [
    ['Highlight', false],
    ['Note', true],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      void commit(range, withNote);
    });
    el.appendChild(b);
  }
  el.style.left = `${x + window.scrollX}px`;
  el.style.top = `${y + window.scrollY}px`;
  overlayLayer().appendChild(el);
  toolbar = el;
}

function onMouseUp(): void {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) {
    hideToolbar();
    return;
  }
  const range = sel.getRangeAt(0);
  const rects = pageRects(range);
  const last = rects[rects.length - 1];
  if (!last) return;
  showToolbar(last.left, last.top - 40, range);
}

async function loadExisting(): Promise<void> {
  const projectId = (await getActiveProjectId()) ?? '';
  const scan = scanDocumentRaw();
  const res = (await chrome.runtime.sendMessage({
    type: 'web/annotationsForUrl',
    projectId,
    url: scan.url,
  })) as { ok: true; data: { annotations: Annotation[] } } | { ok: false };
  if (!res.ok) return;
  painted.length = 0;
  for (const annotation of res.data.annotations) {
    if (annotation.anchor.kind === 'web') painted.push({ annotation, anchor: annotation.anchor });
  }
  repaintAll();
}

document.addEventListener('mouseup', () => setTimeout(onMouseUp, 0));
window.addEventListener('scroll', repaintAll, { passive: true });
window.addEventListener('resize', repaintAll);
chrome.runtime.onMessage.addListener((m: { control?: string }) => {
  if (m?.control === 'annotator/changed') void loadExisting();
});

void loadExisting();
```

- [ ] **Step 3: Add the styles**

`src/content/annotator.css`:
```css
.layer { position: absolute; top: 0; left: 0; width: 0; height: 0; }
.ov {
  position: absolute; pointer-events: auto; cursor: pointer;
  background: rgba(224, 122, 95, 0.22); box-shadow: inset 0 -2px 0 rgba(224, 122, 95, 0.6);
  border-radius: 2px;
}
.ov.moved { background: rgba(224, 168, 95, 0.22); box-shadow: inset 0 -2px 0 rgba(224, 168, 95, 0.7); }
.toolbar {
  position: absolute; display: flex; gap: 2px; padding: 3px;
  background: #1c1a18; border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font: 500 12px/1 -apple-system, system-ui, sans-serif;
}
.toolbar button {
  border: 0; background: none; color: #f4f1ee; padding: 6px 10px; border-radius: 5px; cursor: pointer;
}
.toolbar button:hover { background: rgba(255, 255, 255, 0.12); }
```

- [ ] **Step 4: Verify build (self-contained still holds)**

Run: `npm run typecheck && npm run build` then the Task-1 self-contained check:
`test -f dist/annotator.js && ! grep -Eq "from ['\"]\\./assets/" dist/annotator.js && echo OK`
Expected: `OK`. If the `?inline` CSS or `web.ts` deps split out, widen `manualChunks` (Task 1, Step 4).

- [ ] **Step 5: Commit**

```bash
git add src/content/annotator.ts src/content/annotator.css
git commit -m "feat(content): selection toolbar, web anchor creation, and highlight painting"
```

---

### Task 7: Per-origin opt-in on first annotation + side panel "On this page"

Two user-facing halves that finish the loop: register the origin after the first annotation, and edit/manage notes in the side panel.

**Files:**
- Modify: `src/content/annotator.ts` (request origin registration once per origin)
- Modify: `src/sidepanel/main.ts` + `src/sidepanel/index.html` + `src/sidepanel/panel.css` (the "On this page" section + "Annotate this page" button)
- Modify: `src/background/annotator-control.ts` (add the `annotator/focus` → forward to side panel, and open the side panel on annotate)

**Interfaces:**
- Consumes: `web/annotationsForUrl`, `annotations/put`, `annotations/delete`; control messages.
- Produces: a working annotate→edit→revisit loop.

- [ ] **Step 1: Register the origin after the first successful annotation**

In `src/content/annotator.ts` `commit`, after a successful `web/annotate`, ask the SW to opt this origin in (idempotent; the SW no-ops if already registered):
```ts
  if (!res.ok) return;
  chrome.runtime.sendMessage({ control: 'annotator/registerOrigin', origin: location.origin }).catch(() => {});
  paintOne(res.data.annotationId, pageRects(range), false);
```

- [ ] **Step 2: Open the side panel on annotate**

In `src/background/annotator-control.ts`, in the `annotator/changed` branch, open the side panel for the tab (on the user gesture that produced the annotation):
```ts
      else if (message.control === 'annotator/changed' && message.url) {
        const tabId = await activeTabId();
        if (tabId != null) await chrome.sidePanel.open({ tabId }).catch(() => {});
        await broadcast(message.url);
        sendResponse({ ok: true });
      }
```
Add a `annotator/focus` forward (content-script click → side panel scrolls to that note):
```ts
      else if (message.control === 'annotator/focus' && message.id) {
        chrome.runtime.sendMessage({ control: 'annotator/focus', id: message.id }).catch(() => {});
        sendResponse({ ok: true });
      }
```
Extend `ControlMessage.control` union with `'annotator/focus'` and add `id?: string`.

- [ ] **Step 3: Add the "On this page" section to the side panel HTML**

In `src/sidepanel/index.html`, after the capture card `</section>` (`:48`), add:
```html
        <section class="onpage" id="onPageCard" data-od-id="onpage-card" hidden>
          <div class="section-label">On this page <span class="rule"></span></div>
          <div class="onpage__actions">
            <button class="btn" id="annotateBtn">Annotate this page</button>
          </div>
          <div id="onPageList"></div>
        </section>
```

- [ ] **Step 4: Render web annotations for the current page**

In `src/sidepanel/main.ts`, add state `pageAnnotations: Annotation[]` and `pageDocumentId: string | null`; import `Annotation`. Add a loader keyed on the current preview URL:
```ts
async function loadPageAnnotations(): Promise<void> {
  const url = state.preview?.url;
  if (!state.activeProjectId || !url) {
    state.pageAnnotations = [];
    state.pageDocumentId = null;
    return;
  }
  const { documentId, annotations } = await sendRequest({
    type: 'web/annotationsForUrl',
    projectId: state.activeProjectId,
    url,
  });
  state.pageDocumentId = documentId;
  state.pageAnnotations = annotations;
}
```
Render (build DOM programmatically — no `innerHTML` for note content): a card per annotation with the quote (`anchorQuote`-equivalent: `a.anchor.kind === 'web'` → first `textQuote` selector's `exact`), a `textarea` (debounced `annotations/put`), a status `select`, a delete button (`annotations/delete`), and a "Jump to" button that sends `{ control: 'annotator/focus', id }` — wait, jump-to must reach the *content script*; send via `chrome.tabs.sendMessage` is not available in the panel, so route through the SW: `chrome.runtime.sendMessage({ control: 'annotator/jump', id })` and have `annotator-control.ts` forward it to the active tab. Add the `annotator/jump` branch mirroring `annotator/changed`'s `chrome.tabs.sendMessage`. Group any annotation the content script could not resolve under a "Couldn't place on this page" heading — the content script reports resolved ids back via a `{ control: 'annotator/resolved', ids }` message after `loadExisting`; the panel marks the rest as lost.
Wire `#annotateBtn` → `chrome.runtime.sendMessage({ control: 'annotator/activate' })`. Show `#onPageCard` only when the preview is a normal web page (`state.preview` exists); otherwise keep it `hidden`. Call `loadPageAnnotations()` inside `refreshPreview()` and re-render, and on the `{ control: 'annotator/changed' }` runtime message.

- [ ] **Step 5: Style the section**

In `src/sidepanel/panel.css`, add minimal styles for `.onpage`, `.onpage__actions`, a note card, and a `.lost` group heading, reusing existing tokens (`var(--surface)`, `var(--border)`, `var(--muted)`).

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 7: Manual smoke + commit**

Load `dist/` unpacked. On a normal article: side panel shows "Annotate this page" → click → select text → Highlight → overlay appears, note shows in the panel; reload the page → highlight repaints; edit the note → persists. Then:
```bash
git add src/content/annotator.ts src/background/annotator-control.ts src/sidepanel/
git commit -m "feat: per-origin opt-in and the side-panel On this page notes view"
```

---

### Task 8: End-to-end test

Prove the loop against a real page under Playwright, with a bundled fixture so no network is involved.

**Files:**
- Create: `e2e/fixtures/article.html`
- Create: `e2e/webannotation.spec.ts`

**Interfaces:**
- Consumes: the built extension (`dist/`), the existing Playwright harness in `e2e/`.

- [ ] **Step 1: Add the fixture page**

`e2e/fixtures/article.html`: a minimal static HTML article with a `<p>` containing the sentence `The urban heat island effect raises night-time temperatures.` and a stable `<title>`.

- [ ] **Step 2: Write the E2E test**

`e2e/webannotation.spec.ts` (follow the existing `e2e/sidepanel.spec.ts` harness for loading the extension and opening the side panel):
```ts
// 1. Open the fixture via file:// or the test server used by the suite.
// 2. Trigger activation (side panel "Annotate this page", or inject annotator.js directly for the test).
// 3. Select the sentence, click "Highlight".
// 4. Assert a .ov overlay exists in the annotator shadow root.
// 5. Reload the page; assert the overlay repaints (loadExisting resolves the stored anchor).
// 6. Assert the note appears in the side panel "On this page" list.
```
Write the concrete Playwright steps mirroring `e2e/pdfviewer.spec.ts:113` (which already asserts an anchor overlay + rail card persists), adapted to the shadow-root selector `#context-notes-annotator` and `.ov`.

- [ ] **Step 3: Run E2E**

Run: `npm run test:e2e`
Expected: the new spec passes alongside the existing 24.

- [ ] **Step 4: Commit**

```bash
git add e2e/fixtures/article.html e2e/webannotation.spec.ts
git commit -m "test(e2e): web annotation — highlight, repaint on reload, side-panel note"
```

---

### Task 9: Docs and release (v0.27.0)

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `doc/STATUS.md`

- [ ] **Step 1: Bump version** — `package.json` `"version": "0.27.0"`.
- [ ] **Step 2: CHANGELOG** — move a new `## [0.27.0] — <date>` section above `[0.26.0]`, `### Added` describing web-page annotation (hybrid activation, auto-file, side-panel notes, anchor-lost). Update the `[Unreleased]`/`[0.27.0]` compare links.
- [ ] **Step 3: README + STATUS** — README status line → `v0.27.0`; note web annotation now works and the least-privilege activation model. `doc/STATUS.md`: web annotation delivered; remove it from the deferred list; bump test counts.
- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`
Expected: all green.

- [ ] **Step 5: Commit, tag, release**

```bash
git add package.json CHANGELOG.md README.md doc/STATUS.md
git commit -m "chore(release): v0.27.0 — web-page annotation"
git tag -a v0.27.0 -m "v0.27.0 — web-page annotation"
git push origin main --follow-tags
gh release create v0.27.0 --title "v0.27.0 — web-page annotation" --notes "<CHANGELOG [0.27.0] body>"
```

---

## Self-Review

**Spec coverage:**
- Hybrid activation → Tasks 5 (register/activate) + 7 (opt-in on first annotation). ✓
- Auto-file to canonical active project → Tasks 2 (annotateWebPage) + 4 (storage.local). ✓
- Side-panel-driven UI (toolbar + highlights injected; notes in panel) → Tasks 6 + 7. ✓
- Reuse web.ts / capturePage / Annotation, no schema change → Tasks 2, 3, 6. ✓
- Two append-only messages → Task 3. ✓
- Dedup by URL (finding #12), no-active-project fallback → Task 2. ✓
- Anchor-lost surfacing → Task 6 (resolve→null) + Task 7 ("Couldn't place" group). ✓
- Restricted pages, scroll/resize reposition, shadow isolation → Task 6. ✓
- Build risk (stable self-contained file) → Task 1. ✓
- Testing (unit/router/E2E) → Tasks 2, 3, 8. ✓
- Release → Task 9. ✓

**Placeholder scan:** Task 7 Step 4 describes the render loop rather than giving one code block, because it composes helpers defined across Tasks 3/5 and the existing side-panel DOM patterns; the referenced messages and control verbs are all concretely defined. The E2E spec (Task 8) gives a step outline plus the exact reference test to mirror (`e2e/pdfviewer.spec.ts:113`) — acceptable because the harness boilerplate is non-trivial and already established in-repo. No `TBD`/`handle appropriately` placeholders remain.

**Type consistency:** `annotateWebPage` returns `{ document, annotation, createdDocument }` (Task 2), consumed exactly so in Task 3. `web/annotate` req/res and `web/annotationsForUrl` req/res match between Task 3, Task 6 (`chrome.runtime.sendMessage` shapes) and Task 7. `getActiveProjectId`/`setActiveProjectId` names match across Tasks 4, 6, 7. Control verbs (`annotator/activate|registerOrigin|changed|focus|jump`) are defined in Task 5/7 and used consistently. The annotator file path constant `'annotator.js'` matches the build output pinned in Task 1.
