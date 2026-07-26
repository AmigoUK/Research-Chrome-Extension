# A3 — Web annotation in open Shadow DOM: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the web annotator anchor selections made inside **open Shadow DOM**, and show an honest "can't annotate here" hint when a selection crosses a shadow boundary we cannot resolve.

**Architecture:** Add one optional `shadowHost` field to `WebAnchor` (a light-DOM CSS path to the shadow host). Core anchoring (`web.ts`) anchors against any `ParentNode` root (a `ShadowRoot` works unchanged) and a new pure `webAnchorRoot` helper turns a stored `shadowHost` back into a live root. The content-script glue detects the shadow root from the mouseup's `composedPath()` (captured synchronously), reads the selection via `ShadowRoot.getSelection()`, and threads the root through commit/repaint.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vitest + jsdom (unit), Playwright (E2E), `dom-anchor-text-quote` / `dom-anchor-text-position`.

## Global Constraints

- `src/core` stays DOM-capable but **storage/`chrome.*`-free** (`web.ts` is DOM-dependent by design, tested under jsdom).
- **Anchor model is append-only.** `shadowHost` is optional; existing anchors omit it and resolve against `document.body` exactly as before. **No IDB schema bump** — the anchor is an opaque object inside the annotation record and `snapshot/validate.ts` does not inspect it (verified).
- **Files are `kebab-case.ts`; types `PascalCase`; funcs/vars `camelCase`.** Comments explain **why**.
- `exactOptionalPropertyTypes: true` — an optional field assigned `undefined` needs `T | undefined`, not `?: T`.
- Build the annotator as its own bundle (`vite.annotator.config.ts`); never import it into the SW.
- Release rule: patch `v0.27.3`; CHANGELOG + README + `doc/STATUS.md` ship with the release.

---

### Task 1: Core anchoring for open Shadow DOM

**Files:**
- Modify: `src/core/model/types.ts` (add `shadowHost?` to `WebAnchor`)
- Modify: `src/core/anchoring/web.ts` (`cssPath`/`createWebAnchor`/`resolveWebAnchor` root widened to `ParentNode`; new `webAnchorRoot`)
- Test: `src/core/anchoring/web.test.ts` (append cases)

**Interfaces:**
- Produces:
  - `createWebAnchor(root: ParentNode, range: Range, shadowHost?: string): WebAnchor`
  - `resolveWebAnchor(root: ParentNode, anchor: WebAnchor): Range | null`
  - `webAnchorRoot(doc: Document, anchor: WebAnchor): ParentNode`
  - `cssPath(root: ParentNode, element: Element): string`
  - `WebAnchor.shadowHost?: string`

- [ ] **Step 1: Write the failing tests** — append to `src/core/anchoring/web.test.ts`:

```ts
import { createWebAnchor, resolveWebAnchor, cssPath, webAnchorRoot } from './web';
import type { TextQuoteSelector } from '../model/types';

describe('open Shadow DOM anchoring', () => {
  function shadowFixture(): { host: HTMLElement; root: ShadowRoot; text: Text } {
    document.body.innerHTML = '<section><div id="host"></div></section>';
    const host = document.getElementById('host') as HTMLElement;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>Alpha beta gamma delta epsilon.</p>';
    const text = root.querySelector('p')!.firstChild as Text;
    return { host, root, text };
  }

  it('anchors a selection inside an open shadow root, recording the host path', () => {
    const { host, root, text } = shadowFixture();
    const range = document.createRange();
    range.setStart(text, 6); // "beta gamma"
    range.setEnd(text, 16);
    const hostPath = cssPath(document.body, host);

    const anchor = createWebAnchor(root, range, hostPath);

    expect(anchor.shadowHost).toBe(hostPath);
    const quote = anchor.selectors.find((s): s is TextQuoteSelector => s.type === 'textQuote');
    expect(quote?.exact).toBe('beta gamma');
  });

  it('round-trips: webAnchorRoot finds the root and resolveWebAnchor re-derives the range', () => {
    const { host, root, text } = shadowFixture();
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 16);
    const anchor = createWebAnchor(root, range, cssPath(document.body, host));

    const resolvedRoot = webAnchorRoot(document, anchor);
    expect(resolvedRoot).toBe(root);
    expect(resolveWebAnchor(resolvedRoot, anchor)?.toString()).toBe('beta gamma');
  });

  it('webAnchorRoot: no shadowHost → document.body', () => {
    expect(webAnchorRoot(document, { kind: 'web', selectors: [] })).toBe(document.body);
  });

  it('webAnchorRoot: an unresolvable shadowHost falls back to document.body', () => {
    document.body.innerHTML = '<p>plain</p>';
    expect(webAnchorRoot(document, { kind: 'web', selectors: [], shadowHost: '#gone' })).toBe(document.body);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/core/anchoring/web.test.ts`
Expected: FAIL — `webAnchorRoot` is not exported / `createWebAnchor` rejects a 3rd arg.

- [ ] **Step 3: Add the model field** — in `src/core/model/types.ts`, `WebAnchor`:

```ts
export interface WebAnchor {
  kind: 'web';
  selectors: Array<TextQuoteSelector | TextPositionSelector | CssSelector>;
  /** CSS path (in the light DOM) to the open shadow HOST whose shadowRoot is the
   *  anchoring root. Absent → the anchor is relative to document.body. */
  shadowHost?: string;
}
```

- [ ] **Step 4: Implement in `src/core/anchoring/web.ts`**

Widen `cssPath` root to `ParentNode`:

```ts
export function cssPath(root: ParentNode, element: Element): string {
```
(body unchanged — it only compares `node !== root` and walks `parentElement`.)

Extend `createWebAnchor`:

```ts
export function createWebAnchor(root: ParentNode, range: Range, shadowHost?: string): WebAnchor {
  const selectors: Array<TextQuoteSelector | TextPositionSelector | CssSelector> = [];

  const quote = textQuote.fromRange(root, range);
  selectors.push({
    type: 'textQuote',
    exact: quote.exact,
    ...(quote.prefix ? { prefix: quote.prefix } : {}),
    ...(quote.suffix ? { suffix: quote.suffix } : {}),
  });

  const position = textPosition.fromRange(root, range);
  selectors.push({ type: 'textPosition', start: position.start, end: position.end });

  const element = nearestElement(range.commonAncestorContainer);
  if (element) {
    const value = cssPath(root, element);
    if (value) selectors.push({ type: 'css', value });
  }

  // Only attach shadowHost when present, to satisfy exactOptionalPropertyTypes.
  return shadowHost ? { kind: 'web', selectors, shadowHost } : { kind: 'web', selectors };
}
```

Widen `resolveWebAnchor` root to `ParentNode` (signature only):

```ts
export function resolveWebAnchor(root: ParentNode, anchor: WebAnchor): Range | null {
```

Add the helper (after `resolveWebAnchor`):

```ts
/** Turn a stored anchor's `shadowHost` back into the live root to anchor within.
 *  No host → document.body; a host that no longer resolves → document.body too,
 *  so a note is reported unplaced rather than mis-anchored against the wrong root. */
export function webAnchorRoot(doc: Document, anchor: WebAnchor): ParentNode {
  if (!anchor.shadowHost) return doc.body;
  return doc.querySelector(anchor.shadowHost)?.shadowRoot ?? doc.body;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/core/anchoring/web.test.ts`
Expected: PASS (all cases, including the pre-existing 4).

- [ ] **Step 6: Typecheck** — `npm run typecheck` → clean (confirms every `createWebAnchor`/`resolveWebAnchor` caller still compiles with the widened `ParentNode` root).

- [ ] **Step 7: Commit**

```bash
git add src/core/model/types.ts src/core/anchoring/web.ts src/core/anchoring/web.test.ts
git commit -m "feat(core): anchor web selections within an open shadow root"
```

---

### Task 2: Content-script wiring + graceful hint

**Files:**
- Modify: `src/content/annotator.ts`
- Modify: `src/content/annotator.css` (`.hint` style)

**Interfaces:**
- Consumes: `createWebAnchor(root, range, shadowHost?)`, `resolveWebAnchor`, `webAnchorRoot`, `cssPath` from Task 1.
- Produces: no exported API (content-script glue). Verified by Task 3 E2E + typecheck.

Glue is not unit-mountable (the module registers listeners on import), so this task carries no unit test; its behaviour is proven by Task 3's E2E and by `npm run typecheck`. This is the same coverage model used for A1/A2 glue.

- [ ] **Step 1: Capture composedPath synchronously.** `composedPath()` is only valid during dispatch, so it must be read in the listener, not after the `setTimeout`. Replace the mouseup registration:

```ts
  document.addEventListener('mouseup', (e) => {
    const path = e.composedPath();
    setTimeout(() => onMouseUp(path), 0);
  });
```

- [ ] **Step 2: Add a pending-target holder and rewrite `onMouseUp`.** Above `onMouseUp`, add:

```ts
interface SelectionTarget {
  range: Range;
  root: ParentNode;
  shadowHost?: string;
}
// The target the open toolbar was built for — read by commit() when a button is
// clicked, since the selection is resolved at mouseup, not at click time.
let pendingTarget: SelectionTarget | null = null;
```

Rewrite `onMouseUp`:

```ts
function onMouseUp(path: EventTarget[]): void {
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().trim()) {
    pendingTarget = { range: sel.getRangeAt(0), root: document.body };
    showToolbar(pendingTarget.range);
    return;
  }

  // A selection inside an OPEN shadow root doesn't surface on window.getSelection();
  // the composed path reveals the ShadowRoot, whose own getSelection() has it.
  const shadowRoot = path.find((n): n is ShadowRoot => n instanceof ShadowRoot);
  if (shadowRoot) {
    const ssel = (shadowRoot as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
    if (ssel && !ssel.isCollapsed && ssel.toString().trim()) {
      pendingTarget = {
        range: ssel.getRangeAt(0),
        root: shadowRoot,
        shadowHost: cssPath(document.body, shadowRoot.host),
      };
      showToolbar(pendingTarget.range);
      return;
    }
    // Saw a shadow boundary but got no usable selection from it (e.g. a root that
    // switched to closed): say so instead of silently showing nothing.
    hideToolbar();
    showUnsupportedHint(pendingTarget?.range ?? null);
    return;
  }
  hideToolbar();
}
```

- [ ] **Step 3: Thread the target through the toolbar buttons.** In `showToolbar`, change the button handler to commit the pending target:

```ts
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (pendingTarget) void commit(pendingTarget, withNote);
    });
```

- [ ] **Step 4: Rewrite `commit` to take the target.** Change the signature and the anchor call; clear `pendingTarget` on both paths:

```ts
async function commit(target: SelectionTarget, withNote: boolean): Promise<void> {
  const { range, root, shadowHost } = target;
  try {
    const anchor = createWebAnchor(root, range, shadowHost);
    const scan = scanDocumentRaw();
    const projectId = (await getActiveProjectId()) ?? '';
    const input = buildCaptureInput(scan, projectId);
    const res = (await chrome.runtime.sendMessage({ type: 'web/annotate', input, anchor, withNote })) as
      | { ok: true; data: { documentId: string; annotationId: string } }
      | { ok: false; error: string };
    if (!res.ok) {
      hideToolbar();
      return;
    }
    if (!registeredOrigins.has(location.origin)) {
      registeredOrigins.add(location.origin);
      chrome.runtime.sendMessage({ control: 'annotator/registerOrigin', origin: location.origin }).catch(() => {});
    }
    paintOne(res.data.annotationId, pageRects(range));
    window.getSelection()?.removeAllRanges();
    hideToolbar();
    chrome.runtime.sendMessage({ control: 'annotator/changed', url: scan.url }).catch(() => {});
  } catch {
    // See A1: a rejected round trip must not leave the toolbar stuck or go unhandled.
    hideToolbar();
  }
}
```

- [ ] **Step 5: Resolve per-note against the right root.** In `resolveAndRepaintAll`, change the resolve line:

```ts
    p.range = resolveWebAnchor(webAnchorRoot(document, p.anchor), p.anchor);
```

Add the import at the top:

```ts
import { createWebAnchor, resolveWebAnchor, webAnchorRoot, cssPath } from '../core/anchoring/web';
```

- [ ] **Step 6: Add the graceful hint.** Add near `hideToolbar`:

```ts
/** A brief, non-interactive notice in the toolbar layer for a selection we can't
 *  anchor (a shadow boundary we couldn't read). Auto-removes; never blocks input. */
function showUnsupportedHint(range: Range | null): void {
  hideToolbar();
  const el = document.createElement('div');
  el.className = 'hint';
  el.textContent = "Can't annotate inside this component";
  const rects = range ? pageRects(range) : [];
  const last = rects[rects.length - 1];
  el.style.left = `${last ? last.left : 8}px`;
  el.style.top = `${last ? Math.max(4, last.top - 40) : 8}px`;
  toolbarLayer().appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
```

- [ ] **Step 7: Style the hint.** Append to `src/content/annotator.css` (match `.toolbar`'s look; non-interactive):

```css
.hint {
  position: fixed;
  z-index: 2147483647;
  padding: 4px 8px;
  font: 12px/1.4 system-ui, sans-serif;
  color: #fff;
  background: #b45309;
  border-radius: 6px;
  pointer-events: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 8: Typecheck + build** — `npm run typecheck` clean; `npm run build` produces `dist/annotator.js`.

- [ ] **Step 9: Commit**

```bash
git add src/content/annotator.ts src/content/annotator.css
git commit -m "feat(content): detect and anchor selections in open shadow DOM; hint otherwise"
```

---

### Task 3: E2E — annotate inside an open shadow root

**Files:**
- Create: `e2e/fixtures/shadow-article.html`
- Modify: `e2e/webannotation.spec.ts` (one new test; the `beforeAll` already copies fixtures — extend it to copy this one)

**Interfaces:**
- Consumes: the built `dist/annotator.js` from Task 2, the harness (`fixtureUrl`, `annotatorUrl`, `extensionId`) already in the spec.

The real-event detail that matters: a genuine mouseup inside an open shadow root reaches the document listener with the ShadowRoot in `composedPath()`. The test must reproduce that by dispatching the mouseup **from the inner shadow node** with `composed: true` (a document-level dispatch, as the light-DOM tests use, would not carry the ShadowRoot).

- [ ] **Step 1: Create the fixture** `e2e/fixtures/shadow-article.html`:

```html
<!doctype html>
<meta charset="utf-8" />
<title>Shadow article</title>
<main style="position: relative; padding: 20px">
  <h1>Shadow host page</h1>
  <div id="host"></div>
</main>
<script>
  const root = document.getElementById('host').attachShadow({ mode: 'open' });
  root.innerHTML =
    '<p style="font: 16px/1.5 system-ui">Photosynthesis converts sunlight into chemical energy.</p>';
</script>
```

- [ ] **Step 2: Copy the fixture in `beforeAll`.** In `e2e/webannotation.spec.ts`, next to the existing `copyFileSync(fixtureSrc, fixtureDest)`, add:

```ts
copyFileSync(
  fileURLToPath(new URL('./fixtures/shadow-article.html', import.meta.url)),
  path.join(distPath, 'shadow-article.html'),
);
```
and remove it in `afterAll` alongside the existing `rmSync`:
```ts
rmSync(path.join(distPath, 'shadow-article.html'), { force: true });
```

- [ ] **Step 3: Write the failing E2E test** — append to `e2e/webannotation.spec.ts`:

```ts
test('anchors a selection made inside an open shadow root, and repaints after reload', async () => {
  const shadowSentence = 'Photosynthesis converts sunlight into chemical energy.';
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/shadow-article.html`);
  await page.addScriptTag({ url: annotatorUrl() });
  await expect(page.locator('#context-notes-annotator')).toHaveCount(1);

  // Select the shadow-tree sentence and fire the mouseup FROM the shadow node,
  // composed:true, so the annotator's document listener sees the ShadowRoot in
  // composedPath() — exactly what a real user mouseup carries.
  await page.evaluate((sentence) => {
    const root = (document.getElementById('host') as HTMLElement).shadowRoot!;
    const p = root.querySelector('p')!;
    const sel = root.getSelection ? root.getSelection()! : window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.removeAllRanges();
    sel.addRange(range);
    void sentence;
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }));
  }, shadowSentence);

  await expect(page.locator('#context-notes-annotator .toolbar')).toBeVisible();
  await page.locator('#context-notes-annotator .toolbar button', { hasText: 'Highlight' }).click();
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(1);

  // Reload: the anchor must resolve from its stored shadowHost and repaint.
  await page.reload();
  await page.addScriptTag({ url: annotatorUrl() });
  await expect(page.locator('#context-notes-annotator .ov')).toHaveCount(1);

  // Persistence carries the shadowHost.
  const stored = await page.evaluate(async () => {
    return (await chrome.runtime.sendMessage({
      type: 'web/annotationsForUrl',
      projectId: '',
      url: location.href,
    })) as { ok: true; data: { annotations: Array<{ anchor: { shadowHost?: string } }> } };
  });
  expect(stored.data.annotations).toHaveLength(1);
  expect(stored.data.annotations[0]?.anchor.shadowHost).toBeTruthy();
  await page.close();
});
```

- [ ] **Step 4: Run the E2E**

Run: `npm run test:e2e`
Expected: all prior tests plus this one PASS.

**If shadow selection can't be simulated** (Playwright/Chrome does not expose the shadow selection to the annotator via `ShadowRoot.getSelection()` in this harness): do NOT weaken the assertion. Instead, log the limitation in the test file header the way `webannotation.spec.ts` already documents the activation-path bypass, mark this E2E `test.fixme` with a one-line reason, and rely on Task 1's unit round-trip + manual verification (the core anchoring is what carries the guarantee; the glue is thin). Record the decision in the release notes.

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/shadow-article.html e2e/webannotation.spec.ts
git commit -m "test(e2e): annotate inside an open shadow root and repaint after reload"
```

---

### Task 4: Release v0.27.3

**Files:**
- Modify: `package.json` (`0.27.2` → `0.27.3`), `CHANGELOG.md`, `README.md`, `doc/STATUS.md`

- [ ] **Step 1: Full green pre-flight**

Run: `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`
Expected: all green. Note the exact unit + E2E counts for STATUS.md.

- [ ] **Step 2: Bump version** — `package.json` `"version": "0.27.3"`.

- [ ] **Step 3: CHANGELOG** — new `## [0.27.3] — <date>` above `[0.27.2]`, `### Added` (annotate inside open Shadow DOM; honest hint where a shadow boundary can't be read; iframe remains top-frame-only). Fresh empty `[Unreleased]`. Add the `[0.27.3]` compare link and repoint `[Unreleased]`.

- [ ] **Step 4: README** — status line `v0.27.2` → `v0.27.3`; if the Annotations row warrants it, note open-shadow-DOM support.

- [ ] **Step 5: STATUS.md** — `Last updated`; branch state `v0.27.3`; releases list; test counts; a short `### v0.27.3` section.

- [ ] **Step 6: Commit, merge, tag, release**

```bash
git add package.json CHANGELOG.md README.md doc/STATUS.md
git commit -m "chore(release): v0.27.3 — annotate inside open Shadow DOM"
git checkout main && git merge --ff-only feat/a3-shadow-dom
git tag -a v0.27.3 -m "v0.27.3 — annotate inside open Shadow DOM"
git push origin main --follow-tags
gh release create v0.27.3 --title "v0.27.3 — annotate inside open Shadow DOM" --notes-file <(awk '/^## \[0.27.3\]/{f=1;next} /^## \[0.27.2\]/{f=0} f' CHANGELOG.md)
```

- [ ] **Step 7: Update memory** — `phase-branch-state.md` (v0.27.3; A3 open-shadow done; remaining A4/A5/A8) and `MEMORY.md` pointer.

---

## Self-Review

- **Spec coverage:** model field (T1), core anchoring + `webAnchorRoot` (T1), selection detection via composedPath + `ShadowRoot.getSelection()` (T2), commit/repaint threading (T2), graceful hint (T2), iframe limitation documented (spec + T4 notes), unit tests (T1), E2E (T3), release with docs (T4). All covered.
- **Placeholder scan:** none — every code/test step has concrete content.
- **Type consistency:** `createWebAnchor(root: ParentNode, range, shadowHost?)`, `resolveWebAnchor(root: ParentNode, anchor)`, `webAnchorRoot(doc: Document, anchor): ParentNode`, `SelectionTarget`, `pendingTarget`, `showUnsupportedHint(range | null)` — used consistently across T1/T2/T3.
- **Fallback honesty:** T3 Step 4 forbids weakening the assertion; it converts to `test.fixme` + manual coverage if shadow-selection simulation is infeasible, rather than a false green.
