/**
 * The import boundary: everything a snapshot carries is somebody else's data.
 *
 * A snapshot is the one place in this extension where records arrive from
 * outside — that is the whole point of the feature, and it is why this file
 * exists. Escaping at render is not enough on its own:
 *
 *  - an id reaches HTML attributes *and* `querySelector` strings, and no amount
 *    of HTML-escaping makes `[data-id="x\"><img>"]` a valid selector;
 *  - a status outside the enum silently drops a source out of every Kanban
 *    column, because the board renders known statuses only;
 *  - a timestamp with an offset (`+02:00`) breaks `isNewer`, which compares ISO
 *    strings lexicographically — an *older* record would win the merge.
 *
 * So the file is validated before a single write is planned, and timestamps are
 * normalised to UTC. Import fails closed, naming what is wrong: a snapshot that
 * cannot be trusted in part cannot be trusted in whole.
 */
import { ACTIVITY_KINDS, type SyncMode } from '../model/types';
import { DOCUMENT_STATUSES } from '../model/workflow';
import { ROLES } from '../model/roles';
import type { SnapshotData } from '../usecases/snapshot';

/**
 * Ids we are willing to store. Wide enough for UUIDs, `custom-base:<slug>`,
 * `me`, and the email-shaped ids an early invite could produce — and narrow
 * enough to be safe in an HTML attribute and in a CSS selector.
 */
export const ID_PATTERN = /^[\w.:@+-]{1,128}$/;

const ANNOTATION_STATUSES = ['draft', 'accepted', 'rejected', 'includedInReport'] as const;
const SYNC_MODES: readonly SyncMode[] = ['local', 'file'];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

class SnapshotError extends Error {}

function fail(what: string): never {
  throw new SnapshotError(`That snapshot is malformed: ${what}`);
}

function id(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(`${what} is not a usable id`);
  return value;
}

function text(value: unknown, what: string, max = 4096): string {
  if (typeof value !== 'string') fail(`${what} is not text`);
  if (value.length > max) fail(`${what} is longer than ${max} characters`);
  return value;
}

/** Normalise to UTC, so `isNewer`'s string comparison is meaningful. */
function timestamp(value: unknown, what: string): string {
  if (typeof value !== 'string') fail(`${what} is not a date`);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) fail(`${what} is not a date`);
  return new Date(ms).toISOString();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${what} is not one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function list(value: unknown, what: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${what} is not a list`);
  return value;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${what} is not a record`);
  return value as Record<string, unknown>;
}

/**
 * Validate and normalise a decoded snapshot payload. Returns a fresh object —
 * the caller never merges the raw parse.
 */
export function validateSnapshotData(value: unknown): SnapshotData {
  const data = record(value, 'the snapshot');
  const project = record(data['project'], 'the project');

  const projectId = id(project['id'], 'the project id');
  const members = list(project['members'], 'the member list').map((m, i) => {
    const member = record(m, `member ${i + 1}`);
    return {
      userId: id(member['userId'], `member ${i + 1}'s user id`),
      role: oneOf(member['role'], ROLES, `member ${i + 1}'s role`),
      ...(member['pending'] === true ? { pending: true } : {}),
    };
  });

  const out: SnapshotData = {
    project: {
      ...(project as unknown as SnapshotData['project']),
      id: projectId,
      name: text(project['name'], 'the project name', 512),
      sections: list(project['sections'], 'the section list').map((s, i) =>
        text(s, `section ${i + 1}`, 128),
      ),
      members,
      ...(project['syncMode'] === undefined
        ? {}
        : { syncMode: oneOf(project['syncMode'], SYNC_MODES, 'the sync mode') }),
      createdAt: timestamp(project['createdAt'], 'the project creation date'),
      updatedAt: timestamp(project['updatedAt'], 'the project update date'),
    },

    documents: list(data['documents'], 'the document list').map((d, i) => {
      const doc = record(d, `source ${i + 1}`);
      return {
        ...(doc as unknown as SnapshotData['documents'][number]),
        id: id(doc['id'], `source ${i + 1}'s id`),
        projectId: id(doc['projectId'], `source ${i + 1}'s project id`),
        ...(doc['fileId'] === undefined ? {} : { fileId: id(doc['fileId'], `source ${i + 1}'s file id`) }),
        status: oneOf(doc['status'], DOCUMENT_STATUSES, `source ${i + 1}'s status`),
        metadata: record(doc['metadata'], `source ${i + 1}'s metadata`) as never,
        createdAt: timestamp(doc['createdAt'], `source ${i + 1}'s creation date`),
        updatedAt: timestamp(doc['updatedAt'], `source ${i + 1}'s update date`),
      };
    }),

    annotations: list(data['annotations'], 'the annotation list').map((a, i) => {
      const note = record(a, `annotation ${i + 1}`);
      return {
        ...(note as unknown as SnapshotData['annotations'][number]),
        id: id(note['id'], `annotation ${i + 1}'s id`),
        projectId: id(note['projectId'], `annotation ${i + 1}'s project id`),
        documentId: id(note['documentId'], `annotation ${i + 1}'s source id`),
        author: id(note['author'], `annotation ${i + 1}'s author`),
        status: oneOf(note['status'], ANNOTATION_STATUSES, `annotation ${i + 1}'s status`),
        createdAt: timestamp(note['createdAt'], `annotation ${i + 1}'s creation date`),
        updatedAt: timestamp(note['updatedAt'], `annotation ${i + 1}'s update date`),
      };
    }),

    references: list(data['references'], 'the reference list').map((r, i) => {
      const ref = record(r, `reference ${i + 1}`);
      return {
        ...(ref as unknown as SnapshotData['references'][number]),
        id: id(ref['id'], `reference ${i + 1}'s id`),
        projectId: id(ref['projectId'], `reference ${i + 1}'s project id`),
        ...(ref['documentId'] === undefined
          ? {}
          : { documentId: id(ref['documentId'], `reference ${i + 1}'s source id`) }),
        cslData: record(ref['cslData'], `reference ${i + 1}'s CSL data`),
        createdAt: timestamp(ref['createdAt'], `reference ${i + 1}'s creation date`),
        updatedAt: timestamp(ref['updatedAt'], `reference ${i + 1}'s update date`),
      };
    }),

    citationStyles: list(data['citationStyles'], 'the style list').map((s, i) => {
      const style = record(s, `style ${i + 1}`);
      return {
        ...(style as unknown as SnapshotData['citationStyles'][number]),
        id: id(style['id'], `style ${i + 1}'s id`),
        name: text(style['name'], `style ${i + 1}'s name`, 512),
        baseStyleId: id(style['baseStyleId'], `style ${i + 1}'s base style`),
        userRules: record(style['userRules'], `style ${i + 1}'s rules`) as never,
      };
    }),

    users: list(data['users'], 'the people list').map((u, i) => {
      const user = record(u, `person ${i + 1}`);
      return {
        ...(user as unknown as SnapshotData['users'][number]),
        id: id(user['id'], `person ${i + 1}'s id`),
        name: text(user['name'], `person ${i + 1}'s name`, 512),
        rolesPerProject: record(user['rolesPerProject'] ?? {}, `person ${i + 1}'s roles`) as never,
      };
    }),

    activity: list(data['activity'], 'the history').map((e, i) => {
      const event = record(e, `history entry ${i + 1}`);
      return {
        ...(event as unknown as SnapshotData['activity'][number]),
        id: id(event['id'], `history entry ${i + 1}'s id`),
        projectId: id(event['projectId'], `history entry ${i + 1}'s project id`),
        actorUserId: id(event['actorUserId'], `history entry ${i + 1}'s actor`),
        kind: oneOf(event['kind'], ACTIVITY_KINDS, `history entry ${i + 1}'s kind`),
        summary: text(event['summary'], `history entry ${i + 1}'s summary`),
        ...(event['entityId'] === undefined
          ? {}
          : { entityId: id(event['entityId'], `history entry ${i + 1}'s subject`) }),
        createdAt: timestamp(event['createdAt'], `history entry ${i + 1}'s date`),
      };
    }),

    commentThreads: list(data['commentThreads'], 'the thread list').map((t, i) => {
      const thread = record(t, `thread ${i + 1}`);
      return {
        ...(thread as unknown as SnapshotData['commentThreads'][number]),
        id: id(thread['id'], `thread ${i + 1}'s id`),
        projectId: id(thread['projectId'], `thread ${i + 1}'s project id`),
        ...(thread['documentId'] === undefined
          ? {}
          : { documentId: id(thread['documentId'], `thread ${i + 1}'s source id`) }),
        ...(thread['annotationId'] === undefined
          ? {}
          : { annotationId: id(thread['annotationId'], `thread ${i + 1}'s annotation id`) }),
        anchorLabel: text(thread['anchorLabel'], `thread ${i + 1}'s anchor`, 512),
        resolved: thread['resolved'] === true,
        comments: list(thread['comments'], `thread ${i + 1}'s comments`).map((c, j) => {
          const comment = record(c, `comment ${j + 1} in thread ${i + 1}`);
          return {
            id: id(comment['id'], `comment ${j + 1}'s id in thread ${i + 1}`),
            authorId: id(comment['authorId'], `comment ${j + 1}'s author in thread ${i + 1}`),
            body: text(comment['body'], `comment ${j + 1} in thread ${i + 1}`),
            createdAt: timestamp(comment['createdAt'], `comment ${j + 1}'s date in thread ${i + 1}`),
          };
        }),
        createdAt: timestamp(thread['createdAt'], `thread ${i + 1}'s creation date`),
        updatedAt: timestamp(thread['updatedAt'], `thread ${i + 1}'s update date`),
      };
    }),
  };

  if (data['files'] !== undefined) {
    out.files = list(data['files'], 'the file list').map((f, i) => {
      const file = record(f, `file ${i + 1}`);
      const dataBase64 = text(file['dataBase64'], `file ${i + 1}'s contents`, 200_000_000);
      if (!BASE64.test(dataBase64)) fail(`file ${i + 1}'s contents are not base64`);
      return {
        id: id(file['id'], `file ${i + 1}'s id`),
        name: text(file['name'], `file ${i + 1}'s name`, 512),
        mime: text(file['mime'], `file ${i + 1}'s type`, 128),
        dataBase64,
        createdAt: timestamp(file['createdAt'], `file ${i + 1}'s date`),
      };
    });
  }

  return out;
}
