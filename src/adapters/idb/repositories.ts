/**
 * IndexedDB implementations of the repository ports.
 *
 * Thin adapters over a shared `idb` database handle. All DOI/query logic that
 * cannot be expressed as an index (e.g. DOI stored inside opaque CSL JSON) is
 * done here, keeping the domain core storage-agnostic.
 */
import type {
  ProjectRepository,
  DocumentRepository,
  AnnotationRepository,
  ReferenceRepository,
  CitationStyleRepository,
  UserRepository,
  FileRepository,
  RepositorySet,
} from '../../core/ports/repositories';
import type {
  Project,
  Document,
  Annotation,
  Reference,
  CitationStyle,
  User,
  StoredFile,
  Id,
} from '../../core/model/types';
import type { ContextNotesDatabase } from './db';

class IdbProjectRepository implements ProjectRepository {
  constructor(private readonly db: ContextNotesDatabase) {}
  get(id: Id): Promise<Project | undefined> {
    return this.db.get('projects', id);
  }
  list(): Promise<Project[]> {
    return this.db.getAll('projects');
  }
  async put(project: Project): Promise<void> {
    await this.db.put('projects', project);
  }
  async delete(id: Id): Promise<void> {
    await this.db.delete('projects', id);
  }
}

class IdbDocumentRepository implements DocumentRepository {
  constructor(private readonly db: ContextNotesDatabase) {}
  get(id: Id): Promise<Document | undefined> {
    return this.db.get('documents', id);
  }
  listByProject(projectId: Id): Promise<Document[]> {
    return this.db.getAllFromIndex('documents', 'byProject', projectId);
  }
  findByDoi(projectId: Id, doi: string): Promise<Document | undefined> {
    return this.db.getFromIndex('documents', 'byProjectDoi', [projectId, doi]);
  }
  async put(document: Document): Promise<void> {
    await this.db.put('documents', document);
  }
  async delete(id: Id): Promise<void> {
    await this.db.delete('documents', id);
  }
}

class IdbAnnotationRepository implements AnnotationRepository {
  constructor(private readonly db: ContextNotesDatabase) {}
  get(id: Id): Promise<Annotation | undefined> {
    return this.db.get('annotations', id);
  }
  listByDocument(documentId: Id): Promise<Annotation[]> {
    return this.db.getAllFromIndex('annotations', 'byDocument', documentId);
  }
  listByProject(projectId: Id): Promise<Annotation[]> {
    return this.db.getAllFromIndex('annotations', 'byProject', projectId);
  }
  async put(annotation: Annotation): Promise<void> {
    await this.db.put('annotations', annotation);
  }
  async delete(id: Id): Promise<void> {
    await this.db.delete('annotations', id);
  }
}

class IdbReferenceRepository implements ReferenceRepository {
  constructor(private readonly db: ContextNotesDatabase) {}
  get(id: Id): Promise<Reference | undefined> {
    return this.db.get('references', id);
  }
  listByProject(projectId: Id): Promise<Reference[]> {
    return this.db.getAllFromIndex('references', 'byProject', projectId);
  }
  async findByDoi(projectId: Id, doi: string): Promise<Reference | undefined> {
    // DOI lives inside opaque CSL JSON (`cslData.DOI`), so filter in memory.
    const inProject = await this.listByProject(projectId);
    return inProject.find((r) => normaliseDoi(r.cslData['DOI']) === normaliseDoi(doi));
  }
  async put(reference: Reference): Promise<void> {
    await this.db.put('references', reference);
  }
  async delete(id: Id): Promise<void> {
    await this.db.delete('references', id);
  }
}

class IdbCitationStyleRepository implements CitationStyleRepository {
  constructor(private readonly db: ContextNotesDatabase) {}
  get(id: Id): Promise<CitationStyle | undefined> {
    return this.db.get('citationStyles', id);
  }
  list(): Promise<CitationStyle[]> {
    return this.db.getAll('citationStyles');
  }
  async put(style: CitationStyle): Promise<void> {
    await this.db.put('citationStyles', style);
  }
  async delete(id: Id): Promise<void> {
    await this.db.delete('citationStyles', id);
  }
}

class IdbUserRepository implements UserRepository {
  constructor(private readonly db: ContextNotesDatabase) {}
  get(id: Id): Promise<User | undefined> {
    return this.db.get('users', id);
  }
  list(): Promise<User[]> {
    return this.db.getAll('users');
  }
  async put(user: User): Promise<void> {
    await this.db.put('users', user);
  }
  async delete(id: Id): Promise<void> {
    await this.db.delete('users', id);
  }
}

class IdbFileRepository implements FileRepository {
  constructor(private readonly db: ContextNotesDatabase) {}
  get(id: Id): Promise<StoredFile | undefined> {
    return this.db.get('files', id);
  }
  async put(file: StoredFile): Promise<void> {
    await this.db.put('files', file);
  }
  async delete(id: Id): Promise<void> {
    await this.db.delete('files', id);
  }
}

function normaliseDoi(doi: unknown): string | undefined {
  if (typeof doi !== 'string') return undefined;
  return doi
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//, '');
}

export function createRepositories(db: ContextNotesDatabase): RepositorySet {
  return {
    projects: new IdbProjectRepository(db),
    documents: new IdbDocumentRepository(db),
    annotations: new IdbAnnotationRepository(db),
    references: new IdbReferenceRepository(db),
    citationStyles: new IdbCitationStyleRepository(db),
    users: new IdbUserRepository(db),
    files: new IdbFileRepository(db),
  };
}
