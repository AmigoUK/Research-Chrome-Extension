# Development Roadmap

This document outlines the planned development phases for the Scientific Context Notes extension.

> **Delivery status.** All five phases below are **shipped** as of **v0.18.0** — Phase 1 → v0.1.1, Phase 2 → v0.7.0, Phase 3 → v0.12.0, Phase 4 → v0.14.0, Phase 5 → v0.18.0. Interactive design prototypes exist for every phase (side panel, `pdf-anchoring.html`, `citation-style-editor.html`, `collaboration-sync.html`) and the implementation ports those designs rather than inventing UI. See `STATUS.md` for what was delivered and what was deliberately left out.

## Phase 1: MVP

Goals:
- Implement core data model in IndexedDB (versioned schema with `onupgradeneeded` migrations).
- Establish the ports-and-adapters split so the domain core is unit-testable from day one (see `architecture.md` → Testability).
- Provide basic project creation and selection.
- Implement content script for text-based annotations on web pages.
- Extract minimal metadata (title, URL, DOI when present) to create `Document` and `Reference` records.
- Integrate a small set of pre-defined CSL styles (e.g. APA, Chicago, Harvard) for citation and bibliography generation.
- Provide popup actions to copy in-text citation and bibliographic entry for the current page.

Deliverables:
- Working extension usable for solo research projects with simple annotations and citations.

## Phase 2: Full Project Dashboard and Workflow

Goals:
- Build dashboard UI for managing projects, documents, annotations, and references.
- Implement workflow statuses for documents (`toRead`, `inReview`, `analysed`, `usedInOutput`).
- Add filtering, search, and Kanban-style views per project.
- Enhance metadata extraction (journal, publisher, identifiers) and allow manual editing.

Deliverables:
- Complete project management layer suitable for structured literature reviews and investigations.

## Phase 3: Advanced Anchoring and PDF Support

> **Effort note.** PDF support is a heavy, self-contained engineering epic — realistically larger than Phases 1 and 2 combined — even though its UI is already designed (`pdf-anchoring.html`). Chrome's native PDF viewer (PDFium) is closed and cannot be annotated by content-script injection, so PDFs are handled by a **bundled `pdf.js`-based viewer** that gives full control over the text layer and anchoring. (The launcher's "content script" label for this surface is a simplification: it is a bundled viewer, not injection into the native viewer.)

Goals:
- Extend content scripts to support anchoring on tables, figures, and interactive elements on web pages.
- Ship a bundled `pdf.js` viewer that anchors annotations to page + percent-coordinate rectangles plus metadata.
- Improve robustness of anchors across page reloads, zoom, and minor content changes.

Deliverables:
- Reliable contextual annotation on both web pages and PDFs.

## Phase 4: Citation Style Editor and Custom Rules

Goals:
- Implement CitationStyle profiles with base CSL style selection.
- Build a user-friendly rule editor for common citation behaviours (max authors, et al, DOI/URL inclusion, author-date vs footnote).
- Translate user rules into CSL overrides or controlled post-processing.

Deliverables:
- Flexible citation system that can adapt to institutional or journal-specific requirements without manual CSL editing.

## Phase 5: Collaboration and Sync (Optional / Pro)

Collaboration follows an **evolutionary path** rather than a single mechanism (design: `collaboration-sync.html`). Three sync modes are user-selectable:

1. **Local only** — data stays in this browser's IndexedDB; no sync.
2. **File-based** — a portable, encrypted JSON snapshot (projects, annotations, references, styles) shared through a drive or network share, with manual merge on conflict. Keeps the local-first, no-backend posture.
3. **Self-hosted backend** — real-time sync to the team's own server, enabling enforced roles and presence. **Out of scope for this repo** (see below): modes 1 and 2 shipped; the backend mode is shown in the UI as unavailable rather than pretended.

Goals:
- Introduce multi-user projects with **Owner / Editor / Viewer** roles and a capability matrix (read & export / annotate / edit status / manage references / manage members / delete project).
- Implement change tracking (activity feed with before→after diffs), anchored comment threads (reply/resolve), presence, and snapshot export/import.
- Deduplicate references by DOI as a hard rule on merge.

> **Invariant.** Role enforcement is only real in **backend** mode. In file-based and local modes each client holds a full copy of the data, so roles are advisory, not enforced — this must be stated plainly so the trade-off against the privacy-first, local-first posture is explicit.

Deliverables:
- Team-ready extension for collaborative research and investigations.

**Delivered (v0.15.0 – v0.18.0):** roles & capability matrix (advisory, and said so), an activity feed recorded in the message router with before→after diffs, anchored comment threads with reply / resolve, and portable snapshots — plain or AES-GCM encrypted — that merge back with hard DOI dedup. Presence is the one goal not delivered: it needs a live channel between clients, which a file-based mode cannot provide.
