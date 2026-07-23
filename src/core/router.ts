/**
 * Pure message router: maps a typed request to a repository operation.
 *
 * No `chrome.*` here — it takes a RepositorySet and a request and returns a
 * Result, so it is fully unit-testable with in-memory or fake IndexedDB repos.
 */
import type { RepositorySet } from './ports/repositories';
import type { AnyRequest, Result } from './messages';

function ok(data: unknown): { ok: true; data: unknown } {
  return { ok: true, data };
}

export async function handleRequest(repos: RepositorySet, request: AnyRequest): Promise<Result> {
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
