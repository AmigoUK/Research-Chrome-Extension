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
import type {
  Annotation,
  CitationStyle,
  HighlightColor,
  Id,
  Project,
  Reference,
} from '../model/types';
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

/** Quote text, if the anchor carries any. Loops rather than reading
 *  `selectors[0]`: `createPdfAnchor` emits one selector today, but the
 *  snapshot importer does not cap the array, and a multi-selector anchor
 *  whose first entry lacks a quote would otherwise lose it even though a
 *  later selector has one. */
function quoteOf(annotation: Annotation): string | undefined {
  const anchor = annotation.anchor;
  if (anchor.kind === 'web') {
    for (const selector of anchor.selectors) {
      if (selector.type === 'textQuote' && selector.exact) return selector.exact;
    }
    return undefined;
  }
  for (const selector of anchor.selectors) {
    // Truthy, not `!== undefined`: a stored `quote: ''` is treated as no
    // quote at all — an empty string is not a passage to display.
    if (selector.quote) return selector.quote;
  }
  return undefined;
}

/** "PDF p. N", never a bare page number: a PDF's file page is not the
 *  journal's printed page, so this must never be mistaken for one. Loops in
 *  the same shape as `quoteOf`, for symmetry — but unlike `quoteOf`, this
 *  loop cannot currently skip anything: `PdfRegionSelector.page` is a
 *  required `number`, so the guard is already satisfied at index 0 for every
 *  well-typed anchor. */
function locatorOf(annotation: Annotation): string | undefined {
  const anchor = annotation.anchor;
  if (anchor.kind !== 'pdf') return undefined;
  for (const selector of anchor.selectors) {
    if (selector.page !== undefined) return `PDF p. ${selector.page}`;
  }
  return undefined;
}

/** Passages of one bucket, oldest first. Exported because the Outline view must
 *  sort identically: this order becomes the citation order, so a difference
 *  between the screen and the export would renumber a Vancouver draft. */
export function orderedEntries(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface GroupedPassages {
  buckets: Array<{ id: Id; title: string; items: Annotation[] }>;
  /** Passages with no section (outline mode) or no colour (colour mode) —
   *  or one naming a bucket that no longer exists. Rendered last. */
  unplaced: Annotation[];
  groupedByColour: boolean;
}

/**
 * The bucket order plus the unplaced complement plus the colour fallback —
 * i.e. everything that decides citation order. Exported (not just
 * `composeDraft`-private) so a later view rendering "the same list" reads it
 * from here rather than re-deriving it: a second implementation of this
 * grouping would be free to drift from the one that actually drives
 * `formatRun`'s `order`, and drift here is a silently renumbered essay.
 *
 * Takes the `Project` itself, not a bare `outline`/`palette` pair: both are
 * *derived* values — `resolveOutline(project)` synthesises a five-section
 * default with derived ids when `project.outline` is empty, and the palette
 * falls back to `DEFAULT_HIGHLIGHT_COLORS` when `project.colorPalette` is
 * absent. A caller that derived either differently (e.g. `project.outline ??
 * []`, which yields zero buckets instead of the five-section default) would
 * silently produce a different citation order than `composeDraft`'s own —
 * exactly the drift this function exists to prevent, just relocated one
 * level up. Deriving both here, from the project the caller already has,
 * makes that mistake impossible rather than merely documented against.
 */
export function groupPassages(annotations: Annotation[], project: Project): GroupedPassages {
  const outline = resolveOutline(project);
  // `readonly`, not `HighlightColor[]`: `DEFAULT_HIGHLIGHT_COLORS` is
  // `readonly` (the shared default must never be mutated in place), and
  // `project.colorPalette ?? DEFAULT_HIGHLIGHT_COLORS` inherits that.
  const palette: readonly HighlightColor[] = project.colorPalette ?? DEFAULT_HIGHLIGHT_COLORS;
  const sectionIds = new Set(outline.map((s) => s.id));
  const paletteIds = new Set(palette.map((c) => c.id));

  // Whether ANY annotation was ever given a section — not whether placement
  // resolved. A section id that names a deleted section must fall through to
  // `unplaced`, not flip the whole draft into colour grouping: that would
  // regroup every OTHER annotation's citation order around one dangling id.
  const anySectioned = annotations.some((a) => a.section !== undefined);

  const colourBuckets = palette
    .map((c) => ({
      id: c.id,
      title: c.label,
      items: orderedEntries(annotations.filter((a) => a.color === c.id)),
    }))
    .filter((b) => b.items.length > 0);

  // Colour grouping is a fallback for a project that never used the outline
  // at all, and only a real fallback if it would show something. An outline
  // already in use always wins (`anySectioned`); and when it isn't in use
  // AND no colour bucket has anything either, claiming "grouped by colour"
  // would be false on both halves of that sentence — stay in outline mode
  // (its sections empty) instead, per Ruling B.
  const groupedByColour = !anySectioned && colourBuckets.length > 0;

  const buckets = groupedByColour
    ? colourBuckets
    : outline.map((s) => ({
        id: s.id,
        title: s.title,
        items: orderedEntries(annotations.filter((a) => a.section === s.id)),
      }));

  // Mirrors the section case exactly: a colour naming no current palette
  // entry (the entry was deleted — `HighlightColor.id` is "never reused
  // after deletion") must fall through to `unplaced`, not vanish. Silently
  // dropping the passage would be the same failure as the section case, with
  // a worse symptom: the student loses a passage from their essay with
  // nothing on screen to say it ever existed.
  //
  // `=== undefined`, not a truthy check: the bucket predicates above test
  // `a.color === c.id` / `a.section === s.id`, which — for an empty-string
  // id — is satisfiable. A truthy `!a.color` / `!a.section` guard is *also*
  // satisfied by an empty string regardless of whether some bucket actually
  // claims it, so the two predicates would no longer be complements and an
  // empty-string id could land an annotation in a bucket AND in `unplaced`.
  // Since citations are keyed by `annotation.id` (not by position), a
  // duplicate silently makes one occurrence steal the other's citation.
  // Testing `undefined` explicitly keeps the two predicates exact opposites
  // for every id, including the empty string.
  const unplaced = groupedByColour
    ? orderedEntries(annotations.filter((a) => a.color === undefined || !paletteIds.has(a.color)))
    : orderedEntries(
        annotations.filter((a) => a.section === undefined || !sectionIds.has(a.section)),
      );

  return { buckets, unplaced, groupedByColour };
}

/** Thrown when `formatRun` returns a different number of citations than it
 *  was asked to format — a violation of `CitationRunOutput.inText`'s own
 *  contract ("one citation per position in `order` — same length, same
 *  order"). `run.inText[cursor++] ?? ''` would otherwise mask the violation
 *  as a silently blank citation instead of a visible failure. */
export class CitationRunLengthMismatchError extends Error {
  constructor(requested: number, received: number) {
    super(`formatRun returned ${received} citations for ${requested} requested`);
    this.name = 'CitationRunLengthMismatchError';
  }
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

  // `palette` is still resolved here too, separately from `groupPassages`'s
  // own internal derivation: `entryFor` below needs it for `colorLabel`
  // regardless of which grouping mode won, not just for bucketing.
  const palette = project.colorPalette ?? DEFAULT_HIGHLIGHT_COLORS;
  const refByDocument = new Map<Id, Reference>();
  for (const reference of references) {
    if (reference.documentId) refByDocument.set(reference.documentId, reference);
  }

  // The bucket order, plus the unplaced complement, is what fixes citation
  // order — delegated to `groupPassages` so the Outline view can group the
  // same annotations identically without re-deriving this logic. Passing
  // `project` (not a separately-resolved `outline`) is what makes the two
  // derivations impossible to get out of sync — see `groupPassages`'s doc
  // comment.
  const { buckets, unplaced: unplacedItems, groupedByColour } = groupPassages(annotations, project);

  // Flatten in exactly the order the draft reads: this becomes the citation
  // order. Record each cited annotation's position in `order` right here, in
  // the same walk — not by re-deriving it later by counting through a
  // second walk that would have to stay in lockstep with this one by
  // construction alone.
  const flat = [...buckets.flatMap((b) => b.items), ...unplacedItems];
  const order: Id[] = [];
  const positionByAnnotationId = new Map<Id, number>();
  for (const annotation of flat) {
    const reference = refByDocument.get(annotation.documentId);
    if (reference) {
      positionByAnnotationId.set(annotation.id, order.length);
      order.push(reference.id);
    }
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

  // `formatRun`'s own contract is "one citation per position in `order` —
  // same length, same order". Trusting that silently (`run.inText[i] ?? ''`)
  // would turn a violation into a blank citation instead of a visible one.
  if (run.inText.length !== order.length) {
    throw new CitationRunLengthMismatchError(order.length, run.inText.length);
  }

  // Looked up by annotation id, not consumed by mutating a shared cursor
  // across two separately-ordered `.map` calls below — reordering those
  // calls (or adding a third) can no longer misalign a citation.
  const citationByAnnotationId = new Map<Id, string>();
  for (const [annotationId, position] of positionByAnnotationId) {
    citationByAnnotationId.set(annotationId, run.inText[position] ?? '');
  }

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
      inTextFormatted: citationByAnnotationId.get(annotation.id) ?? '',
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
