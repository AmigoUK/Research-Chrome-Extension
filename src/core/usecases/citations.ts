/**
 * Citation use-cases: format a project's bibliography or a single reference,
 * using stored `Reference.cslData` and an injected formatter port.
 */
import type { RepositorySet } from '../ports/repositories';
import type { CitationFormatter, CslItem } from '../ports/citation';
import type { CitationStyle, Id } from '../model/types';

function toItem(cslData: Record<string, unknown>, id: Id): CslItem {
  return { ...cslData, id };
}

/** Format with a full style when given, else the plain base template. */
function bibliographyWith(
  formatter: CitationFormatter,
  items: CslItem[],
  template: string,
  style?: CitationStyle,
): Promise<string> {
  return style
    ? formatter.formatWithStyle(items, style, 'bibliography')
    : formatter.bibliography(items, template);
}
async function pairWith(
  formatter: CitationFormatter,
  items: CslItem[],
  template: string,
  style?: CitationStyle,
): Promise<{ inText: string; bibliography: string }> {
  const [inText, bibliography] = style
    ? await Promise.all([
        formatter.formatWithStyle(items, style, 'inText'),
        formatter.formatWithStyle(items, style, 'bibliography'),
      ])
    : await Promise.all([formatter.inText(items, template), formatter.bibliography(items, template)]);
  return { inText, bibliography };
}

export async function formatProjectBibliography(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { projectId: Id; template: string; style?: CitationStyle | undefined },
): Promise<string> {
  const references = await repos.references.listByProject(args.projectId);
  const items = references.map((r) => toItem(r.cslData, r.id));
  if (items.length === 0) return '';
  return bibliographyWith(formatter, items, args.template, args.style);
}

export async function formatReferenceCitation(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { referenceId: Id; template: string; style?: CitationStyle | undefined },
): Promise<{ inText: string; bibliography: string }> {
  const reference = await repos.references.get(args.referenceId);
  if (!reference) throw new Error(`Reference not found: ${args.referenceId}`);
  const items = [toItem(reference.cslData, reference.id)];
  return pairWith(formatter, items, args.template, args.style);
}

export async function formatDocumentCitation(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { documentId: Id; template: string; style?: CitationStyle | undefined },
): Promise<{ inText: string; bibliography: string }> {
  const document = await repos.documents.get(args.documentId);
  if (!document) throw new Error(`Document not found: ${args.documentId}`);
  const references = await repos.references.listByProject(document.projectId);
  const reference = references.find((r) => r.documentId === args.documentId);
  if (!reference) throw new Error(`No reference for document: ${args.documentId}`);
  const items = [toItem(reference.cslData, reference.id)];
  return pairWith(formatter, items, args.template, args.style);
}

/** Format ad-hoc sample items through a style — powers the editor's live preview. */
export function formatPreview(
  formatter: CitationFormatter,
  style: CitationStyle,
  items: CslItem[],
): Promise<Array<{ inText: string; bibliography: string }>> {
  return Promise.all(
    items.map(async (item, i) => {
      const withId = [{ ...item, id: `preview-${i}` }];
      const [inText, bibliography] = await Promise.all([
        formatter.formatWithStyle(withId, style, 'inText'),
        formatter.formatWithStyle(withId, style, 'bibliography'),
      ]);
      return { inText, bibliography };
    }),
  );
}
