# A3 — Web annotation inside open Shadow DOM (+ graceful fallback)

_Design spec · 2026-07-26 · branch off `main` (v0.27.2)_

## Context

The web annotator (shipped v0.27.0) anchors selections against `document.body` only. Two DOM
structures defeat that, and today the symptom is identical and silent: **the selection toolbar simply
never appears**, so the tool looks broken.

- **Open Shadow DOM.** `window.getSelection()` in Chrome does not descend into a component's shadow
  tree, and `textQuote.fromRange(document.body, …)` cannot see text that lives inside one.
- **Iframes.** The annotator is injected top-frame only; a selection inside an iframe fires its
  mouseup in the iframe's own document, which never reaches us. Cross-origin frames are inaccessible
  by definition.

This spec adds real annotation support **where it is technically possible — open shadow roots — and
makes the impossible cases honest** with a brief "can't annotate here" hint.

### Explicitly out of scope (technically impossible or a separate feature)

- **Cross-origin iframes** — no DOM access, ever.
- **Closed shadow roots** — not reachable from a content script.
- **Same-origin iframes** — would need `all_frames` injection, a per-frame annotator instance keyed
  by the frame URL, and side-panel coordination. That is its own feature, deliberately deferred.

Because an iframe selection never reaches the top-frame mouseup, the graceful hint cannot be shown
inside a frame. In practice the hint covers a selection gesture that crosses into a shadow boundary we
cannot resolve (e.g. a closed root). An iframe selection continues to show no toolbar — honest, if
wordless.

## Design

### 1. Anchor model (core)

Extend `WebAnchor` (`src/core/model/types.ts`) with one optional field:

```ts
export interface WebAnchor {
  kind: 'web';
  selectors: Array<TextQuoteSelector | TextPositionSelector | CssSelector>;
  /** CSS path (in the light DOM) to the open shadow HOST whose shadowRoot is the
   *  anchoring root. Absent → the anchor is relative to document.body. */
  shadowHost?: string;
}
```

Append-only and backward compatible: existing stored anchors lack the field and resolve against
`document.body` exactly as before. No IDB schema bump — the anchor is stored as an opaque object
inside the annotation record, and `src/core/snapshot/validate.ts` does not inspect anchor internals
(verified: it only validates a thread's `anchorLabel`, never the annotation anchor's shape), so an
imported snapshot carrying `shadowHost` passes through untouched.

### 2. Core anchoring (`src/core/anchoring/web.ts`)

- `createWebAnchor(root: ParentNode, range: Range, shadowHost?: string): WebAnchor` — gains the
  optional `shadowHost`, which it copies onto the returned anchor. `cssPath`, `textQuote.fromRange`
  and `textPosition.fromRange` already accept any root Node, so a `ShadowRoot` works as `root`
  unchanged. (Signature widened from `Element` to `ParentNode` to admit a `ShadowRoot`.)
- New pure helper `webAnchorRoot(scope: ParentNode, anchor: WebAnchor): ParentNode` — returns
  `anchor.shadowHost ? (scope.querySelector(anchor.shadowHost)?.shadowRoot ?? scope) : scope`. This is
  the single place that turns a stored `shadowHost` back into a live root.
- `resolveWebAnchor(root, anchor)` — signature and body unchanged; the caller now passes the root that
  `webAnchorRoot` computed. Its `css` fallback already uses `root.querySelector`, which a `ShadowRoot`
  supports.

All three are DOM-dependent but storage/chrome-free and **unit-tested under jsdom** (jsdom supports
`attachShadow({ mode: 'open' })`, ranges within a shadow tree, and TreeWalker over a DocumentFragment).

### 3. Selection detection + wiring (`src/content/annotator.ts`)

A new helper resolves the mouseup into an anchoring target (takes the event, for `composedPath()`):

```
resolveSelectionForMouseUp(e): { range: Range; root: ParentNode; shadowHost?: string } | 'unsupported' | null
```

- **Light DOM** — `window.getSelection()` non-collapsed with trimmed text → `{ range, root: document.body }`.
- **Open shadow DOM** — from `e.composedPath()[0]`, take `getRootNode()`; if it is a `ShadowRoot`
  (open → accessible), call `shadowRoot.getSelection()`; if non-collapsed →
  `{ range, root: shadowRoot, shadowHost: cssPath(document.body, shadowRoot.host) }`.
- **Unresolvable shadow boundary** (a closed root / a gesture that crossed a boundary we cannot read,
  i.e. the composed path shows a shadow host but no accessible range) → `'unsupported'`.
- **Collapsed / empty, no shadow** → `null` (hide the toolbar, today's behaviour).

Wiring changes:

- `onMouseUp` calls the helper. `null` → `hideToolbar()`. `'unsupported'` → show the hint. Otherwise
  `showToolbar(range)` and remember `root` + `shadowHost` for the pending commit.
- `commit(range, withNote, root, shadowHost)` → `createWebAnchor(root, range, shadowHost)`.
- `resolveAndRepaintAll()` computes the root per note: `resolveWebAnchor(webAnchorRoot(document, p.anchor), p.anchor)`.
- **Graceful hint** — a small, non-interactive label rendered in the existing `toolbar-layer`
  ("Can't annotate inside this component"), auto-removed after ~3s. Positioned like the toolbar
  (viewport coords from the light-DOM host element if available, else near the pointer).

This layer (composedPath / getSelection / hint DOM) is content-script glue, not unit-mountable — it
is covered by E2E + manual, consistent with how A1/A2 glue is covered.

## Testing

**Unit (TDD, `src/core/anchoring/web.test.ts`):**

1. `createWebAnchor(shadowRoot, range, hostPath)` → anchor carries `shadowHost === hostPath`; its
   `textQuote.exact` is the shadow-tree text.
2. Round-trip: create inside an open shadow root → `webAnchorRoot(document, anchor)` returns that
   shadowRoot → `resolveWebAnchor` re-derives a Range over the same text.
3. `webAnchorRoot`: no `shadowHost` → `document.body`; a `shadowHost` that resolves → the host's
   `shadowRoot`; a `shadowHost` that no longer resolves → falls back to `scope`.

**E2E (`e2e/webannotation.spec.ts`, a new fixture defining an open-shadow-root component):**

- Select text inside the shadow component → toolbar visible → Highlight → `.ov` overlay covers the
  selection rect (<2px) → reload → the overlay repaints from the stored `shadowHost` anchor.

**Regression:** full suite green (typecheck, lint, unit, build, E2E). Confirm existing light-DOM
anchors (no `shadowHost`) are unaffected.

## Release

One patch release (`v0.27.x`) — `### Fixed` (annotate inside open Shadow DOM; honest hint elsewhere).
CHANGELOG + README + `doc/STATUS.md` ship with it, per the project's release rule.
