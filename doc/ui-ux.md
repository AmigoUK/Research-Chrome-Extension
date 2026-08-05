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
- **Outline**: where a highlight becomes part of a written argument — see below.
- **References**: bibliographic records, import/export, source information.
- **Citation Styles**: style profiles, base style selection, rule editor.

Workflow Views:
- Kanban-style view per project: `To read`, `In review`, `Analysed`, `Used in output` for documents.
- Counters per status to track progress on literature review or investigation.

### Outline (v1.8.0)

Sits in the nav directly after Annotations, which it feeds on — Overview · Documents · Annotations
· **Outline** · References · Citation styles · Team · Settings. Its badge is deliberately not a
total like every other nav count: it shows the number of **unplaced** passages, so it reads as work
outstanding and disappears once the outline is complete.

The screen itself:
- A read-only strip at the top for the project's **research question** and **due date** (`Edit`
  hands off to Settings, the one place that writes them — one source of truth).
- An **Unplaced** bucket, shown first when non-empty, listing every highlight with no section yet
  and a picker to assign one on the spot.
- The project's sections, each showing its passage count, `Rename`/`Delete`/reorder controls, and —
  this is deliberate — an explicit **"empty section"** flag at zero: an undergraduate essay missing
  a counter-arguments section is a common way to lose marks, and this is the one screen positioned
  to say so.
- **Copy draft** (rich `text/html` + `text/plain` to the clipboard, degrading honestly to plain
  text with a toast if the browser refuses the rich write) and **Download .md**.
- If nothing has been assigned to a section anywhere in the project yet, the **export** falls back
  to grouping by **highlight colour** instead, with a visible notice on this screen that says so.
  The **screen itself does not** switch to colour buckets: it keeps showing the real outline
  sections (empty) with everything sitting in Unplaced. Reading `unplaced` here instead of
  `unsectioned` would make a coloured-but-unsectioned passage vanish from the page the moment
  colour grouping kicks in — a bug this feature already had and fixed.

A highlight is assigned to a section from two places that both write the same `Annotation.section`
field: this Outline screen (any row's picker), and a matching control on the **side panel**'s note
card, so a student can place a passage the moment they read it rather than only in a later bulk
pass.
