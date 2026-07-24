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
  formatPreview,
} from './usecases/citations';
import { importReferenceByDoi } from './usecases/references';
import { listMembers, inviteMember, setMemberRole, removeMember } from './usecases/members';
import type { CitationStyle, Id } from './model/types';
import { bytesToBase64, base64ToBytes } from './files/base64';

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

/** Load a citation style by id (for rule-driven formatting), or undefined. */
async function resolveStyle(
  repos: RepositorySet,
  styleId: Id | undefined,
): Promise<CitationStyle | undefined> {
  return styleId ? repos.citationStyles.get(styleId) : undefined;
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
      case 'annotations/listByDocument':
        return ok(await repos.annotations.listByDocument(request.documentId)) as Result;
      case 'annotations/put':
        await repos.annotations.put(request.annotation);
        return ok(null) as Result;
      case 'annotations/delete':
        await repos.annotations.delete(request.id);
        return ok(null) as Result;
      case 'files/put': {
        const { id, name, mime, dataBase64 } = request.file;
        await repos.files.put({
          id,
          name,
          mime,
          bytes: base64ToBytes(dataBase64),
          createdAt: capture.now(),
        });
        return ok(null) as Result;
      }
      case 'files/get': {
        const file = await repos.files.get(request.id);
        if (!file) return ok(undefined) as Result;
        return ok({
          id: file.id,
          name: file.name,
          mime: file.mime,
          dataBase64: bytesToBase64(file.bytes),
        }) as Result;
      }
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
      case 'citationStyles/put':
        await repos.citationStyles.put(request.style);
        return ok(null) as Result;
      case 'citationStyles/delete':
        await repos.citationStyles.delete(request.id);
        return ok(null) as Result;
      case 'capture/page':
        return ok(await capturePage(repos, request.input, capture)) as Result;
      case 'citations/bibliography':
        return ok(
          await formatProjectBibliography(repos, requireFormatter(deps), {
            projectId: request.projectId,
            template: request.template,
            style: await resolveStyle(repos, request.styleId),
          }),
        ) as Result;
      case 'citations/reference':
        return ok(
          await formatReferenceCitation(repos, requireFormatter(deps), {
            referenceId: request.referenceId,
            template: request.template,
            style: await resolveStyle(repos, request.styleId),
          }),
        ) as Result;
      case 'citations/document':
        return ok(
          await formatDocumentCitation(repos, requireFormatter(deps), {
            documentId: request.documentId,
            template: request.template,
            style: await resolveStyle(repos, request.styleId),
          }),
        ) as Result;
      case 'citations/preview':
        return ok(formatPreview(requireFormatter(deps), request.style, request.items)) as Result;
      case 'citations/compiledCsl':
        return ok(requireFormatter(deps).compileStyle(request.style)) as Result;
      case 'users/list':
        return ok(await repos.users.list()) as Result;
      case 'users/put':
        await repos.users.put(request.user);
        return ok(null) as Result;
      case 'members/list':
        return ok(await listMembers(repos, request.projectId)) as Result;
      case 'members/invite':
        return ok(
          await inviteMember(repos, {
            projectId: request.projectId,
            email: request.email,
            role: request.role,
            now: capture.now(),
            userId: capture.newId(),
          }),
        ) as Result;
      case 'members/setRole':
        await setMemberRole(repos, {
          projectId: request.projectId,
          userId: request.userId,
          role: request.role,
          now: capture.now(),
        });
        return ok(null) as Result;
      case 'members/remove':
        await removeMember(repos, {
          projectId: request.projectId,
          userId: request.userId,
          now: capture.now(),
        });
        return ok(null) as Result;
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
