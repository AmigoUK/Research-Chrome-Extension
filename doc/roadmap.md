# Development Roadmap

This document outlines the planned development phases for the Scientific Context Notes extension.

> **Design status.** Interactive design prototypes exist for every phase — side panel (Phase 1–2), `pdf-anchoring.html` (Phase 3), `citation-style-editor.html` (Phase 4), and `collaboration-sync.html` (Phase 5), all sharing one design system. Implementation ports these existing designs rather than designing UI from scratch. No production code has shipped yet, so the phases below are **planned / prototyped**, not released.

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
3. **Self-hosted backend** — real-time sync to the team's own server, enabling enforced roles and presence.

Goals:
- Introduce multi-user projects with **Owner / Editor / Viewer** roles and a capability matrix (read & export / annotate / edit status / manage references / manage members / delete project).
- Implement change tracking (activity feed with before→after diffs), anchored comment threads (reply/resolve), presence, and snapshot export/import.
- Deduplicate references by DOI as a hard rule on merge.

> **Invariant.** Role enforcement is only real in **backend** mode. In file-based and local modes each client holds a full copy of the data, so roles are advisory, not enforced — this must be stated plainly so the trade-off against the privacy-first, local-first posture is explicit.

Deliverables:
- Team-ready extension for collaborative research and investigations.
