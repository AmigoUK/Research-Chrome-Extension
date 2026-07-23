# Architecture Overview

This document describes the high-level architecture of the Scientific Context Notes extension built on Chrome Manifest V3.

## Component Overview

- **Service Worker (Background)**: Handles storage, citation generation, and communication between UI and content scripts.
- **Content Scripts**: Injected into web pages and PDF viewers to provide annotation UI, anchoring, and metadata extraction.
- **Popup UI**: Quick access to project selection, citation copy actions, and per-page status.
- **Options / Dashboard Page**: Full project management UI, including documents, annotations, references, citation styles, and workflow status.

## Runtime Model (Manifest V3)

- Uses `manifest_version: 3`.
- Background logic is implemented as a service worker that wakes on events (messages, actions, alarms).
- Content scripts are injected via the `scripting` API into active tabs with matching host permissions.
- Persistent data is stored in IndexedDB (or a SQLite layer) accessed from the service worker.

## Permissions and Host Access

- Minimal permissions: `storage`, `scripting`, `activeTab`, optional `tabs`.
- Host permissions are restricted to the domains where annotation and metadata extraction are needed (or `*://*/*` for global behaviour if acceptable).
- External API calls (e.g. CrossRef, CSL style repository, Zotero style downloads) are made from the service worker.

## Data Flow

1. User opens a page.
2. Content script detects relevant metadata and sends a message to the service worker.
3. Service worker creates/updates `Document` and `Reference` records for the active project.
4. When the user creates an annotation, the content script computes an anchor and sends the annotation payload to the service worker.
5. Citation requests from popup/dashboard are routed to the service worker, which uses CSL to format citations/bibliographies from stored `Reference` data.
