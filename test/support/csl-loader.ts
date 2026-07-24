/**
 * CSL loader for unit tests: reads the vendored files straight off disk.
 *
 * Production fetches them as extension assets (`src/adapters/citation/csl-assets.ts`);
 * tests have no fetch origin, so they read the same files through `fs`. Both
 * satisfy the one-function `CslLoader` contract, which is the point of it.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { CslLoader } from '../../src/adapters/citation/citejs';

const CSL_DIR = fileURLToPath(new URL('../../src/assets/csl/', import.meta.url));

/** Template names, matching `BASE_STYLE_TEMPLATES` in the domain core. */
export const TEST_CSL_TEMPLATES = [
  'apa',
  'harvard1',
  'vancouver',
  'chicago-author-date',
  'chicago-notes-bibliography',
  'modern-language-association',
] as const;

export function createFsCslLoader(): CslLoader {
  const cache = new Map<string, Promise<string | undefined>>();
  return (template: string) => {
    if (!(TEST_CSL_TEMPLATES as readonly string[]).includes(template)) {
      return Promise.resolve(undefined);
    }
    let pending = cache.get(template);
    if (!pending) {
      pending = readFile(`${CSL_DIR}${template}.csl`, 'utf8').catch(() => undefined);
      cache.set(template, pending);
    }
    return pending;
  };
}
