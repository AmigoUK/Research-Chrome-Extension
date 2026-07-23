# UI and UX Design

This document outlines the main user interfaces and interaction flows.

## UI Surfaces

- **Side Panel** (`chrome.sidePanel`) — the primary, persistent companion docked beside the page (design: `research-companion-panel.html`). Source of truth for design tokens and interaction states.
- **Sidebar / Overlay** on annotated pages and PDFs.
- **Inline toolbar** for selections (text, tables, charts).
- **Browser action popup** for quick project and citation actions.
- **Dashboard (options page)** for full project and library management.

Six surfaces are designed and act as the source of truth for the UI: launcher (`index.html`), side panel, dashboard (`research-dashboard.html`), PDF anchoring (`pdf-anchoring.html`), citation style editor (`citation-style-editor.html`), and collaboration & sync (`collaboration-sync.html`).

### Design system

All six surfaces share one visual language — a print-scholarly aesthetic with `oklch` color tokens, a single rationed accent (terracotta), a serif display face, and a monospace face reserved for metadata. Extract **one shared token sheet and component library** rather than re-deriving styles per surface.

**Fonts.** The design's faces (`Iowan Old Style` / `Charter` / `iA Writer Mono`) are only system-installed on macOS; on Windows and Linux they degrade to generic fallbacks. For cross-platform fidelity, **bundle web fonts locally** as extension assets — never from a CDN (MV3 CSP, the same rule as citeproc-js).

**Accessibility (acceptance criteria).** Preserve the semantics present in every prototype: proper roles/ARIA, full keyboard operation (including moving Kanban cards with `←`/`→`), visible focus states, and a `prefers-reduced-motion` guard.

**Responsive.** The 360–1920 px viewport matrix in `DESIGN-MANIFEST.json` applies to the **dashboard** and other full-page surfaces — not the side panel, which is a fixed ~388 px strip.

## Sidebar / Overlay

Functions:
- Display all annotations for the current page grouped by project and section.
- Allow filtering by tags, status, and author.
- Provide in-place editing of notes and workflow status.
- Show linked references and quick copy buttons for citations.

Behaviour:
- Appears when the user activates the extension on a page or automatically for pages already associated with a project.
- Highlights anchored portions of the page and scrolls to them when the user selects an annotation.

## Inline Toolbar

Functions:
- Appears when the user selects text or interacts with a supported element (e.g. table, figure).
- Offers actions: `Add note`, `Highlight`, `Link to project section`.

Anchoring:
- Uses the multi-strategy anchor model with fallback described in `data-model.md` (W3C Web Annotation), rather than a single selector.
- For web pages, resolves in order: text-quote → text-position → CSS selector.
- For PDFs, uses page + percent-coordinate rectangles (plus a text quote where available), which survive zoom and reload.

## Popup (Browser Action)

Functions:
- Shows current active project and allows switching projects.
- Shows summary of the current page: associated document, number of annotations, reference status.
- Provides copy buttons:
  - `Copy in-text citation`.
  - `Copy footnote citation`.
  - `Copy bibliographic entry`.

## Dashboard

Sections:
- **Projects**: list, creation, deletion, and configuration (sections, default styles, members).
- **Documents**: per project, with status, section, and quick navigation to source.
- **Annotations**: searchable/filterable list across the project.
- **References**: bibliographic records, import/export, source information.
- **Citation Styles**: style profiles, base style selection, rule editor.

Workflow Views:
- Kanban-style view per project: `To read`, `In review`, `Analysed`, `Used in output` for documents.
- Counters per status to track progress on literature review or investigation.
