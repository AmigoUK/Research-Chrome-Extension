/**
 * Activity feed: the record of what happened in a project.
 *
 * Events are recorded where the change actually happens — the router cases and
 * the use-cases below — never in a UI. A status moved from the side panel, an
 * annotation added in the PDF reader and a role changed in the dashboard all
 * land in the same feed without any surface knowing about it.
 *
 * `from` / `to` carry raw domain values (status ids, role ids); turning those
 * into words is the view's job.
 */
import type { RepositorySet } from '../ports/repositories';
import type {
  ActivityEvent,
  ActivityKind,
  Annotation,
  Document,
  Id,
  ProjectRole,
  Reference,
} from '../model/types';
import { SELF_USER_ID } from '../model/identity';
import type { CaptureDeps } from './capture';

/** How many events the feed reads in one page. */
export const DEFAULT_ACTIVITY_LIMIT = 200;

export interface ActivityInput {
  projectId: Id;
  kind: ActivityKind;
  summary: string;
  entityLabel?: string;
  entityId?: Id;
  from?: string;
  to?: string;
  /** Defaults to the local user — the only actor there is without a backend. */
  actorUserId?: Id;
}

/**
 * Write one event. **Never throws**: the feed records what happened, it does not
 * gate it, so a failed write must not undo an operation that already succeeded.
 */
export async function recordActivity(
  repos: RepositorySet,
  deps: CaptureDeps,
  input: ActivityInput,
): Promise<void> {
  const event: ActivityEvent = {
    id: deps.newId(),
    projectId: input.projectId,
    actorUserId: input.actorUserId ?? SELF_USER_ID,
    kind: input.kind,
    summary: input.summary,
    ...(input.entityLabel ? { entityLabel: input.entityLabel } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.from ? { from: input.from } : {}),
    ...(input.to ? { to: input.to } : {}),
    createdAt: deps.now(),
  };
  try {
    await repos.activity.put(event);
  } catch {
    // Recording is best-effort by design; see the doc comment above.
  }
}

/** A project's events, newest first. */
export function listActivity(
  repos: RepositorySet,
  projectId: Id,
  limit: number = DEFAULT_ACTIVITY_LIMIT,
): Promise<ActivityEvent[]> {
  return repos.activity.listByProject(projectId, limit);
}

/** How a document is named in the feed: its title, else its host. */
export function documentLabel(document: Document): string {
  const title = document.metadata.title?.trim();
  if (title) return title;
  try {
    return new URL(document.url).hostname;
  } catch {
    return document.url;
  }
}

/** How a reference is named in the feed: its CSL title, else its DOI. */
export function referenceLabel(reference: Reference): string {
  const title = reference.cslData['title'];
  if (typeof title === 'string' && title.trim()) return title.trim();
  const doi = reference.cslData['DOI'];
  if (typeof doi === 'string' && doi.trim()) return doi.trim();
  return 'a reference';
}

/**
 * A document was written. A first write is a new source; a later one is only
 * worth an event when the status moved — metadata edits are not news.
 */
export async function recordDocumentPut(
  repos: RepositorySet,
  deps: CaptureDeps,
  previous: Document | undefined,
  next: Document,
): Promise<void> {
  const label = documentLabel(next);
  if (!previous) {
    await recordActivity(repos, deps, {
      projectId: next.projectId,
      kind: 'source',
      summary: `added ${label}`,
      entityLabel: label,
      entityId: next.id,
    });
    return;
  }
  if (previous.status !== next.status) {
    await recordActivity(repos, deps, {
      projectId: next.projectId,
      kind: 'status',
      summary: `moved ${label}`,
      entityLabel: label,
      entityId: next.id,
      from: previous.status,
      to: next.status,
    });
  }
}

async function annotationDocumentLabel(repos: RepositorySet, documentId: Id): Promise<string> {
  const document = await repos.documents.get(documentId);
  return document ? documentLabel(document) : 'a source';
}

export async function recordAnnotationPut(
  repos: RepositorySet,
  deps: CaptureDeps,
  previous: Annotation | undefined,
  next: Annotation,
): Promise<void> {
  const label = await annotationDocumentLabel(repos, next.documentId);
  if (!previous) {
    await recordActivity(repos, deps, {
      projectId: next.projectId,
      kind: 'annotation',
      summary: `added an annotation on ${label}`,
      entityLabel: label,
      entityId: next.id,
    });
    return;
  }
  if (previous.status !== next.status) {
    await recordActivity(repos, deps, {
      projectId: next.projectId,
      kind: 'annotation',
      summary: `reviewed an annotation on ${label}`,
      entityLabel: label,
      entityId: next.id,
      from: previous.status,
      to: next.status,
    });
  }
}

export async function recordAnnotationDelete(
  repos: RepositorySet,
  deps: CaptureDeps,
  previous: Annotation,
): Promise<void> {
  const label = await annotationDocumentLabel(repos, previous.documentId);
  await recordActivity(repos, deps, {
    projectId: previous.projectId,
    kind: 'annotation',
    summary: `removed an annotation on ${label}`,
    entityLabel: label,
    entityId: previous.id,
  });
}

export async function recordReferenceAdded(
  repos: RepositorySet,
  deps: CaptureDeps,
  reference: Reference,
  verb: 'imported' | 'added',
): Promise<void> {
  const label = referenceLabel(reference);
  await recordActivity(repos, deps, {
    projectId: reference.projectId,
    kind: 'reference',
    summary: `${verb} ${label}`,
    entityLabel: label,
    entityId: reference.id,
  });
}

/** The member's display name, falling back to their id when there is no user row. */
async function memberLabel(repos: RepositorySet, userId: Id): Promise<string> {
  const user = await repos.users.get(userId);
  return user?.name ?? userId;
}

export async function recordMemberInvited(
  repos: RepositorySet,
  deps: CaptureDeps,
  args: { projectId: Id; userId: Id; role: ProjectRole },
): Promise<void> {
  const label = await memberLabel(repos, args.userId);
  await recordActivity(repos, deps, {
    projectId: args.projectId,
    kind: 'member',
    summary: `invited ${label}`,
    entityLabel: label,
    entityId: args.userId,
    to: args.role,
  });
}

export async function recordMemberRoleChanged(
  repos: RepositorySet,
  deps: CaptureDeps,
  args: { projectId: Id; userId: Id; from: ProjectRole; to: ProjectRole },
): Promise<void> {
  if (args.from === args.to) return;
  const label = await memberLabel(repos, args.userId);
  await recordActivity(repos, deps, {
    projectId: args.projectId,
    kind: 'member',
    summary: `changed the role of ${label}`,
    entityLabel: label,
    entityId: args.userId,
    from: args.from,
    to: args.to,
  });
}

export async function recordMemberRemoved(
  repos: RepositorySet,
  deps: CaptureDeps,
  args: { projectId: Id; userId: Id },
): Promise<void> {
  const label = await memberLabel(repos, args.userId);
  await recordActivity(repos, deps, {
    projectId: args.projectId,
    kind: 'member',
    summary: `removed ${label} from the project`,
    entityLabel: label,
    entityId: args.userId,
  });
}
