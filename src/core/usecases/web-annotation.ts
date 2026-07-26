/**
 * Web-annotation use-cases. Filing is keyed on URL, not DOI: `capturePage`
 * dedups by DOI only, so a DOI-less page annotated twice would otherwise spawn
 * a second document and split its notes. We look up by URL first and only fall
 * through to `capturePage` when nothing matches.
 *
 * Pure — id and clock are injected, storage is reached through the ports.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Annotation, Document, Id, WebAnchor } from '../model/types';
import { capturePage, type CaptureDeps, type CaptureInput } from './capture';

export async function findDocumentByUrl(
  repos: RepositorySet,
  projectId: Id,
  url: string,
): Promise<Document | undefined> {
  const docs = await repos.documents.listByProject(projectId);
  return docs.find((d) => d.url === url);
}

export async function annotateWebPage(
  repos: RepositorySet,
  input: CaptureInput,
  anchor: WebAnchor,
  deps: CaptureDeps,
): Promise<{ document: Document; annotation: Annotation; createdDocument: boolean }> {
  const existing = await findDocumentByUrl(repos, input.projectId, input.url);
  let document = existing;
  let createdDocument = false;
  if (!document) {
    const captured = await capturePage(repos, input, deps);
    document = captured.document;
    createdDocument = !captured.deduped;
  }

  const now = deps.now();
  const annotation: Annotation = {
    id: deps.newId(),
    projectId: document.projectId,
    documentId: document.id,
    anchor,
    content: '',
    tags: [],
    status: 'draft',
    author: 'me',
    createdAt: now,
    updatedAt: now,
  };
  await repos.annotations.put(annotation);
  return { document, annotation, createdDocument };
}
