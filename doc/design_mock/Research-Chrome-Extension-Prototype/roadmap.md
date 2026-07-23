# Development Roadmap

This document outlines the planned development phases for the Scientific Context Notes extension.

## Phase 1: MVP

Goals:
- Implement core data model in IndexedDB.
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

Goals:
- Extend content scripts to support anchoring on tables, figures, and interactive elements.
- Integrate with PDF viewers to anchor annotations to page+coordinate and metadata.
- Improve robustness of anchors across page reloads and minor content changes.

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

Goals:
- Introduce multi-user projects with roles and permissions.
- Implement change tracking and commenting on annotations.
- Add export/import and optional sync mechanisms (file-based or via self-hosted backend).

Deliverables:
- Team-ready extension for collaborative research and investigations.
