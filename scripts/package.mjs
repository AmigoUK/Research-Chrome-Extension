// Package the built extension into a Chrome Web Store-ready zip.
//
// The Web Store wants a zip whose ROOT is the extension (manifest.json at the
// top level), not the source repo — so we zip from inside dist/. Source maps are
// excluded: users don't need them and they dwarf the upload. Run via
// `npm run package`, which builds first so dist/ is fresh and its manifest
// version matches package.json.
//
// Uses the system `zip` (present on Linux/macOS and in CI); no dependency added.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'release');

if (!existsSync(path.join(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found — run `npm run build` first (or use `npm run package`).');
  process.exit(1);
}

const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const zipName = `context-notes-v${version}.zip`;
const zipPath = path.join(outDir, zipName);

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });

try {
  // -r recurse, -q quiet; `.` = everything in dist/ (cwd); -x excludes maps.
  execFileSync('zip', ['-r', '-q', zipPath, '.', '-x', '*.map'], { cwd: dist });
} catch (err) {
  if (err && err.code === 'ENOENT') {
    console.error('`zip` is not installed or not on PATH. Install it (Linux: `apt-get install zip`, macOS: preinstalled) or package dist/ with your own tool.');
  } else {
    console.error('Packaging failed:', err instanceof Error ? err.message : err);
  }
  process.exit(1);
}

const sizeKb = (statSync(zipPath).size / 1024).toFixed(0);
console.log(`Packaged v${version} → release/${zipName} (${sizeKb} kB). Upload this at the Chrome Web Store Developer Dashboard.`);
