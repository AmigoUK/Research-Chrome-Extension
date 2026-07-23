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

- Minimal permissions: `storage`, `scripting`, `activeTab`, `sidePanel`, optional `tabs`.
- Host access follows **least privilege**: `activeTab` for the current page, plus `optional_host_permissions` requested per domain on an opt-in basis. A default `*://*/*` grant is **not** used — it conflicts with the project's privacy-first posture and is a red flag in Chrome Web Store review.
- External API calls (e.g. CrossRef, CSL style repository, Zotero style downloads) are made from the service worker. These fetch **data only**; MV3's CSP forbids loading or executing remote code, so engines such as citeproc-js are bundled locally (see `citations.md`).

## Data Flow

1. User opens a page.
2. Content script detects relevant metadata and sends a message to the service worker.
3. Service worker creates/updates `Document` and `Reference` records for the active project.
4. When the user creates an annotation, the content script computes an anchor and sends the annotation payload to the service worker.
5. Citation requests from popup/dashboard are routed to the service worker, which uses CSL to format citations/bibliographies from stored `Reference` data.

## Testability

MV3 extensions are hard to test after the fact, so testability is a first-class constraint from Phase 1:

- The **domain core** (data model, CSL formatting, anchor computation) is written as pure modules with no dependency on `chrome.*` APIs — a ports-and-adapters split. These are covered by unit tests in Node/Vitest.
- A thin **adapter layer** wraps `chrome.*` (storage, messaging, side panel, scripting) and is mocked in unit tests.
- End-to-end happy-path flows are covered with Playwright driving the loaded extension. The `data-od-id` attributes present throughout the design prototypes are used as stable test selectors.
