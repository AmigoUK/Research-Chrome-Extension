/**
 * Capture use-case: turn an extracted page into a Document + Reference,
 * deduplicating by DOI within the project.
 *
 * Pure and deterministic — id and clock are injected so it is unit-testable.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Document, DocumentMetadata, DocumentType, Id, Reference } from '../model/types';
import { toCslData } from '../extract/metadata';

export interface CaptureDeps {
  newId: () => string;
  now: () => string;
}

export interface CaptureInput {
  projectId: Id;
  url: string;
  type: DocumentType;
  metadata: DocumentMetadata;
  section?: string;
}

export interface CaptureResult {
  document: Document;
  reference: Reference;
  /** True when an existing document with the same DOI was reused. */
  deduped: boolean;
}

export async function capturePage(
  repos: RepositorySet,
  input: CaptureInput,
  deps: CaptureDeps,
): Promise<CaptureResult> {
  const doi = input.metadata.doi;

  if (doi) {
    const existing = await repos.documents.findByDoi(input.projectId, doi);
    if (existing) {
      const reference =
        (await repos.references.findByDoi(input.projectId, doi)) ??
        (await createReference(repos, existing, input, deps));
      return { document: existing, reference, deduped: true };
    }
  }

  const now = deps.now();
  const document: Document = {
    id: deps.newId(),
    projectId: input.projectId,
    url: input.url,
    type: input.type,
    metadata: input.metadata,
    status: 'toRead',
    ...(input.section ? { section: input.section } : {}),
    createdAt: now,
    updatedAt: now,
  };
  const reference = await createReference(repos, document, input, deps);
  await repos.documents.put(document);
  return { document, reference, deduped: false };
}

async function createReference(
  repos: RepositorySet,
  document: Document,
  input: CaptureInput,
  deps: CaptureDeps,
): Promise<Reference> {
  const now = deps.now();
  const reference: Reference = {
    id: deps.newId(),
    projectId: input.projectId,
    documentId: document.id,
    cslData: toCslData(input.metadata, input.url),
    source: 'extractedFromPage',
    usedInOutputs: [],
    createdAt: now,
    updatedAt: now,
  };
  await repos.references.put(reference);
  return reference;
}
