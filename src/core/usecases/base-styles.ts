/**
 * Imported CSL base styles.
 *
 * The editor can already export a compiled `.csl`; this is the way back in. A
 * file is validated before it is stored (`parseCslStyle`), so a bad import fails
 * at the moment the user chose the file rather than the moment they cite.
 */
import type { RepositorySet } from '../ports/repositories';
import type { CitationSystem, CustomBaseStyle, Id } from '../model/types';
import type { CaptureDeps } from './capture';
import { customBaseStyleId, parseCslStyle } from '../citation/parse';

/** What the picker needs — the XML stays out of it, it is up to 250 kB. */
export interface BaseStyleSummary {
  id: Id;
  name: string;
  system: CitationSystem;
  createdAt: string;
}

function summarise(style: CustomBaseStyle): BaseStyleSummary {
  return { id: style.id, name: style.name, system: style.system, createdAt: style.createdAt };
}

export async function listCustomBaseStyles(repos: RepositorySet): Promise<BaseStyleSummary[]> {
  const styles = await repos.customBaseStyles.list();
  return styles.map(summarise).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Validate a `.csl` file and store it. Re-importing the same style replaces it,
 * which is what a user updating a journal's style file expects.
 */
export async function importCustomBaseStyle(
  repos: RepositorySet,
  deps: CaptureDeps,
  args: { xml: string; name?: string },
): Promise<BaseStyleSummary> {
  const parsed = parseCslStyle(args.xml);
  const name = args.name?.trim() || parsed.title;
  const style: CustomBaseStyle = {
    id: customBaseStyleId(name),
    name,
    xml: args.xml,
    system: parsed.system,
    createdAt: deps.now(),
  };
  await repos.customBaseStyles.put(style);
  return summarise(style);
}

/**
 * Forget an imported style. Citation-style profiles built on it are left alone
 * and fall back to APA when formatted — deleting a user's profiles because a
 * base style went away would be a far worse surprise than a changed format.
 */
export async function deleteCustomBaseStyle(repos: RepositorySet, id: Id): Promise<void> {
  await repos.customBaseStyles.delete(id);
}
