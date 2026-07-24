/**
 * Comment threads: discussion anchored to a document or one of its annotations.
 *
 * A thread is stored whole, comments included, so a reply is one write. Every
 * change is recorded in the activity feed under the `comment` kind, which M2
 * already defined and left unused.
 */
import type { RepositorySet } from '../ports/repositories';
import type { Comment, CommentThread, Id, IsoDateTime } from '../model/types';
import { SELF_USER_ID } from '../model/identity';
import type { CaptureDeps } from './capture';
import { documentLabel, recordActivity } from './activity';

export interface StartThreadInput {
  projectId: Id;
  /** The first message. A thread with nothing said in it is not a thread. */
  body: string;
  documentId?: Id;
  annotationId?: Id;
  /** Where the thread points. Derived from the annotation when omitted. */
  anchorLabel?: string;
  quote?: string;
  authorId?: Id;
}

export interface ReplyInput {
  threadId: Id;
  body: string;
  authorId?: Id;
}

function requireBody(body: string): string {
  const text = body.trim();
  if (!text) throw new Error('A comment cannot be empty');
  return text;
}

async function requireThread(repos: RepositorySet, threadId: Id): Promise<CommentThread> {
  const thread = await repos.commentThreads.get(threadId);
  if (!thread) throw new Error(`Thread not found: ${threadId}`);
  return thread;
}

function makeComment(deps: CaptureDeps, body: string, authorId: Id): Comment {
  return { id: deps.newId(), authorId, body, createdAt: deps.now() as IsoDateTime };
}

/** Open threads first, newest first within each group — the mock's order. */
export function sortThreads(threads: readonly CommentThread[]): CommentThread[] {
  return [...threads].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export async function listThreads(repos: RepositorySet, projectId: Id): Promise<CommentThread[]> {
  return sortThreads(await repos.commentThreads.listByProject(projectId));
}

/** What the feed calls the thing a thread hangs off. */
async function threadSubject(repos: RepositorySet, thread: CommentThread): Promise<string> {
  if (thread.documentId) {
    const document = await repos.documents.get(thread.documentId);
    if (document) return documentLabel(document);
  }
  return thread.anchorLabel;
}

export async function startThread(
  repos: RepositorySet,
  deps: CaptureDeps,
  input: StartThreadInput,
): Promise<CommentThread> {
  const body = requireBody(input.body);
  const authorId = input.authorId ?? SELF_USER_ID;

  let anchorLabel = input.anchorLabel?.trim() ?? '';
  let documentId = input.documentId;
  let quote = input.quote;
  if (input.annotationId) {
    const annotation = await repos.annotations.get(input.annotationId);
    if (!annotation) throw new Error(`Annotation not found: ${input.annotationId}`);
    documentId ??= annotation.documentId;
    quote ??= annotation.content;
    if (!anchorLabel) anchorLabel = 'Annotation';
  }
  if (!anchorLabel) anchorLabel = 'Source';

  const now = deps.now();
  const thread: CommentThread = {
    id: deps.newId(),
    projectId: input.projectId,
    ...(documentId ? { documentId } : {}),
    ...(input.annotationId ? { annotationId: input.annotationId } : {}),
    anchorLabel,
    ...(quote ? { quote } : {}),
    resolved: false,
    comments: [makeComment(deps, body, authorId)],
    createdAt: now,
    updatedAt: now,
  };
  await repos.commentThreads.put(thread);

  const subject = await threadSubject(repos, thread);
  await recordActivity(repos, deps, {
    projectId: thread.projectId,
    kind: 'comment',
    summary: `started a thread on ${subject}`,
    entityLabel: subject,
    entityId: thread.id,
    actorUserId: authorId,
  });
  return thread;
}

export async function replyToThread(
  repos: RepositorySet,
  deps: CaptureDeps,
  input: ReplyInput,
): Promise<CommentThread> {
  const body = requireBody(input.body);
  const thread = await requireThread(repos, input.threadId);
  const authorId = input.authorId ?? SELF_USER_ID;

  const updated: CommentThread = {
    ...thread,
    comments: [...thread.comments, makeComment(deps, body, authorId)],
    updatedAt: deps.now(),
  };
  await repos.commentThreads.put(updated);

  const subject = await threadSubject(repos, updated);
  await recordActivity(repos, deps, {
    projectId: updated.projectId,
    kind: 'comment',
    summary: `replied on ${subject}`,
    entityLabel: subject,
    entityId: updated.id,
    actorUserId: authorId,
  });
  return updated;
}

export async function setThreadResolved(
  repos: RepositorySet,
  deps: CaptureDeps,
  args: { threadId: Id; resolved: boolean },
): Promise<CommentThread> {
  const thread = await requireThread(repos, args.threadId);
  if (thread.resolved === args.resolved) return thread;

  const updated: CommentThread = { ...thread, resolved: args.resolved, updatedAt: deps.now() };
  await repos.commentThreads.put(updated);

  const subject = await threadSubject(repos, updated);
  await recordActivity(repos, deps, {
    projectId: updated.projectId,
    kind: 'comment',
    summary: `${args.resolved ? 'resolved' : 'reopened'} a thread on ${subject}`,
    entityLabel: subject,
    entityId: updated.id,
  });
  return updated;
}

export async function deleteThread(
  repos: RepositorySet,
  deps: CaptureDeps,
  threadId: Id,
): Promise<void> {
  const thread = await requireThread(repos, threadId);
  await repos.commentThreads.delete(threadId);

  const subject = await threadSubject(repos, thread);
  await recordActivity(repos, deps, {
    projectId: thread.projectId,
    kind: 'comment',
    summary: `deleted a thread on ${subject}`,
    entityLabel: subject,
  });
}
