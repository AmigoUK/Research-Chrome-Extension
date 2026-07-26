/**
 * Web-annotation use-cases. Filing is keyed on URL, not DOI: `capturePage`
 * dedups by DOI only, so a DOI-less page annotated twice would otherwise spawn
 * a second document and split its notes. We look up by URL first and only fall
 * through to `capturePage` when nothing matches.
 *
 * Pure — id and clock are injected, storage is reached through the ports.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Annotation, Document, Id, Project, WebAnchor } from '../model/types';
import { capturePage, type CaptureDeps, type CaptureInput } from './capture';

export async function findDocumentByUrl(
  repos: RepositorySet,
  projectId: Id,
  url: string,
): Promise<Document | undefined> {
  const docs = await repos.documents.listByProject(projectId);
  return docs.find((d) => d.url === url);
}

/**
 * No active project yet (side panel never opened, or the stored id is stale)
 * must not orphan data under a falsy/empty project id. Falls back to the
 * first existing project, seeding a default one when the store is empty —
 * mirroring `ensureSeedProject` in src/sidepanel/main.ts.
 */
export async function resolveProjectId(
  repos: RepositorySet,
  projectId: Id | undefined,
  deps: CaptureDeps,
): Promise<Id> {
  if (projectId) {
    const existing = await repos.projects.get(projectId);
    if (existing) return projectId;
  }
  const [first] = await repos.projects.list();
  if (first) return first.id;

  const now = deps.now();
  const seeded: Project = {
    id: deps.newId(),
    name: 'My Research',
    sections: ['Literature', 'Methods', 'Data', 'Report'],
    members: [],
    createdAt: now,
    updatedAt: now,
  };
  await repos.projects.put(seeded);
  return seeded.id;
}

export async function annotateWebPage(
  repos: RepositorySet,
  input: CaptureInput,
  anchor: WebAnchor,
  deps: CaptureDeps,
): Promise<{ document: Document; annotation: Annotation; createdDocument: boolean }> {
  const projectId = await resolveProjectId(repos, input.projectId, deps);
  const effectiveInput = { ...input, projectId };
  const existing = await findDocumentByUrl(repos, projectId, effectiveInput.url);
  let document = existing;
  let createdDocument = false;
  if (!document) {
    const captured = await capturePage(repos, effectiveInput, deps);
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
