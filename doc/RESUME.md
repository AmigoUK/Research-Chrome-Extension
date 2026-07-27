# Resume — session handoff

_Snapshot: 2026-07-27 · release **v0.28.0** · branch `main` (synced with origin) · working tree clean._

A fast-start pointer for the next session. Canonical detail lives in `doc/STATUS.md`, `CHANGELOG.md`,
and the git history — this file is just the "where we are and what's next" so you don't re-derive it.

## Where things stand

- **All five roadmap phases + the polish list are delivered.** No unmerged work.
- **Green:** 292 unit + 28 E2E, typecheck + lint clean. CI: typecheck → lint → unit → build (+ E2E job).
- **Repo:** https://github.com/AmigoUK/Research-Chrome-Extension
- **Latest work (this session):**
  - **Web-page annotation** shipped in **v0.27.0** (select text on a live page → Highlight/Note,
    anchored via W3C quote→position→CSS, per-origin opt-in, "On this page" side-panel view).
  - **Edge cases A2–A8 all closed:** v0.27.2 SPA re-anchor · v0.27.3 open Shadow DOM · v0.27.4 quote
    cap + honest coarse CSS fallback · v0.27.5 no dead "Jump to" on an unplaced note · v0.27.1 hung
    channel (A7) · v0.27.6 honest denied-opt-in feedback (A8).
  - **v0.28.0 Chrome Web Store packaging:** `npm run package`, `doc/DISTRIBUTION.md`, `doc/PRIVACY.md`.

## Open — MANUAL, needs a human (can't be automated here)

1. **Publish to the Chrome Web Store.** Zip is ready: `release/context-notes-v0.28.0.zip` (also a
   v0.28.0 GitHub-release asset; regenerate with `npm run package`). Steps + listing checklist +
   per-permission justification: **`doc/DISTRIBUTION.md`**. Host **`doc/PRIVACY.md`** at a public URL
   and link it in the listing (required for the broad optional host permissions). Then submit for review.
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
- **New features:** none pending from the roadmap — these are user-driven.

## How to start (the working pattern that worked this session)

- Commands: `npm run dev` (HMR; load `dist/` unpacked) · `npm run dev:annotator` (watch the separate
  annotator bundle) · `npm test` · `npm run test:e2e` · `npm run build` · `npm run package`.
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
  `gh release create`; for store-facing releases also `npm run package` + attach the zip.

## Known-benign, deferred (don't re-litigate without reason)

- v0.28.0 packaging uses the system `zip` (no dep) — needs `zip` on PATH (fine on Linux/macOS/CI).
- A8: two rapid denials could briefly stack two notices; a denied opt-in re-prompts on each later
  highlight (intended — silent failure is worse); a near-zero-window concurrent double
  `permissions.request` (SW `registerOrigin` is idempotent).
- E2E under headed Chromium/xvfb flakes occasionally (e.g. `webannotation.spec.ts` once this session);
  re-run before treating a single red as a regression.
