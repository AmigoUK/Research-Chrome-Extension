// Check the packaged zip against what the Chrome Web Store enforces at upload.
//
// Runs as the second half of `npm run package`, so a bad archive fails here —
// on this machine, in a second — instead of on the dashboard after a login, an
// upload and a wait. The rules themselves are pure and unit-tested in
// `scripts/lib/store-package-rules.mjs`; this file only does the I/O.
//
// Uses the system `unzip` (the companion of the `zip` that built the archive);
// no dependency added.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateStorePackage } from './lib/store-package-rules.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const zipPath = path.join(root, 'release', `context-notes-v${version}.zip`);

if (!existsSync(zipPath)) {
  console.error(`No archive at release/context-notes-v${version}.zip — run \`npm run package\`.`);
  process.exit(1);
}

function unzip(args) {
  try {
    return execFileSync('unzip', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error(
        '`unzip` is not installed or not on PATH. Install it (Linux: `apt-get install unzip`, macOS: preinstalled).',
      );
      process.exit(1);
    }
    throw err;
  }
}

// -Z1 lists one archive-relative path per line; -p streams a member to stdout.
const files = unzip(['-Z1', zipPath]).split('\n').filter(Boolean);

let manifest;
try {
  manifest = JSON.parse(unzip(['-p', zipPath, 'manifest.json']));
} catch {
  manifest = null; // The rules report this properly; don't crash on a bad zip.
}

const { errors, warnings } = validateStorePackage({ manifest, files, expectedVersion: version });

for (const warning of warnings) console.warn(`  warning: ${warning}`);
for (const error of errors) console.error(`  error:   ${error}`);

if (errors.length > 0) {
  console.error(
    `\nrelease/context-notes-v${version}.zip would be rejected (${errors.length} error${errors.length === 1 ? '' : 's'}).`,
  );
  process.exit(1);
}

const shippable = files.filter((f) => !f.endsWith('/')).length;
console.log(
  `Validated release/context-notes-v${version}.zip — ${shippable} files, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}. Ready to upload.`,
);
