/**
 * Pure message router: maps a typed request to a repository operation.
 *
 * No `chrome.*` here — it takes a RepositorySet and a request and returns a
 * Result, so it is fully unit-testable with in-memory or fake IndexedDB repos.
 */
import type { RepositorySet } from './ports/repositories';
import type { CitationFormatter } from './ports/citation';
import type { AnyRequest, Result } from './messages';
import { capturePage, type CaptureDeps } from './usecases/capture';
import {
  formatProjectBibliography,
  formatReferenceCitation,
  formatDocumentCitation,
} from './usecases/citations';
import { importReferenceByDoi } from './usecases/references';

function ok(data: unknown): { ok: true; data: unknown } {
  return { ok: true, data };
}

const defaultCaptureDeps: CaptureDeps = {
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export interface RouterDeps {
  capture?: CaptureDeps;
  formatter?: CitationFormatter;
}

function requireFormatter(deps: RouterDeps): CitationFormatter {
  if (!deps.formatter) throw new Error('No citation formatter configured');
  return deps.formatter;
}

export async function handleRequest(
  repos: RepositorySet,
  request: AnyRequest,
  deps: RouterDeps = {},
): Promise<Result> {
  const capture = deps.capture ?? defaultCaptureDeps;
  try {
    switch (request.type) {
      case 'ping':
        return ok('pong') as Result;
      case 'projects/list':
        return ok(await repos.projects.list()) as Result;
      case 'projects/put':
        await repos.projects.put(request.project);
        return ok(null) as Result;
      case 'documents/get':
        return ok(await repos.documents.get(request.id)) as Result;
      case 'documents/put':
        await repos.documents.put(request.document);
        return ok(null) as Result;
      case 'documents/listByProject':
        return ok(await repos.documents.listByProject(request.projectId)) as Result;
      case 'annotations/listByProject':
        return ok(await repos.annotations.listByProject(request.projectId)) as Result;
      case 'annotations/put':
        await repos.annotations.put(request.annotation);
        return ok(null) as Result;
      case 'references/listByProject':
        return ok(await repos.references.listByProject(request.projectId)) as Result;
      case 'references/put':
        await repos.references.put(request.reference);
        return ok(null) as Result;
      case 'references/importByDoi':
        return ok(
          await importReferenceByDoi(repos, { projectId: request.projectId, doi: request.doi }),
        ) as Result;
      case 'citationStyles/list':
        return ok(await repos.citationStyles.list()) as Result;
      case 'capture/page':
        return ok(await capturePage(repos, request.input, capture)) as Result;
      case 'citations/bibliography':
        return ok(
          await formatProjectBibliography(repos, requireFormatter(deps), {
            projectId: request.projectId,
            template: request.template,
          }),
        ) as Result;
      case 'citations/reference':
        return ok(
          await formatReferenceCitation(repos, requireFormatter(deps), {
            referenceId: request.referenceId,
            template: request.template,
          }),
        ) as Result;
      case 'citations/document':
        return ok(
          await formatDocumentCitation(repos, requireFormatter(deps), {
            documentId: request.documentId,
            template: request.template,
          }),
        ) as Result;
      default: {
        // Exhaustiveness guard: `request` should be `never` here.
        const unknown: never = request;
        return { ok: false, error: `unknown message: ${JSON.stringify(unknown)}` };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
