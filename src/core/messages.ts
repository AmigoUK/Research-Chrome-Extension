/**
 * Typed message contract between UI surfaces and the service worker.
 *
 * Each message type maps to a request shape and a response data type. This
 * lives in the domain core so both sides share one source of truth.
 */
import type {
  Project,
  Document,
  Annotation,
  Reference,
  CitationStyle,
  ActivityEvent,
  CommentThread,
  Id,
  ProjectRole,
  User,
} from './model/types';
import type { CaptureInput, CaptureResult } from './usecases/capture';
import type { MemberView } from './usecases/members';
import type { ReplyInput, StartThreadInput } from './usecases/comments';

/** File bytes cross the messaging boundary as base64 (JSON-safe). */
export interface FilePayload {
  id: Id;
  name: string;
  mime: string;
  dataBase64: string;
}

export interface MessageMap {
  ping: { req: Record<never, never>; res: 'pong' };
  'projects/list': { req: Record<never, never>; res: Project[] };
  'projects/put': { req: { project: Project }; res: null };
  'documents/get': { req: { id: Id }; res: Document | undefined };
  'documents/put': { req: { document: Document }; res: null };
  'documents/listByProject': { req: { projectId: Id }; res: Document[] };
  'annotations/listByProject': { req: { projectId: Id }; res: Annotation[] };
  'annotations/listByDocument': { req: { documentId: Id }; res: Annotation[] };
  'annotations/put': { req: { annotation: Annotation }; res: null };
  'annotations/delete': { req: { id: Id }; res: null };
  'files/put': { req: { file: FilePayload }; res: null };
  'files/get': { req: { id: Id }; res: FilePayload | undefined };
  'references/listByProject': { req: { projectId: Id }; res: Reference[] };
  'references/put': { req: { reference: Reference }; res: null };
  'references/importByDoi': { req: { projectId: Id; doi: string }; res: Reference };
  'citationStyles/list': { req: Record<never, never>; res: CitationStyle[] };
  'citationStyles/put': { req: { style: CitationStyle }; res: null };
  'citationStyles/delete': { req: { id: Id }; res: null };
  'capture/page': { req: { input: CaptureInput }; res: CaptureResult };
  'citations/bibliography': {
    req: { projectId: Id; template: string; styleId?: Id | undefined };
    res: string;
  };
  'citations/reference': {
    req: { referenceId: Id; template: string; styleId?: Id | undefined };
    res: { inText: string; bibliography: string };
  };
  'citations/document': {
    req: { documentId: Id; template: string; styleId?: Id | undefined };
    res: { inText: string; bibliography: string };
  };
  'citations/preview': {
    req: { style: CitationStyle; items: Array<Record<string, unknown>> };
    res: Array<{ inText: string; bibliography: string }>;
  };
  'citations/compiledCsl': { req: { style: CitationStyle }; res: string };
  'users/list': { req: Record<never, never>; res: User[] };
  'users/put': { req: { user: User }; res: null };
  'members/list': { req: { projectId: Id }; res: MemberView[] };
  'members/invite': {
    req: { projectId: Id; email: string; role: ProjectRole };
    res: MemberView;
  };
  'members/setRole': { req: { projectId: Id; userId: Id; role: ProjectRole }; res: null };
  'members/remove': { req: { projectId: Id; userId: Id }; res: null };
  /** Newest first; `limit` pages the feed (default `DEFAULT_ACTIVITY_LIMIT`). */
  'activity/listByProject': { req: { projectId: Id; limit?: number }; res: ActivityEvent[] };
  /** Open threads first, newest first within each group. */
  'comments/listByProject': { req: { projectId: Id }; res: CommentThread[] };
  'comments/start': { req: { input: StartThreadInput }; res: CommentThread };
  'comments/reply': { req: ReplyInput; res: CommentThread };
  'comments/setResolved': { req: { threadId: Id; resolved: boolean }; res: CommentThread };
  'comments/delete': { req: { threadId: Id }; res: null };
}

export type MessageType = keyof MessageMap;

export type Request<T extends MessageType = MessageType> = { type: T } & MessageMap[T]['req'];

/** Union of every possible request, for exhaustive routing. */
export type AnyRequest = { [T in MessageType]: Request<T> }[MessageType];

export type Result<T extends MessageType = MessageType> =
  { ok: true; data: MessageMap[T]['res'] } | { ok: false; error: string };
