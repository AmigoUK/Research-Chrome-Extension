# Architecture Overview

This document describes the high-level architecture of the Scientific Context Notes extension built on Chrome Manifest V3.

## Component Overview

- **Service Worker (Background)**: Handles storage, citation generation, and communication between UI and content scripts.
- **Content Scripts**: Injected into web pages to provide annotation UI, anchoring, and metadata extraction. PDF annotation is handled by a bundled `pdf.js`-based viewer rather than injection into the closed native viewer (see `roadmap.md`, Phase 3).
- **Side Panel (primary workflow surface)**: A persistent `chrome.sidePanel` companion docked beside the page being read — the day-to-day surface for filing sources, moving them through the workflow, and copying citations. This is the main working surface (see the `research-companion-panel.html` prototype).
- **Popup UI**: Lightweight quick-action surface (project switch, per-page status, one-click citation copy) for interactions that do not warrant opening the side panel.
- **Options / Dashboard Page**: Full project management UI, including documents, annotations, references, citation styles, and workflow status.

## Runtime Model (Manifest V3)

- Uses `manifest_version: 3`.
- Background logic is implemented as a service worker that wakes on events (messages, actions, alarms). The service worker is **ephemeral** — Chrome terminates it after roughly 30 seconds of inactivity — so every event handler must assume a cold start and hold no critical state in memory between events.
- Content scripts are injected via the `scripting` API into active tabs with matching host permissions.
- Persistent data is stored in **IndexedDB** accessed from the service worker (a thin wrapper such as `idb` is recommended). SQLite/WASM is deliberately **not** used: it cannot persist reliably from an ephemeral service worker and would risk data loss. The schema is **versioned**, with migrations run in `onupgradeneeded`, so the stored shape can evolve without losing user data.

## Permissions and Host Access

- Minimal permissions: `storage`, `scripting`, `activeTab`, `sidePanel`.
- Host access follows **least privilege** but is not always per-origin: `activeTab` covers the current page, and `optional_host_permissions` (`*://*/*`) is requested at runtime, never at install time. Two distinct grants share that one declared pattern — annotating a site requests it for that origin alone, and the annotator then auto-loads only there on later visits; separately, the side panel's "Allow reading pages" button requests the full pattern as one standing grant, because `activeTab` is revoked on navigation and cannot by itself let the panel preview or annotate whatever tab the user switches to next. Holding that standing grant means the annotator auto-loads on any active tab, not just sites individually opted into — the trade the broad pattern exists for.
- External API calls (e.g. CrossRef, CSL style repository, Zotero style downloads) are made from the service worker. These fetch **data only**; MV3's CSP forbids loading or executing remote code, so engines such as citeproc-js are bundled locally (see `citations.md`).

## Data Flow

1. User opens a page.
2. Content script detects relevant metadata and sends a message to the service worker.
3. Service worker creates/updates `Document` and `Reference` records for the active project.
4. When the user creates an annotation, the content script computes an anchor and sends the annotation payload to the service worker.
5. Citation requests from popup/dashboard are routed to the service worker, which uses CSL to format citations/bibliographies from stored `Reference` data.
6. A draft export request (`draft/compose`) is routed the same way, but resolves every citation in
   the draft in **one** citeproc pass over the whole document rather than one call per source — see
   below.

## Draft composition (`draft/compose`)

Turning a project's annotated highlights into an exportable essay draft is deliberately **not**
assembled in a surface from the existing per-source citation messages
(`citations/document`/`citations/bibliography`). A citation is a property of the *document being
cited from*, not of the source alone: citeproc disambiguates a repeated surname (`2016a`/`2016b`)
**retroactively**, so a single call only sees the clusters before it, and a numeric style (Vancouver)
numbers its reference list by the order sources are *first cited* in the draft, not the order they
were fetched from storage. Composing citation-by-citation in a UI layer produces output that is
wrong in both ways, silently.

Instead:

- `src/core/usecases/draft.ts` exports `composeDraft(repos, formatter, args)` — pure domain code,
  no `chrome.*`/DOM/IndexedDB types. It resolves the project's outline (`resolveOutline`), buckets
  the project's annotations into sections (falling back to grouping by highlight colour when
  nothing has been assigned yet — `groupPassages`, shared with the Outline view so the screen and
  the export can never disagree on ordering), fixes the resulting citation order once, and calls a
  single new citation-port method, `CitationFormatter.formatRun`, to resolve every in-text citation
  and the bibliography in one citeproc engine state. The result is a `Draft` **structure** — quotes,
  notes and citations kept as separate typed fields — not a pre-rendered string.
- `src/core/draft/outline.ts` holds `resolveOutline`/`defaultOutline` — the single answer to "what
  are this project's sections", used by `composeDraft`, the Outline view and the side-panel section
  picker alike.
- `src/core/draft/serialise.ts` renders the `Draft` structure two ways: `draftToHtml` (the
  clipboard's `text/html` flavour — citeproc's own `<i>…</i>` markup passes through unescaped, while
  every other field is escaped) and `draftToMarkdown` (the `.md` download and the clipboard's
  `text/plain` fallback). Both throw rather than accept a `Draft` composed for the other flavour —
  a `'text'`-flavour citeproc run performs no escaping, so feeding it to `draftToHtml` would be an
  injection hole.
- The message itself — `draft/compose { projectId; template; flavour: 'text' | 'html'; styleId? } ->
  Draft` — is routed by the same pure `handleRequest` as every other message (`src/core/router.ts`);
  the dashboard calls it once per export action (`html` for the clipboard, `text` for the `.md`
  file), never caching or reusing one flavour's citeproc output as the other's.

## Testability

MV3 extensions are hard to test after the fact, so testability is a first-class constraint from Phase 1:

- The **domain core** (data model, CSL formatting, anchor computation) is written as pure modules with no dependency on `chrome.*` APIs — a ports-and-adapters split. These are covered by unit tests in Node/Vitest.
- A thin **adapter layer** wraps `chrome.*` (storage, messaging, side panel, scripting) and is mocked in unit tests.
- End-to-end happy-path flows are covered with Playwright driving the loaded extension. The `data-od-id` attributes present throughout the design prototypes are used as stable test selectors.
