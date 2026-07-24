/**
 * Project snapshots: the file-based half of Phase 5's collaboration story.
 *
 * A snapshot is the whole project as data — sources, notes, references, styles,
 * people, history and discussion. It is how work travels between machines and
 * collaborators when there is no backend.
 *
 * **PDF bytes are opt-in.** They dwarf everything else, and a snapshot that
 * cannot be emailed is not a way of sharing work, so `includeFiles` is a
 * deliberate choice rather than the default.
 *
 * On import, **references and documents dedup by DOI** — the roadmap's hard
 * rule. A deduped id is remapped, so annotations and threads that pointed at
 * the incoming copy end up on the record that was already here.
 */
import type { RepositorySet } from '../ports/repositories';
import type {
  ActivityEvent,
  Annotation,
  CitationStyle,
  CommentThread,
  Document,
  Id,
  Project,
  Reference,
  User,
} from '../model/types';
import { bytesToBase64, base64ToBytes } from '../files/base64';
import type { CaptureDeps } from './capture';
import { recordActivity } from './activity';

/** A stored file, JSON-safe. Same shape the messaging layer already uses. */
export interface SnapshotFile {
  id: Id;
  name: string;
  mime: string;
  dataBase64: string;
  createdAt: string;
}

export interface SnapshotData {
  project: Project;
  documents: Document[];
  annotations: Annotation[];
  references: Reference[];
  citationStyles: CitationStyle[];
  users: User[];
  activity: ActivityEvent[];
  commentThreads: CommentThread[];
  /** Present only when the export opted into PDF bytes. */
  files?: SnapshotFile[];
}

export interface MergeReport {
  projectName: string;
  /** True when this browser has never seen the project — an import, not a merge. */
  newProject: boolean;
  documents: number;
  annotations: number;
  references: number;
  citationStyles: number;
  users: number;
  activity: number;
  commentThreads: number;
  files: number;
  /** Incoming records folded into an existing one by DOI. */
  dedupedByDoi: number;
  /** Incoming records skipped because the local copy was newer. */
  skippedOlder: number;
}

function doiOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const doi = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//, '');
  return doi || undefined;
}

/** Read the whole project out of storage. */
export async function buildSnapshot(
  repos: RepositorySet,
  projectId: Id,
  options: { includeFiles?: boolean } = {},
): Promise<SnapshotData> {
  const project = await repos.projects.get(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const [documents, annotations, references, citationStyles, users, activity, commentThreads] =
    await Promise.all([
      repos.documents.listByProject(projectId),
      repos.annotations.listByProject(projectId),
      repos.references.listByProject(projectId),
      repos.citationStyles.list(),
      repos.users.list(),
      repos.activity.listByProject(projectId),
      repos.commentThreads.listByProject(projectId),
    ]);

  const data: SnapshotData = {
    project,
    documents,
    annotations,
    references,
    citationStyles,
    users,
    activity,
    commentThreads,
  };

  if (options.includeFiles) {
    const files: SnapshotFile[] = [];
    for (const document of documents) {
      if (!document.fileId) continue;
      const file = await repos.files.get(document.fileId);
      if (!file) continue;
      files.push({
        id: file.id,
        name: file.name,
        mime: file.mime,
        dataBase64: bytesToBase64(file.bytes),
        createdAt: file.createdAt,
      });
    }
    data.files = files;
  }

  return data;
}

/** Shape check — an import must not half-apply a file that is not a snapshot. */
export function assertSnapshotData(value: unknown): asserts value is SnapshotData {
  const data = value as Partial<SnapshotData> | null;
  if (!data || typeof data !== 'object' || !data.project || typeof data.project.id !== 'string') {
    throw new Error('That snapshot has no project in it');
  }
  for (const key of [
    'documents',
    'annotations',
    'references',
    'citationStyles',
    'users',
    'activity',
    'commentThreads',
  ] as const) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`That snapshot is malformed: ${key} is not a list`);
    }
  }
}

/** Newer of the two wins; equal timestamps keep what is already stored. */
function isNewer(incoming: { updatedAt: string }, local: { updatedAt: string }): boolean {
  return incoming.updatedAt > local.updatedAt;
}

/**
 * A merge worked out but not performed: the counts to show, and the writes that
 * would produce them. Planning and applying share this one code path on purpose
 * — a preview that could disagree with the import would be worse than none.
 */
export interface MergePlan {
  report: MergeReport;
  apply(): Promise<void>;
}

export async function planMerge(repos: RepositorySet, data: SnapshotData): Promise<MergePlan> {
  assertSnapshotData(data);
  const writes: Array<() => Promise<void>> = [];
  const report: MergeReport = {
    projectName: data.project.name,
    newProject: false,
    documents: 0,
    annotations: 0,
    references: 0,
    citationStyles: 0,
    users: 0,
    activity: 0,
    commentThreads: 0,
    files: 0,
    dedupedByDoi: 0,
    skippedOlder: 0,
  };

  // --- Project: union the members, keep the newer record otherwise. ---
  const projectId = data.project.id;
  const localProject = await repos.projects.get(projectId);
  if (!localProject) {
    report.newProject = true;
    writes.push(() => repos.projects.put(data.project));
  } else {
    const members = [...localProject.members];
    for (const member of data.project.members) {
      if (!members.some((m) => m.userId === member.userId)) members.push(member);
    }
    const base = isNewer(data.project, localProject) ? data.project : localProject;
    writes.push(() => repos.projects.put({ ...base, members }));
  }

  // --- Users: identity, keyed by id. ---
  for (const user of data.users ?? []) {
    const local = await repos.users.get(user.id);
    const merged = local
      ? { ...local, ...user, rolesPerProject: { ...local.rolesPerProject, ...user.rolesPerProject } }
      : user;
    writes.push(() => repos.users.put(merged));
    report.users++;
  }

  // --- Documents: DOI dedup first, then id. Remap what was folded. ---
  const documentIdMap = new Map<Id, Id>();
  for (const document of data.documents ?? []) {
    const doi = doiOf(document.metadata.doi);
    if (doi) {
      const existing = await repos.documents.findByDoi(projectId, document.metadata.doi ?? '');
      if (existing && existing.id !== document.id) {
        documentIdMap.set(document.id, existing.id);
        report.dedupedByDoi++;
        continue;
      }
    }
    const local = await repos.documents.get(document.id);
    if (local && !isNewer(document, local)) {
      report.skippedOlder++;
      continue;
    }
    writes.push(() => repos.documents.put(document));
    report.documents++;
  }
  const mapDocumentId = (id: Id): Id => documentIdMap.get(id) ?? id;

  // --- References: the same DOI rule the roadmap states. ---
  for (const reference of data.references ?? []) {
    const doi = doiOf(reference.cslData['DOI']);
    if (doi) {
      const existing = await repos.references.findByDoi(projectId, doi);
      if (existing && existing.id !== reference.id) {
        report.dedupedByDoi++;
        continue;
      }
    }
    const local = await repos.references.get(reference.id);
    if (local && !isNewer(reference, local)) {
      report.skippedOlder++;
      continue;
    }
    writes.push(() =>
      repos.references.put({
        ...reference,
        ...(reference.documentId ? { documentId: mapDocumentId(reference.documentId) } : {}),
      }),
    );
    report.references++;
  }

  for (const annotation of data.annotations ?? []) {
    const local = await repos.annotations.get(annotation.id);
    if (local && !isNewer(annotation, local)) {
      report.skippedOlder++;
      continue;
    }
    writes.push(() =>
      repos.annotations.put({ ...annotation, documentId: mapDocumentId(annotation.documentId) }),
    );
    report.annotations++;
  }

  for (const style of data.citationStyles ?? []) {
    if (!(await repos.citationStyles.get(style.id))) {
      writes.push(() => repos.citationStyles.put(style));
      report.citationStyles++;
    }
  }

  for (const thread of data.commentThreads ?? []) {
    const local = await repos.commentThreads.get(thread.id);
    if (local && !isNewer(thread, local)) {
      report.skippedOlder++;
      continue;
    }
    writes.push(() =>
      repos.commentThreads.put({
        ...thread,
        ...(thread.documentId ? { documentId: mapDocumentId(thread.documentId) } : {}),
      }),
    );
    report.commentThreads++;
  }

  // --- History: events are immutable, so a known id is simply already here. ---
  const localActivity = await repos.activity.listByProject(projectId);
  const knownEvents = new Set(localActivity.map((e) => e.id));
  for (const event of data.activity ?? []) {
    if (knownEvents.has(event.id)) continue;
    writes.push(() =>
      repos.activity.put({
        ...event,
        ...(event.entityId ? { entityId: mapDocumentId(event.entityId) } : {}),
      }),
    );
    report.activity++;
  }

  for (const file of data.files ?? []) {
    if (await repos.files.get(file.id)) continue;
    writes.push(() =>
      repos.files.put({
        id: file.id,
        name: file.name,
        mime: file.mime,
        bytes: base64ToBytes(file.dataBase64),
        createdAt: file.createdAt,
      }),
    );
    report.files++;
  }

  return {
    report,
    async apply() {
      for (const write of writes) await write();
    },
  };
}

/**
 * What an import would do, without doing it. The counts come from the same plan
 * the import applies, so the preview cannot promise something else.
 */
export async function previewMerge(
  repos: RepositorySet,
  data: SnapshotData,
): Promise<MergeReport> {
  return (await planMerge(repos, data)).report;
}

export async function mergeSnapshot(
  repos: RepositorySet,
  deps: CaptureDeps,
  data: SnapshotData,
): Promise<MergeReport> {
  const plan = await planMerge(repos, data);
  await plan.apply();

  await recordActivity(repos, deps, {
    projectId: data.project.id,
    kind: 'sync',
    summary: `imported a snapshot of ${data.project.name}`,
    entityLabel: data.project.name,
  });

  return plan.report;
}
