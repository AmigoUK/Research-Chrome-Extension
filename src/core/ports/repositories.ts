/**
 * Repository ports — the storage contract the domain core depends on.
 *
 * Implemented by the IndexedDB adapter (`src/adapters/idb`) and mockable in
 * unit tests. No IndexedDB or `chrome.*` types leak through here.
 */
import type {
  Project,
  Document,
  Annotation,
  Reference,
  CitationStyle,
  User,
  Id,
} from '../model/types';

export interface ProjectRepository {
  get(id: Id): Promise<Project | undefined>;
  list(): Promise<Project[]>;
  put(project: Project): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface DocumentRepository {
  get(id: Id): Promise<Document | undefined>;
  listByProject(projectId: Id): Promise<Document[]>;
  /** Find a document in a project by DOI — used to deduplicate on capture. */
  findByDoi(projectId: Id, doi: string): Promise<Document | undefined>;
  put(document: Document): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface AnnotationRepository {
  get(id: Id): Promise<Annotation | undefined>;
  listByDocument(documentId: Id): Promise<Annotation[]>;
  listByProject(projectId: Id): Promise<Annotation[]>;
  put(annotation: Annotation): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface ReferenceRepository {
  get(id: Id): Promise<Reference | undefined>;
  listByProject(projectId: Id): Promise<Reference[]>;
  findByDoi(projectId: Id, doi: string): Promise<Reference | undefined>;
  put(reference: Reference): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface CitationStyleRepository {
  get(id: Id): Promise<CitationStyle | undefined>;
  list(): Promise<CitationStyle[]>;
  put(style: CitationStyle): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface UserRepository {
  get(id: Id): Promise<User | undefined>;
  list(): Promise<User[]>;
  put(user: User): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface RepositorySet {
  projects: ProjectRepository;
  documents: DocumentRepository;
  annotations: AnnotationRepository;
  references: ReferenceRepository;
  citationStyles: CitationStyleRepository;
  users: UserRepository;
}
