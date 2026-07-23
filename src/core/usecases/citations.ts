/**
 * Citation use-cases: format a project's bibliography or a single reference,
 * using stored `Reference.cslData` and an injected formatter port.
 */
import type { RepositorySet } from '../ports/repositories';
import type { CitationFormatter, CslItem } from '../ports/citation';
import type { Id } from '../model/types';

function toItem(cslData: Record<string, unknown>, id: Id): CslItem {
  return { ...cslData, id };
}

export async function formatProjectBibliography(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { projectId: Id; template: string },
): Promise<string> {
  const references = await repos.references.listByProject(args.projectId);
  const items = references.map((r) => toItem(r.cslData, r.id));
  if (items.length === 0) return '';
  return formatter.bibliography(items, args.template);
}

export async function formatReferenceCitation(
  repos: RepositorySet,
  formatter: CitationFormatter,
  args: { referenceId: Id; template: string },
): Promise<{ inText: string; bibliography: string }> {
  const reference = await repos.references.get(args.referenceId);
  if (!reference) throw new Error(`Reference not found: ${args.referenceId}`);
  const items = [toItem(reference.cslData, reference.id)];
  return {
    inText: formatter.inText(items, args.template),
    bibliography: formatter.bibliography(items, args.template),
  };
}
