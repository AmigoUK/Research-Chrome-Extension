# A4 — Quote length cap + honest coarse CSS fallback

_Design spec · 2026-07-27 · branch `feat/a4-quote-css` off `main` (v0.27.3)_

## Context

Web anchoring (`src/core/anchoring/web.ts`) has two rough edges the 2026-07-25 audit flagged:

1. **Uncapped quote.** `createWebAnchor` stores `textQuote.exact` (the full selected text) with no cap. A
   pathological selection — an entire long article — bloats every stored/exported anchor with tens of KB.
2. **Coarse CSS fallback lies.** When text-quote and text-position both fail (the text moved or changed),
   `resolveWebAnchor`'s CSS fallback does `range.selectNodeContents(el)` and paints the **whole element**
   (often a large block) exactly as confidently as a precise highlight. Silent, misleading degradation.

## Design

### 1. Quote length cap (`createWebAnchor`)

```ts
const MAX_QUOTE_EXACT = 10_000; // chars
```

When `textQuote.fromRange(...)` yields an `exact` longer than `MAX_QUOTE_EXACT`, **omit the `textQuote`
selector** — keep `textPosition` (two integer offsets: compact and precise) and `css`.

Rationale: truncating `exact` is wrong — text-quote resolves the truncated head to a shorter, wrong range,
and it is tried first, so it would win over the correct position match. Omitting lets `textPosition` carry
the anchor. The 10 000-char threshold is high enough that every realistic highlight (even a long paragraph,
~1–2 KB) keeps its quote and its fuzzy, move-tolerant re-anchoring; only pathological whole-document
selections drop it. `prefix`/`suffix` are already bounded by the library (~32 chars) — left as-is.

### 2. Honest coarse CSS fallback (`resolveWebAnchor` + annotator)

Change the return type so the caller can tell a precise match from a coarse one:

```ts
export function resolveWebAnchor(root: ParentNode, anchor: WebAnchor):
  { range: Range | null; approximate: boolean }
```

- text-quote or text-position matched → `{ range, approximate: false }`
- only the CSS fallback matched → `{ range, approximate: true }` (the range is still returned, for a
  possible future "jump to the rough location", but the caller must not treat it as precise)
- nothing matched → `{ range: null, approximate: false }`

Callers are only `src/content/annotator.ts` and `src/core/anchoring/web.test.ts` (verified by grep).

In the annotator's `resolveAndRepaintAll`, a note is painted **and** counted into `resolvedIds` only when
`range && !approximate`. An approximate (CSS-only) or null resolution is neither painted nor resolved — so
the side panel's **existing** resolved/lost split (`state.resolvedIds`, `src/sidepanel/main.ts:373-377`)
already lists it under "couldn't place on this page". No new overlay style, no new `annotator/resolved`
field, no side-panel change. The misleading whole-block highlight simply stops appearing, and the note is
honestly reported as unplaced.

`p.range` (cached for scroll/resize reposition) is set to the resolved range only when it is precise;
approximate matches leave `p.range = null` so nothing repaints for them.

## Testing

**Unit (`src/core/anchoring/web.test.ts`):**

- `createWebAnchor`: a selection whose `exact` exceeds `MAX_QUOTE_EXACT` omits the `textQuote` selector but
  still has `textPosition`; a normal-length selection keeps `textQuote`.
- `resolveWebAnchor`: a live quote match → `approximate: false` with a range; an anchor whose only usable
  selector is `css` (no quote/position, or both fail to resolve) → `approximate: true` with a range over the
  element; an anchor that resolves to nothing → `{ range: null, approximate: false }`.

**E2E:** none added — forcing quote *and* position to both fail on a live page is not deterministically
reproducible in the harness, and the new behaviour is a core-anchoring return-shape change plus a one-line
paint gate in glue. The `resolveWebAnchor` approximate flag is unit-tested; the existing web-annotation E2E
covers the precise happy path for regression.

**Regression:** full suite green (typecheck, lint, unit, build, E2E). Existing precise anchors behave
identically (they resolve via quote/position → `approximate: false`).

## Release

One patch release `v0.27.4` — `### Changed`/`### Fixed`. CHANGELOG + README + `doc/STATUS.md` ship with it.
