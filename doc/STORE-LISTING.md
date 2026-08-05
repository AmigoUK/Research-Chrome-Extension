# Chrome Web Store listing — copy to paste

Everything the Developer Dashboard asks for, written out, so submitting is transcription rather than
composition. Field names match the dashboard's own. Packaging and upload steps are in
[`DISTRIBUTION.md`](DISTRIBUTION.md); the images are in [`store/`](store/).

Keep this file in step with what is actually published: a listing that disagrees with the repo is
how a re-review starts.

---

## Store listing

**Item name** (75 max)

```
Scientific Context Notes
```

**Short description / summary** (132 max — the dashboard pre-fills this from the manifest, which is
generated from `package.json`; change it there, not here)

```
File web pages and PDFs into research projects, anchor notes to the passage, and export a cited draft — real CSL, all locally.
```

**Category:** Productivity → Workflow & Planning
**Language:** English (United Kingdom)

**Detailed description** (16,000 max)

```
Scientific Context Notes is a research companion for people who read for a living — and who are tired of a note that no longer says where it came from.

File the page you are reading into a project, and it arrives with its title, authors, year, journal and DOI already filled in, deduplicated against what you have. Select a passage and take a note, and the note stays attached to that passage: web pages are anchored with W3C selectors (quote, then position, then CSS), PDFs by page and coordinate rectangle. Reload the page, come back a month later, and the highlight is still on the sentence you meant.

Then take it all the way to a written draft. Give each highlight a place in your argument — a section of the essay — and export the whole thing: section headings, each quote followed by its citation, and a reference list holding only what you actually cited, ready to paste into Word.

WHAT YOU GET

• Capture — file any page or PDF into a project, with metadata extracted for you and duplicates caught by DOI.
• Web annotation — select text on a live page, choose Highlight or Note, and see it painted back on your next visit. Access is opt-in per site: nothing is injected anywhere until you choose to annotate a site, and after you opt in, the annotator loads only on that site (revocable any time in the extension's Site access settings).
• A bundled PDF reader — text highlights and drag-a-rectangle region anchors, stored as fractions of the page box so they survive zoom, reload and a different screen.
• Outline and draft export — assign each highlight to a section, from the side panel while you read or in bulk on the Outline screen, then Copy draft (formatted for Word or Google Docs) or Download .md. Every citation is resolved against the whole draft in one pass, so a numbered style counts sources in the order they are actually cited and the reference list holds only what you cited — not everything you ever read.
• Real citations — citeproc-js with APA, Harvard, Vancouver, MLA and Chicago (author–date and notes). Copy an in-text citation or a bibliography entry wherever you are working.
• A citation-style editor — turn plain rules (maximum authors, et al. thresholds, DOI and URL inclusion, page labels, FOI and legal templates) into CSL overrides, with a live preview that formats through the real engine. Import a journal's own .csl as a base style, or export the compiled one.
• A project dashboard — an overview with a Kanban board by review status, plus Documents, References, Annotations, Outline and Citation styles.
• Team — members and roles with a capability matrix, an activity feed with before-and-after diffs, and comment threads anchored to a specific note.
• Portable snapshots — export a whole project as one JSON file, optionally encrypted with AES-GCM, and merge it back on another machine. An import shows exactly what it would change before it writes anything.

LOCAL-FIRST, AND MEANT

Everything lives in this browser's IndexedDB. There is no backend, no account, no telemetry and no remote code — the citation styles, the PDF engine and the fonts all ship inside the extension. Nothing you read, file or write is transmitted anywhere.

Two features touch the network, and only when you ask: importing a DOI contacts doi.org for that DOI's metadata, and "open PDF by URL" fetches the PDF you named.

Because there is no server, collaboration travels as a file rather than through an account, and roles are advisory: every collaborator holds a full copy of the project, so nothing can enforce a role — and the Team view says so in plain words rather than pretending otherwise.

Open source: https://github.com/AmigoUK/Research-Chrome-Extension — the extension's own code is MIT; it bundles citeproc-js (CPAL-1.0), pdf.js (Apache-2.0) and CSL styles (CC BY-SA 3.0), see THIRD-PARTY-NOTICES.md.
```

**Homepage URL:** `https://amigouk.github.io/Research-Chrome-Extension/`
**Support URL:** `https://github.com/AmigoUK/Research-Chrome-Extension/issues`

### Graphic assets

| Field | File |
|---|---|
| Store icon (128×128) | built from `src/assets/icons/icon-128.png`, already in the package |
| Screenshot 1 | `doc/store/screenshot-1-overview.png` |
| Screenshot 2 | `doc/store/screenshot-2-annotations.png` |
| Screenshot 3 | `doc/store/screenshot-3-citation-styles.png` |
| Screenshot 4 | `doc/store/screenshot-4-pdf-reader.png` |
| Screenshot 5 | `doc/store/screenshot-5-side-panel.png` |
| Small promo tile (440×280) | `doc/store/promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `doc/store/promo-marquee-1400x560.png` |

---

## Privacy tab

**Single purpose** (one purpose, stated narrowly — a broad answer is the most common rejection)

```
Organise research sources and anchor notes and citations to the exact passage they came from, entirely within the user's browser.
```

**Permission justifications** — the dashboard asks separately for each one the manifest declares.

`storage`

```
Stores the user's projects, filed documents, annotations, references and citation styles in this browser's local IndexedDB. This is the extension's entire data layer; there is no server. Nothing stored is transmitted.
```

`activeTab`

```
Reads the metadata and selected text of the tab the user is actively looking at, at the moment they click "file this page" or take a note. It is used only in response to that explicit action, and it is what lets a note record the passage it came from.
```

`scripting`

```
Injects the annotation overlay into the page the user has chosen to annotate, so highlights can be drawn on the passage and re-anchored on a later visit. Injection happens on demand, on that page, after the user opts in for that site.
```

`sidePanel`

```
The side panel is the extension's primary interface: capture, the reading list and the notes already anchored on the current page. Without it the extension has no workspace.
```

`optional_host_permissions: *://*/*`

```
Requested per site and only when the user chooses to annotate on that site — never at install time, and never for sites they have not opted into. It grants the ability to read that page's text so a highlight can be anchored to the exact passage and found again on a later visit. Page content is processed locally and stored in this browser only; it is never transmitted. The pattern is broad because researchers read on arbitrary journal, repository and news domains that cannot be enumerated in advance, but the grant is always one origin at a time, at the user's initiative.
```

**Remote code use:** *No, I am not using remote code.*

```
All code and assets — the citation engine, CSL styles, the pdf.js reader and its worker, and the fonts — are bundled in the package. Nothing is fetched or evaluated from a remote source.
```

### Data usage

Nothing leaves the device, so every category is answered **no**:

| Category | Collected? |
|---|---|
| Personally identifiable information | No |
| Health information | No |
| Financial and payment information | No |
| Authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

Website content is the one worth pausing on: the extension **reads** page text to anchor a
highlight, and stores that quote in local IndexedDB. The dashboard's question is about *collection*
— transmitting data off the user's machine — and this extension transmits nothing. If a reviewer
asks, the note below is the answer.

**All three certifications apply:**

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**

```
https://amigouk.github.io/Research-Chrome-Extension/privacy.html
```

---

## Note for the reviewer

Paste into the review-notes box; it answers what a reviewer of an extension with an all-URLs
optional permission usually asks next.

```
Manifest V3, no remote code: every asset (CSL styles, the pdf.js reader and worker, the citeproc engine, fonts) is bundled in the package. Nothing is fetched or evaluated from a CDN.

No backend, no accounts, no telemetry. All user data is stored in this browser's IndexedDB. Page text read for anchoring a highlight is stored locally with the annotation and is never transmitted.

Host access is optional and per-origin. The extension holds no host permission at install time. The first time the user annotates on a given site, chrome.permissions.request is called for that origin alone. Declining is honoured and reported in the UI rather than failing silently.

Two network requests exist, both user-initiated and both to a service the user named: importing a DOI fetches metadata from doi.org, and "open PDF by URL" fetches the PDF at a URL the user pasted.

Source: https://github.com/AmigoUK/Research-Chrome-Extension (own code MIT; bundled citeproc-js CPAL-1.0, pdf.js Apache-2.0 — see THIRD-PARTY-NOTICES.md).
```

---

## Before you submit

- [ ] `npm run package` is green, including the validator — the zip is `release/context-notes-v<version>.zip`.
- [ ] The zip's version is higher than the published one.
- [ ] Screenshots uploaded from `doc/store/` (the ones in `doc/screenshots/` are the wrong size and will be refused).
- [ ] The privacy-policy URL loads: <https://amigouk.github.io/Research-Chrome-Extension/privacy.html>.
- [ ] The item's visibility (public / unlisted) and distribution regions are set deliberately.
- [ ] A verified contact email is on the developer account — without one the item cannot be published.
