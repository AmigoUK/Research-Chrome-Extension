# Resume — session handoff

_Snapshot: 2026-08-03 · release **v1.0.1** · branch `main` (synced with origin) · working tree clean._

A fast-start pointer for the next session. Canonical detail lives in `doc/STATUS.md`, `CHANGELOG.md`,
and the git history — this file is just the "where we are and what's next" so you don't re-derive it.

## Where things stand

- **All five roadmap phases + the polish list are delivered.** No unmerged work.
- **Green:** 309 unit + 28 E2E, typecheck + lint + format clean. CI: typecheck → lint →
  format:check → unit → build (+ E2E job).
- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Published site:** https://amigouk.github.io/Research-Chrome-Extension/ (GitHub Pages, from `docs/`)
- **Ship this:** **v1.0.1**. `release/context-notes-v1.0.1.zip`, also attached to the v1.0.1 GitHub
  release (verified byte-identical). **Not v1.0.0** — see the defect below.

### What the last session left behind

**v1.0.0 — everything the Chrome Web Store needs except the upload.**

- `npm run package` builds the zip **and validates it** against the store's upload rules
  (`scripts/lib/store-package-rules.mjs`, 17 unit tests): MV3, the 132-char summary limit, version
  matching `package.json`, all four icons and every referenced surface present, manifest at the
  archive root, no source maps or build junk.
- `npm run store:assets` → `doc/store/`: five 1280×800 screenshots, a 440×280 tile, a 1400×560
  marquee. The store accepts **only** 1280×800 or 640×400, and every image in `doc/screenshots/` is
  the wrong size — do not upload from there.
- `npm run pages` → `docs/`: the landing page and the **privacy policy**, generated from
  `doc/PRIVACY.md` and live at `/privacy.html`. Required for the broad optional host permissions.
- `doc/STORE-LISTING.md` — every dashboard field written out to paste.

**v1.0.1 — a real defect v1.0.0 shipped with.** A toolbar button commits on `mousedown` (with
`preventDefault`, so the selection survives the click); the matching `mouseup` reached the
annotator's own document listener, was read as a fresh page selection, and re-opened the toolbar the
failure had just dismissed. Harmless on success (the commit clears the selection first), permanent
on failure. It only showed when the rejection beat the deferred mouse handler — a sleeping service
worker gives exactly that coin flip, which is why it had passed as an E2E flake since v0.27.1.

**Also, no product effect:** the repository is Prettier-formatted and CI now runs `format:check`
between lint and the unit tests. **Run `npm run format` before committing**, or CI fails on
whitespace. `.prettierignore` deliberately excludes `doc/` (hand-wrapped prose), `docs/` (generated
by `npm run pages` — the generator and Prettier would overwrite each other) and `CHANGELOG.md`
(released history is append-only).

## Open — MANUAL, needs a human (can't be automated here)

1. **Submit to the Chrome Web Store.** Everything is prepared; what remains is the account and the
   clicking.
   - Needs a CWS **developer account** (one-off 5 USD registration) with a verified contact email.
   - Upload `release/context-notes-v1.0.1.zip` — regenerate with `npm run package`, or take the
     asset attached to the v1.0.1 GitHub release (same bytes). **Use v1.0.1, not v1.0.0: v1.0.0 can
     leave the highlight toolbar stuck open when an annotate fails fast.**
   - Fill the listing from **`doc/STORE-LISTING.md`**, upload the images from **`doc/store/`**, and
     give the privacy-policy URL <https://amigouk.github.io/Research-Chrome-Extension/privacy.html>.
   - `doc/DISTRIBUTION.md` has the end-to-end steps.
2. **Thorough manual test in real Chrome** — the parts E2E can't drive (native permission prompts,
   real sites). Load `dist/` unpacked (`chrome://extensions`, Developer mode) and check:
   - Production activation: side panel → **"Annotate this page"** → native host-permission consent (Allow).
   - **A8:** click **Deny** → highlight still saved, in-page notice shows, prompt returns on next highlight.
   - **A2 SPA** on a real single-page app; **A3** on a site using open shadow DOM.
   - **A5:** a note under "Couldn't place on this page" has no "Jump to".
   - **DOI import** and **Open PDF by URL** (real network; incl. errors — bad DOI, HTML instead of PDF).
   - Browser priority: Chrome → Edge (Firefox out of scope).

## Candidate next work (pick per user intent)

- **Deferred by design (see `doc/STATUS.md` "Deferred by design"):** `CitationStyle.cslOverride`
  persistence (won't-do — duplicates `userRules`); per-annotation **"section"** field + link-to-section
  (needs an IDB schema migration — append-only, bump `DB_VERSION`); **Presence** (needs a live backend —
  out of scope by the local-first decision).
- **Article/interview:** `doc/developer-interview.md` is committed; still user-owned — the section-1
  opening anecdote is a Claude-written DRAFT (`DO WERYFIKACJI`) to replace with a real story, and an
  optional section-16 case study after the first real project.
- **After the store listing goes live:** add the store badge/link to `README.md` and `docs/index.html`.

## How to start (the working pattern that worked in these sessions)

- Commands: `npm run dev` (HMR; load `dist/` unpacked) · `npm run dev:annotator` (watch the separate
  annotator bundle) · `npm test` · `npm run test:e2e` · `npm run build` · `npm run format` (do this
  before committing) · `npm run package` · `xvfb-run -a npm run store:assets` · `npm run pages`.
- **Process for any non-trivial change:** brainstorm (superpowers) → spec in `doc/superpowers/specs/`
  → plan in `doc/superpowers/plans/` → execute via **subagent-driven development** (fresh implementer
  per task, task review, final whole-branch review) with **TDD**. Small glue tweaks were done directly
  on `main` with a full pre-flight + one independent diff review.
- **Architecture guardrails** (see `CLAUDE.md`): `src/core` is pure (no `chrome.*`/IDB/DOM, except
  `src/core/anchoring/web.ts`); surfaces send typed messages to the SW's pure `handleRequest`;
  migrations are append-only; escape at the sink; a `position: fixed` popover repositions on scroll,
  it does not close.
- **Release flow** (`CLAUDE.md` "Releases"): bump `package.json` → CHANGELOG section → update README +
  `doc/STATUS.md` → `chore(release)`/`feat`/`fix` commit → tag → `git push --follow-tags` →
  `gh release create`; for store-facing releases also `npm run package` + attach the zip, and
  `npm run pages` so the published site's version footer keeps up.

## Known-benign, deferred (don't re-litigate without reason)

- Packaging uses the system `zip`/`unzip` (no dep) — needs both on PATH (fine on Linux/macOS/CI).
- `npm run store:assets` needs a headed Chromium; run it under `xvfb-run` in a headless environment.
- A8: two rapid denials could briefly stack two notices; a denied opt-in re-prompts on each later
  highlight (intended — silent failure is worse); a near-zero-window concurrent double
  `permissions.request` (SW `registerOrigin` is idempotent).
- `e2e/webannotation.spec.ts` used to fail whenever the file ran on its own and pass inside a full
  suite. That was **not** leftover state between specs: `commit()` paints asynchronously (the click
  returns with no overlay; the first `.ov` appears ~18 ms later), and reading its geometry the
  instant `toHaveCount(1)` resolved caught the node one frame before it had a box. `paintedRect()`
  now polls the assertion instead. Don't reintroduce `locator.boundingBox()` there.

## Two traps this codebase has now paid for twice — worth reading before touching the annotator

- **The annotator must not treat events out of its own UI as input on the page** (v1.0.1). The
  `mouseup` listener returns early when `composedPath()` contains the `HOST_ID` element. Remove that
  guard and the stuck-toolbar defect comes straight back. A consequence worth knowing: a mouseup on
  an existing overlay no longer closes an open toolbar — it closes on the next mouseup on the page.
- **A presence assertion is not a valid precondition for a geometry read.** Twice now, an E2E test
  looked flaky because it sampled layout in the frame where a node had been appended but not yet
  laid out. If an assertion needs a box, wait for the box, not for the node.
- **When an E2E test "flakes", reproduce it before believing that word.** Both cases here were
  deterministic once measured — one with a per-animation-frame sample inside the page, the other
  with a `MutationObserver` on the shadow root. The second was a real product defect that had been
  dismissed as a flake since v0.27.1.
