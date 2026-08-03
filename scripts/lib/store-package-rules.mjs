/**
 * What the Chrome Web Store checks at upload time, expressed as a pure function.
 *
 * The upload dashboard is the only place these rules are normally enforced, and
 * it enforces them by rejecting the submission — a round trip we cannot script.
 * So the rules live here, are unit-tested (`test/store-package.test.ts`), and
 * run against the real archive in `scripts/validate-package.mjs` as part of
 * `npm run package`.
 *
 * No I/O and no `process.exit` in this file: the caller decides what a failure
 * means. Keeping it pure is what makes it testable without building a zip.
 */

/** The store truncates a longer name; anything past this is refused outright. */
export const MAX_NAME_HARD_LIMIT = 75;
/** Past this the listing visibly clips, so we warn rather than fail. */
export const MAX_NAME_LENGTH = 45;
/** Hard store limit on the manifest description — it *is* the listing summary. */
export const MAX_DESCRIPTION_LENGTH = 132;
/** Sizes Chrome expects; 128 is also the store tile, so all four are required. */
export const REQUIRED_ICON_SIZES = [16, 32, 48, 128];

/**
 * Permissions we have written a justification for in `doc/STORE-LISTING.md`.
 * Review asks for one per permission, so an addition that nobody documented is
 * worth flagging before it reaches a reviewer.
 */
export const JUSTIFIED_PERMISSIONS = ['storage', 'scripting', 'activeTab', 'sidePanel'];

/** Paths that must never reach a user's machine. */
const BANNED_PATTERNS = [
  { test: (p) => p.endsWith('.map'), why: 'source map' },
  { test: (p) => p.split('/').includes('node_modules'), why: 'node_modules' },
  { test: (p) => p.split('/').includes('.vite'), why: 'Vite cache' },
  { test: (p) => p.split('/').pop() === '.DS_Store', why: 'macOS metadata' },
  { test: (p) => (p.split('/').pop() ?? '').startsWith('._'), why: 'macOS resource fork' },
  { test: (p) => (p.split('/').pop() ?? '').endsWith('.env'), why: 'environment file' },
];

/** Chrome versions are 1–4 dot-separated integers, each 0–65535, no suffix. */
function isValidExtensionVersion(version) {
  if (typeof version !== 'string') return false;
  const parts = version.split('.');
  if (parts.length < 1 || parts.length > 4) return false;
  return parts.every((part) => /^(0|[1-9]\d*)$/.test(part) && Number(part) <= 65535);
}

/**
 * @param {{ manifest: unknown, files: string[], expectedVersion?: string }} input
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateStorePackage({ manifest, files, expectedVersion }) {
  const errors = [];
  const warnings = [];

  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return { errors: ['manifest.json did not parse into an object.'], warnings };
  }

  const m = /** @type {Record<string, any>} */ (manifest);
  // Directory entries (`src/`) are archive bookkeeping, not shippable files.
  const paths = files.filter((f) => !f.endsWith('/'));
  const present = new Set(paths);

  if (m.manifest_version !== 3) {
    errors.push(`manifest_version must be 3 (found ${JSON.stringify(m.manifest_version)}).`);
  }

  const name = typeof m.name === 'string' ? m.name : '';
  if (!name.trim()) {
    errors.push('name is missing or empty.');
  } else if (name.length > MAX_NAME_HARD_LIMIT) {
    errors.push(`name is ${name.length} characters; the store limit is ${MAX_NAME_HARD_LIMIT}.`);
  } else if (name.length > MAX_NAME_LENGTH) {
    warnings.push(
      `name is ${name.length} characters; listings clip past ${MAX_NAME_LENGTH}, so it will be truncated in search results.`,
    );
  }

  const description = typeof m.description === 'string' ? m.description : '';
  if (!description.trim()) {
    errors.push('description is missing or empty — it is the summary shown in the store.');
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(
      `description is ${description.length} characters; the store limit is ${MAX_DESCRIPTION_LENGTH}.`,
    );
  }

  if (!isValidExtensionVersion(m.version)) {
    errors.push(
      `version ${JSON.stringify(m.version)} is not a valid extension version (1–4 integers, 0–65535 each, no suffix).`,
    );
  } else if (expectedVersion && m.version !== expectedVersion) {
    errors.push(
      `manifest version ${m.version} does not match package.json version ${expectedVersion}.`,
    );
  }

  const icons = typeof m.icons === 'object' && m.icons !== null ? m.icons : {};
  for (const size of REQUIRED_ICON_SIZES) {
    const declared = icons[String(size)];
    if (typeof declared !== 'string' || !declared) {
      errors.push(`icons is missing the ${size}px entry.`);
    } else if (!present.has(declared)) {
      errors.push(`icons[${size}] points at ${declared}, which is not in the archive.`);
    }
  }

  // Everything the manifest names has to actually be there; a dangling path is
  // an install-time failure, not a review comment.
  const referenced = [
    m.background?.service_worker,
    m.side_panel?.default_path,
    m.options_page,
    ...Object.values(m.action?.default_icon ?? {}),
  ].filter((p) => typeof p === 'string' && p);
  for (const path of new Set(referenced)) {
    if (!present.has(path))
      errors.push(`manifest references ${path}, which is not in the archive.`);
  }

  if (!present.has('manifest.json')) {
    errors.push('manifest.json is not at the archive root — zip from inside dist/, not above it.');
  }

  for (const path of paths) {
    const banned = BANNED_PATTERNS.find((rule) => rule.test(path));
    if (banned) errors.push(`${path} must not ship (${banned.why}).`);
  }

  const permissions = Array.isArray(m.permissions) ? m.permissions : [];
  for (const permission of permissions) {
    if (!JUSTIFIED_PERMISSIONS.includes(permission)) {
      warnings.push(
        `permission "${permission}" has no justification in doc/STORE-LISTING.md — review will ask for one.`,
      );
    }
  }

  if (Array.isArray(m.host_permissions) && m.host_permissions.length > 0) {
    warnings.push(
      `host_permissions ${JSON.stringify(m.host_permissions)} is granted at install time; this extension's design is per-origin opt-in via optional_host_permissions.`,
    );
  }

  return { errors, warnings };
}
