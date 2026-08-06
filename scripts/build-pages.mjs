// Build the GitHub Pages site in docs/ — the public home of the privacy policy.
//
// The Chrome Web Store requires a privacy-policy URL for an extension that asks
// for broad optional host permissions, and a link to a Markdown file rendered by
// github.com is a repository page, not a policy. This publishes the real thing.
//
// `docs/` (not `doc/`) because GitHub Pages will only serve the repo root or a
// folder called exactly `docs`. The policy is GENERATED from `doc/PRIVACY.md`
// rather than written twice: two copies of a legal statement drift, and the one
// people read would be the stale one.
//
//   npm run pages    # then commit docs/
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, 'docs');
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const REPO = 'https://github.com/AmigoUK/Research-Chrome-Extension';

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The Markdown subset `doc/PRIVACY.md` actually uses: headings, paragraphs,
 * bullet lists, bold, inline code and links. Deliberately not a general parser —
 * a general parser is a dependency, and this input is one file we control.
 * Anything unsupported would show up as literal punctuation, which the
 * post-render check below refuses to publish.
 */
function renderMarkdown(md) {
  const inline = (text) =>
    esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Non-greedy rather than [^*]+: code spans are substituted first, and one
      // of them is the `*://*/*` match pattern — asterisks inside are content.
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  const html = [];
  let list = null;
  // Blank lines separate blocks; a wrapped paragraph in the source is one
  // paragraph here, so join its lines before rendering.
  for (const block of md.trim().split(/\n{2,}/)) {
    const lines = block.split('\n');
    if (lines[0].startsWith('>')) {
      // A blockquote in the source is an editorial note to whoever edits the
      // file — where the published copy lives, why not to edit it by hand. It
      // is not part of the policy, so it does not get published.
      continue;
    }
    if (lines[0].startsWith('# ')) {
      html.push(`<h1>${inline(lines[0].slice(2))}</h1>`);
    } else if (lines[0].startsWith('## ')) {
      html.push(`<h2>${inline(lines[0].slice(3))}</h2>`);
    } else if (lines[0].startsWith('- ')) {
      // A bullet may wrap onto following indented lines.
      list = [];
      for (const line of lines) {
        if (line.startsWith('- ')) list.push(line.slice(2));
        else list[list.length - 1] += ' ' + line.trim();
      }
      html.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    } else {
      html.push(`<p>${inline(lines.join(' '))}</p>`);
    }
  }
  return html.join('\n');
}

const FOOTER = `<footer>
  <a href="mailto:dev@attv.uk">dev@attv.uk</a>
  <span aria-hidden="true">·</span>
  <span>Project &amp; Development: Tomasz &lsquo;Amigo&rsquo; Lewandowski</span>
  <span aria-hidden="true">·</span>
  <a href="https://www.attv.uk" target="_blank" rel="noreferrer">www.attv.uk</a>
  <span aria-hidden="true">·</span>
  <a href="${REPO}" target="_blank" rel="noreferrer">GitHub</a>
  <span aria-hidden="true">·</span>
  <span>v${pkg.version}</span>
</footer>`;

// The palette and faces are the app's own (src/options/dashboard.css); system
// fallbacks only, so the page needs no font files and loads from nothing.
const STYLE = `
  :root {
    --bg: oklch(98% 0.004 95); --surface: oklch(100% 0.002 95);
    --fg: oklch(20% 0.018 70); --muted: oklch(45% 0.014 70);
    --border: oklch(90% 0.006 95); --accent: oklch(52% 0.10 28);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: oklch(18% 0.012 70); --surface: oklch(22% 0.012 70);
      --fg: oklch(94% 0.006 95); --muted: oklch(72% 0.012 70);
      --border: oklch(32% 0.012 70); --accent: oklch(72% 0.10 32);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font-family: 'Iowan Old Style', Charter, Georgia, serif;
    font-size: 17px; line-height: 1.62;
  }
  main { max-width: 46rem; margin: 0 auto; padding: 4rem 1.5rem 3rem; }
  h1 { font-size: 2.1rem; line-height: 1.2; letter-spacing: -0.015em; margin: 0 0 .6rem; }
  h2 { font-size: 1.22rem; margin: 2.4rem 0 .6rem; }
  p, li { color: var(--fg); }
  a { color: var(--accent); }
  ul { padding-left: 1.15rem; }
  li { margin: .35rem 0; }
  code {
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .86em; background: var(--surface); border: 1px solid var(--border);
    border-radius: 4px; padding: .06em .32em;
  }
  .lede { color: var(--muted); font-size: 1.12rem; }
  .badges { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1.6rem 0 2.4rem; }
  .badge {
    font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .7rem;
    letter-spacing: .08em; text-transform: uppercase; color: var(--accent);
    border: 1px solid color-mix(in oklch, var(--accent) 34%, transparent);
    border-radius: 999px; padding: .3rem .7rem;
  }
  .shot {
    width: 100%; height: auto; display: block; margin: 2rem 0;
    border: 1px solid var(--border); border-radius: 10px;
  }
  footer {
    border-top: 1px solid var(--border); background: var(--bg);
    padding: .9rem 1.5rem; text-align: center; font-size: 11px; color: var(--muted);
    font-family: system-ui, sans-serif;
  }
  footer a { color: inherit; text-decoration: none; }
  footer a:hover { color: var(--fg); }
  footer span[aria-hidden] { margin: 0 .5rem; opacity: .5; }
`;

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(pkg.description)}">
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
</main>
${FOOTER}
</body>
</html>
`;

const policyHtml = renderMarkdown(readFileSync(path.join(root, 'doc/PRIVACY.md'), 'utf8'));
// If the subset renderer met syntax it does not handle, the giveaway is Markdown
// punctuation surviving into the output. Better to fail than to publish it.
for (const leak of ['](', '**', '`']) {
  if (policyHtml.includes(leak)) {
    console.error(
      `docs/privacy.html still contains raw Markdown ("${leak}") — extend renderMarkdown.`,
    );
    process.exit(1);
  }
}

writeFileSync(
  path.join(out, 'privacy.html'),
  page(
    'Privacy Policy — Scientific Context Notes',
    `${policyHtml}\n<p><a href="./">← Scientific Context Notes</a></p>`,
  ),
);

writeFileSync(
  path.join(out, 'index.html'),
  page(
    'Scientific Context Notes — a local-first research companion for Chrome',
    `<h1>Scientific Context Notes</h1>
<p class="lede">${esc(pkg.description)}</p>
<div class="badges">
  <span class="badge">Local-first</span>
  <span class="badge">No account</span>
  <span class="badge">No backend</span>
  <span class="badge">Manifest V3</span>
</div>
<img class="shot" src="./overview.png" width="1360" height="940"
     alt="The dashboard: project workspace with stat tiles and a four-column reading Kanban">
<h2>What it does</h2>
<ul>
  <li>Files web pages and PDFs into <strong>projects</strong>, with a reading status you can move
      from “to read” through to “used in output”.</li>
  <li>Anchors every note to <strong>the exact passage it came from</strong> — a W3C text-quote
      selector on a page, a page-and-rectangle anchor in a PDF — so the quote survives a reload.</li>
  <li>Produces <strong>real citations</strong>: APA, MLA, Chicago and Harvard through citeproc,
      with a rule-driven editor that shows the CSL it compiles to.</li>
  <li>Reads and annotates PDFs in a <strong>bundled reader</strong>; nothing is uploaded to open a
      document.</li>
  <li>Shares work as a <strong>portable snapshot file</strong>, optionally password-encrypted —
      collaboration by file, because there is no server to collaborate through.</li>
</ul>
<h2>Where your data lives</h2>
<p>In this browser, in IndexedDB, and nowhere else. There is no backend, no telemetry, no account,
and no remote code — every asset, from the citation styles to the PDF engine, ships inside the
extension. Host access is never granted up front: annotating a site asks for that site alone, and
previewing every page you open needs a separate, optional grant — because activeTab access expires
the moment you navigate. Either is revocable any time in Site access. The full statement is in the
<a href="./privacy.html">privacy policy</a>.</p>
<h2>Get it</h2>
<ul>
  <li><a href="${REPO}">Source, releases and issues on GitHub</a></li>
  <li><a href="${REPO}/blob/main/doc/DISTRIBUTION.md">How it is packaged and published</a></li>
</ul>`,
  ),
);

// The landing image is the README's own overview shot, not the store one: the
// store version carries a baked-in caption meant for a carousel.
copyFileSync(path.join(root, 'doc/screenshots/01-overview.png'), path.join(out, 'overview.png'));

// Pages runs Jekyll by default, which ignores files beginning with an underscore
// and rewrites some paths; this site is plain HTML and wants neither.
writeFileSync(path.join(out, '.nojekyll'), '');

console.log('Wrote docs/index.html, docs/privacy.html and docs/.nojekyll.');
