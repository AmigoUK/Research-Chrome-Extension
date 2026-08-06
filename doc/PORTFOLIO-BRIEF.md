# Brief — project page for attv.uk

For the coding agent building the portfolio entry. Everything below is verified against the
repository at **v1.8.0**; nothing here is aspirational. If you need a fact that is not in this
brief, read the repo rather than inventing one — a portfolio page that overstates is worse than one
that says less.

Repository: <https://github.com/AmigoUK/Research-Chrome-Extension>
Live pages: <https://amigouk.github.io/Research-Chrome-Extension/> · privacy policy at `/privacy.html`

---

## What to build

One project page on attv.uk. **Match the site's existing design system** — typography, spacing,
colour, header and footer, breakpoints, dark mode if it has one. Do not introduce a new visual
language for this page; a portfolio reads as one body of work or it reads as a scrapbook.

No framework requirement. Whatever the rest of attv.uk uses, use that.

## Who the page is for

Two readers, in this order:

1. **A prospective client or employer** skimming for evidence of judgement. They will read the
   first screen and one or two headings. They are not going to install a Chrome extension.
2. **An engineer** who scrolls, and who is looking for whether the hard parts were actually hard
   and actually solved.

Write for the first, and reward the second. A feature list serves neither.

## The one-sentence positioning

> A local-first research companion for Chrome: it files sources, keeps every note attached to the
> exact passage it came from, and turns a pile of highlights into a cited draft.

## The story worth telling

A portfolio page is not a README. The material below is what makes this project worth a page at
all — lead with the problem and the reasoning, and let the features fall out of that.

### 1. The gap it closes

The tool collected well and delivered nothing. A research session ended with notes in a dashboard,
while the deliverable was an essay in a word processor. The bridge was a copy button, one citation
at a time.

Version 1.8.0 closes it: a student gives each highlight a place in their argument, arranges the
sections, and exports the whole draft — to the clipboard for Word, or as a Markdown file.

### 2. The finding that shaped the architecture

**A citation is a property of the document, not of the source.** "How do I cite Nowak" has no
answer without "what else is in this essay".

Three consequences, each established by probing the real citation engine rather than by reasoning
about it:

- Formatting one source at a time renders one citation cluster, so under a numbered style
  (Vancouver) **every source comes out as `(1)`**.
- The engine disambiguates **retroactively**: format a citation without the ones that follow it and
  the first "(Nowak 2016)" never becomes "(2016a)" even though a later one does — the same source
  cited two ways in one document.
- A reference list must receive its entries in **first-citation order**, or a numbered style's list
  disagrees with the numbers in the text.

So the export resolves every citation of a draft in a single engine pass, and the reference list
holds only what was actually cited. This is the strongest technical material on the page. It is
also legible to a non-engineer, which is rare — anyone who has written an essay understands why
"the same source cited two ways" is wrong.

### 3. Local-first, and what that costs

Everything lives in the browser's IndexedDB. No backend, no account, no telemetry, no remote code —
Chrome's Manifest V3 forbids loading code at runtime, so the citation engine, the PDF reader and the
fonts all ship inside the extension.

Say the cost honestly, because saying it is the point: collaboration travels as an encrypted file
rather than through a server, and roles are therefore **advisory** — every collaborator holds a full
copy, so nothing can enforce a role. The product says so in plain words rather than pretending
otherwise.

### 4. Permissions, treated as a design problem

Reading page text is what lets a highlight re-find its sentence a month later. The extension holds
**no standing access to any site**: broad host access is declared as *optional*, requested one
origin at a time, at the user's initiative, and revocable from Chrome's own settings.

Worth a sentence because most extensions in this category ask for everything at install.

### 5. A measured fix, if you want a concrete engineering vignette

Typing a note made the panel jump and drop keystrokes. Measured cause: one autosave produced
**13 DOM rebuilds**, replacing the textarea under the reader's hands. After the fix, measured on the
same page: **0 rebuilds, 0 characters lost**. Numbers a reader can hold.

## Verified facts you may state

- Chrome extension, **Manifest V3**, minimum Chrome 116.
- **TypeScript**, strict — including `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`.
- Ports-and-adapters: a pure domain core with **no** `chrome.*`, IndexedDB or DOM dependencies,
  reached through typed messages.
- **471 unit tests, 56 end-to-end tests** (Vitest; Playwright driving a real headed Chromium with
  the extension loaded). CI runs typecheck → lint → format check → unit → build, plus a separate
  E2E job.
- Real **CSL** citations via citeproc-js: APA, Harvard (Cite Them Right **and** Solent University),
  Vancouver, MLA, Chicago author–date and Chicago notes.
- A rule-driven **citation-style editor** that compiles plain rules into CSL overrides, with a live
  preview through the real engine.
- A bundled **pdf.js** reader with text highlights and drag-a-rectangle region anchors, stored as
  fractions of the page box so they survive zoom, reload and a different screen.
- Web-page anchoring by **W3C selectors** — quote, then position, then CSS — so a highlight
  re-anchors after a reload and after the page changes underneath it.
- Portable project snapshots, optionally encrypted with **AES-GCM**; an import previews exactly what
  it would change before writing anything.
- Licensing: the extension's own code is **MIT**; it bundles citeproc-js (CPAL-1.0), pdf.js
  (Apache-2.0) and CSL styles (CC BY-SA 3.0). See `THIRD-PARTY-NOTICES.md`.

## Do not claim

- **Do not** say it is on the Chrome Web Store until it actually is. At the time of writing it is
  submitted, not published. If the page needs a call to action before then, link the GitHub release.
- **Do not** describe it as multi-user, synced, or cloud-backed. There is no server.
- **Do not** invent adoption numbers, users, or testimonials.
- **Do not** call the roles a permission system. They are advisory and the product says so.
- **Do not** imply it works outside Chrome/Chromium.

## Assets in the repository

| What | Where | Notes |
| --- | --- | --- |
| Screenshots, high-resolution | `doc/screenshots/` | 14 images, 1360×940 and 400×820. Captions in `doc/screenshots/README.md` |
| Store screenshots | `doc/store/` | 5 images at exactly 1280×800, plus promo tiles at 440×280 and 1400×560 |
| Icon | `src/assets/icons/icon-128.png` | Also 16/32/48 |
| Long-form copy | `doc/STORE-LISTING.md` | The store description is already written and true — a good source to compress from |
| Feature detail | `README.md` | The "What it does" table |
| Architecture | `doc/architecture.md`, `doc/data-model.md` | If you want to draw a diagram, draw it from these |

**Note:** none of the current screenshots shows the Outline screen or the draft export, which is
v1.8.0's headline. If the page leads on that feature — it should — either capture a fresh screenshot
(`npm run build && npm run store:assets` regenerates the store set) or lead with a screen that exists.
Do not caption an older screenshot as if it showed Outline.

## Suggested structure

Adapt freely; this is a starting order, not a specification.

1. **Hero** — the one-sentence positioning, one strong screenshot, and two links: GitHub, and the
   store listing once it is live.
2. **The problem**, in three or four sentences — collected notes that never became a draft.
3. **What it does**, four or five items maximum, each one line. Resist the full feature list; the
   README is one click away.
4. **The interesting part** — the citation finding from section 2 above. This is the section an
   engineer reads and a client remembers.
5. **Local-first**, and what it costs. Honesty is the differentiator here.
6. **Built with** — the verified facts list, compressed.
7. **Links** — repository, release, privacy policy, licence notices.

## Tone

Plain, specific, and unembarrassed about constraints. The project's own documentation states its
limitations in the product itself; a page that oversells it would be off-key with the thing it is
describing.

Avoid: "revolutionary", "seamless", "powerful", "cutting-edge". Prefer a number or a concrete noun
every time one is available.

## Accessibility and performance

Not optional for a page whose subject is a research tool used by students:

- Real heading hierarchy, one `<h1>`.
- Every screenshot needs alt text that describes **what the screen shows**, not "screenshot of the
  dashboard". `doc/screenshots/README.md` has usable descriptions already.
- Contrast to WCAG AA in both light and dark, if the site has both.
- Images sized and lazily loaded below the fold; the screenshots are large.
- Keyboard-reachable links with a visible focus style.
