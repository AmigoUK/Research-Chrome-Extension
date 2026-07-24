/**
 * Reading a third-party `.csl` file well enough to accept it as a base style.
 *
 * Deliberately regex-based rather than DOM-based: the service worker has no
 * `DOMParser`, and everything needed lives in the document's first few hundred
 * bytes. citeproc does the real parsing when the style is first used; the point
 * here is to reject an obviously wrong file *before* it is stored, and to pull
 * out a title and the citation format so the picker can label it honestly.
 */
import type { CitationSystem } from '../model/types';
import { citationFormatOf } from './compile';

/** CSL's `citation-format` values, mapped to the systems the editor knows. */
const FORMAT_SYSTEMS: Record<string, CitationSystem> = {
  'author-date': 'authorDate',
  author: 'authorDate',
  note: 'footnote',
  numeric: 'numeric',
  label: 'numeric',
};

export interface ParsedCslStyle {
  title: string;
  system: CitationSystem;
  /** The raw `citation-format` the file declares, when it declares one. */
  citationFormat?: string;
}

function firstTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match?.[1]?.trim() || undefined;
}

/** Undo the five XML entities a title can legally contain. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Validate and describe a CSL file. Throws with a reason a person can act on —
 * these messages surface directly in the UI when an import is refused.
 */
export function parseCslStyle(xml: string): ParsedCslStyle {
  const text = xml.trim();
  if (!text) throw new Error('That file is empty');
  if (!/<style[\s>]/.test(text)) {
    throw new Error('That is not a CSL style file (no <style> element)');
  }
  if (!/xmlns\s*=\s*"http:\/\/purl\.org\/net\/xbiblio\/csl"/.test(text)) {
    throw new Error('That is not a CSL style file (wrong or missing namespace)');
  }
  // A dependent style is a pointer to another style, not a formatter: citeproc
  // cannot format with one, so refusing it here beats failing at citation time.
  if (/<link[^>]+rel="independent-parent"/.test(text)) {
    throw new Error('That is a dependent style — import the independent one it points to');
  }
  if (!/<citation[\s>]/.test(text) || !/<macro[\s>]/.test(text)) {
    throw new Error('That CSL style has no citation rules in it');
  }

  const rawTitle = firstTag(text, 'title');
  const citationFormat = citationFormatOf(text);
  return {
    title: rawTitle ? decodeEntities(rawTitle) : 'Imported style',
    system: (citationFormat && FORMAT_SYSTEMS[citationFormat]) || 'authorDate',
    ...(citationFormat ? { citationFormat } : {}),
  };
}

/** Prefix marking a base style that came from a file rather than the six vendored ones. */
export const CUSTOM_BASE_PREFIX = 'custom-base:';

export function isCustomBaseStyleId(baseStyleId: string): boolean {
  return baseStyleId.startsWith(CUSTOM_BASE_PREFIX);
}

/** `Nature — Author Date` → `custom-base:nature-author-date`. */
export function customBaseStyleId(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'style';
  return `${CUSTOM_BASE_PREFIX}${slug}`;
}
