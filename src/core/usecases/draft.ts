/**
 * Compose a project's highlights into a draft: sections in outline order,
 * passages in the order they were made, every citation resolved against the
 * draft as a whole.
 *
 * Returns a STRUCTURE, not a string. Rendering to HTML and to Markdown are two
 * views of one model, and a service worker has no `DOMParser` — deriving one
 * from the other would mean hand-writing an HTML parser.
 */
import type { RepositorySet } from '../ports/repositories';
import type { CitationFormatter } from '../ports/citation';
import type { Annotation, CitationStyle, Id, Reference } from '../model/types';
import { DEFAULT_HIGHLIGHT_COLORS } from '../model/types';
import { resolveOutline } from '../draft/outline';

export interface DraftEntry {
  annotationId: Id;
  /** The quoted passage. Absent for a dragged PDF region — coordinates, not text. */
  quote?: string;
  /** The student's own words. May be empty. */
  note: string;
  /** Rendered by citeproc in the requested flavour, already correct for the
   *  whole draft. Never escape it: in `html` that kills the italics, and in
   *  `text` it is not user input in the first place. */
  inTextFormatted: string;
  /** Palette label, so the taxonomy survives into the draft. */
  colorLabel?: string;
  /** Where in the source. Labelled "PDF p. N" and never presented as a printed
   *  page: a file page is not the journal's page, and a confident wrong page
   *  would go into submitted work. */
  locator?: string;
  /** This passage's document has no Reference — nothing to cite it with. */
  missingReference?: boolean;
}

export interface DraftSection {
  id: Id;
  title: string;
  entries: DraftEntry[];
}

export interface Draft {
  projectName: string;
  researchQuestion?: string;
  dueDate?: string;
  sections: DraftSection[];
  /** Passages with no section. Rendered last, under their own heading. */
  unplaced: DraftEntry[];
  bibliography: string;
  /** Nothing was assigned, so sections are colour labels, not an outline. */
  groupedByColour: boolean;
  missingReferenceCount: number;
}

/** Quote text, if the anchor carries any. */
function quoteOf(annotation: Annotation): string | undefined {
  const anchor = annotation.anchor;
  if (anchor.kind === 'web') {
    for (const selector of anchor.selectors) {
      if (selector.type === 'textQuote' && selector.exact) return selector.exact;
    }
    return undefined;
  }
  return anchor.selectors[0]?.quote;
}

/** "PDF p. N", never a bare page number: a PDF's file page is not the
 *  journal's printed page, so this must never be mistaken for one. */
function locatorOf(annotation: Annotation): string | undefined {
  const anchor = annotation.anchor;
  if (anchor.kind !== 'pdf') return undefined;
  const page = anchor.selectors[0]?.page;
  return page === undefined ? undefined : `PDF p. ${page}`;
}

/** Passages of one bucket, oldest first. Exported because the Outline view must
 *  sort identically: this order becomes the citation order, so a difference
 *  between the screen and the export would renumber a Vancouver draft. */
export function orderedEntries(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function composeDraft(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { projectId: Id; template: string; flavour: 'text' | 'html'; style?: CitationStyle },
): Promise<Draft> {
  const project = await repos.projects.get(args.projectId);
  if (!project) throw new Error(`Project not found: ${args.projectId}`);

  const [annotations, references] = await Promise.all([
    repos.annotations.listByProject(args.projectId),
    repos.references.listByProject(args.projectId),
  ]);

  const outline = resolveOutline(project);
  const sectionIds = new Set(outline.map((s) => s.id));
  const palette = project.colorPalette ?? DEFAULT_HIGHLIGHT_COLORS;
  const refByDocument = new Map<Id, Reference>();
  for (const reference of references) {
    if (reference.documentId) refByDocument.set(reference.documentId, reference);
  }

  const placed = annotations.filter((a) => a.section && sectionIds.has(a.section));
  // Whether ANY annotation was ever given a section — not whether placement
  // resolved. A section id that names a deleted section must fall through to
  // `unplaced`, not flip the whole draft into colour grouping: that would
  // regroup every OTHER annotation's citation order around one dangling id.
  const anySectioned = annotations.some((a) => a.section !== undefined);
  const groupedByColour = !anySectioned && annotations.length > 0;

  // Buckets in render order — this is what fixes the citation order.
  const buckets: Array<{ id: Id; title: string; items: Annotation[] }> = groupedByColour
    ? palette
        .map((c) => ({
          id: c.id,
          title: c.label,
          items: orderedEntries(annotations.filter((a) => a.color === c.id)),
        }))
        .filter((b) => b.items.length > 0)
    : outline.map((s) => ({
        id: s.id,
        title: s.title,
        items: orderedEntries(placed.filter((a) => a.section === s.id)),
      }));

  const unplacedItems = groupedByColour
    ? orderedEntries(annotations.filter((a) => !a.color))
    : orderedEntries(annotations.filter((a) => !a.section || !sectionIds.has(a.section)));

  // Flatten in exactly the order the draft reads, then cite once against it.
  const flat = [...buckets.flatMap((b) => b.items), ...unplacedItems];
  const order: Id[] = [];
  for (const annotation of flat) {
    const reference = refByDocument.get(annotation.documentId);
    if (reference) order.push(reference.id);
  }

  const run =
    order.length > 0
      ? await formatter.formatRun(
          { items: references.map((r) => ({ ...r.cslData, id: r.id })), order },
          args.template,
          args.flavour,
          args.style,
        )
      : { inText: [], bibliography: '' };

  // Walk the flat list once more, consuming citations in the same order.
  let cursor = 0;
  let missingReferenceCount = 0;
  const entryFor = (annotation: Annotation): DraftEntry => {
    const reference = refByDocument.get(annotation.documentId);
    const quote = quoteOf(annotation);
    const locator = locatorOf(annotation);
    const colorLabel = palette.find((c) => c.id === annotation.color)?.label;
    if (!reference) missingReferenceCount += 1;
    return {
      annotationId: annotation.id,
      note: annotation.content,
      inTextFormatted: reference ? (run.inText[cursor++] ?? '') : '',
      ...(quote === undefined ? {} : { quote }),
      ...(locator === undefined ? {} : { locator }),
      ...(colorLabel === undefined ? {} : { colorLabel }),
      ...(reference ? {} : { missingReference: true as const }),
    };
  };

  const sections = buckets.map((b) => ({
    id: b.id,
    title: b.title,
    entries: b.items.map(entryFor),
  }));
  const unplaced = unplacedItems.map(entryFor);

  return {
    projectName: project.name,
    ...(project.researchQuestion === undefined
      ? {}
      : { researchQuestion: project.researchQuestion }),
    ...(project.dueDate === undefined ? {} : { dueDate: project.dueDate }),
    sections,
    unplaced,
    bibliography: run.bibliography,
    groupedByColour,
    missingReferenceCount,
  };
}
