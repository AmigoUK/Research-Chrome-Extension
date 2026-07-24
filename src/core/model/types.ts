/**
 * Logical data model (mirrors doc/data-model.md).
 *
 * Pure types — no `chrome.*` and no storage concerns. The IndexedDB adapter
 * in `src/adapters/idb` persists these; the schema is versioned separately.
 */
import type { DocumentStatus } from './workflow';

export type Id = string;
export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// Anchoring — a list of strategies with a defined fallback order, keyed by
// document kind. See data-model.md → Annotation.anchor.
// ---------------------------------------------------------------------------

/** Quoted text plus surrounding context (W3C TextQuoteSelector). */
export interface TextQuoteSelector {
  type: 'textQuote';
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** Character offsets within the document's text (W3C TextPositionSelector). */
export interface TextPositionSelector {
  type: 'textPosition';
  start: number;
  end: number;
}

/** A DOM element locator for reflowable pages. */
export interface CssSelector {
  type: 'css';
  value: string;
}

/** A rectangle on a PDF page, expressed as fractions (0–1) of the page box. */
export interface PdfRect {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Fraction-coordinate (0–1) rectangles on a PDF page, plus an optional quote. */
export interface PdfRegionSelector {
  type: 'pdfRegion';
  page: number;
  rects: PdfRect[];
  quote?: string;
}

/**
 * Anchor for a reflowable web page: resolved in order
 * textQuote → textPosition → css.
 */
export interface WebAnchor {
  kind: 'web';
  selectors: Array<TextQuoteSelector | TextPositionSelector | CssSelector>;
}

/** Anchor for a fixed-layout PDF: page + percent-coordinate rects. */
export interface PdfAnchor {
  kind: 'pdf';
  selectors: PdfRegionSelector[];
}

export type Anchor = WebAnchor | PdfAnchor;

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export type ProjectRole = 'owner' | 'editor' | 'viewer';

export interface ProjectMember {
  userId: Id;
  role: ProjectRole;
  /** Invited but not yet accepted — no device of theirs holds the data yet. */
  pending?: boolean;
}

/**
 * How a project travels between machines. `backend` is deliberately absent:
 * this build has no server, and the Team view says so rather than offering a
 * mode that cannot work.
 */
export type SyncMode = 'local' | 'file';

export interface Project {
  id: Id;
  name: string;
  description?: string;
  defaultCitationStyleId?: Id;
  sections: string[];
  members: ProjectMember[];
  /** Defaults to `local` when absent — projects created before Phase 5 M4. */
  syncMode?: SyncMode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type DocumentType = 'article' | 'report' | 'dataset' | 'foi' | 'case' | 'webPage' | 'pdf';

/** Stored binary payload (e.g. a PDF), referenced by `Document.fileId`. */
export interface StoredFile {
  id: Id;
  name: string;
  mime: string;
  bytes: ArrayBuffer;
  createdAt: IsoDateTime;
}

export interface DocumentMetadata {
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  journal?: string;
  publisher?: string;
  identifiers?: Record<string, string>;
}

export interface Document {
  id: Id;
  projectId: Id;
  url: string;
  fileId?: Id;
  type: DocumentType;
  metadata: DocumentMetadata;
  status: DocumentStatus;
  section?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type AnnotationStatus = 'draft' | 'accepted' | 'rejected' | 'includedInReport';

export interface Annotation {
  id: Id;
  projectId: Id;
  documentId: Id;
  anchor: Anchor;
  content: string;
  tags: string[];
  status: AnnotationStatus;
  author: Id;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ReferenceSource =
  | 'extractedFromPage'
  | 'importedByDoi'
  | 'importedFromZotero'
  | 'manual';

export interface Reference {
  id: Id;
  projectId: Id;
  documentId?: Id;
  /** CSL JSON. Kept opaque here; formatting happens in the citation layer. */
  cslData: Record<string, unknown>;
  source: ReferenceSource;
  usedInOutputs: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type CitationSystem = 'authorDate' | 'footnote' | 'numeric';

export interface CitationUserRules {
  system: CitationSystem;
  maxAuthors: number;
  etAlUseFirst: number;
  nameAnd: 'symbol' | 'text';
  includeDoi: boolean;
  doiAsUri: boolean;
  includeUrl: boolean;
  includeIssue: boolean;
  pagePrefix: boolean;
  foiTemplate: boolean;
  legalTemplate: boolean;
}

/**
 * A CSL style imported from a file, usable as a base style alongside the six
 * vendored ones. The XML is stored verbatim — it is data, not code.
 */
export interface CustomBaseStyle {
  /** `custom-base:<slug>`, so an id says where the style came from. */
  id: Id;
  name: string;
  xml: string;
  /** The citation system the file declares, read at import time. */
  system: CitationSystem;
  createdAt: IsoDateTime;
}

export interface CitationStyle {
  id: Id;
  name: string;
  baseStyleId: string;
  cslOverride?: Record<string, unknown>;
  userRules: CitationUserRules;
}

export interface User {
  id: Id;
  name: string;
  email?: string;
  rolesPerProject: Record<Id, ProjectRole>;
}

/** One message in a thread. Threads are stored whole, so this is not an entity. */
export interface Comment {
  id: Id;
  authorId: Id;
  body: string;
  createdAt: IsoDateTime;
}

/**
 * A discussion anchored to something in the project — a document, or one of its
 * annotations. Comments are embedded rather than stored separately: the UI only
 * ever reads a thread whole, and a reply is then one atomic write.
 */
export interface CommentThread {
  id: Id;
  projectId: Id;
  documentId?: Id;
  /** Set when the thread hangs off an annotation rather than the document. */
  annotationId?: Id;
  /** Where the thread points, in words — e.g. `p. 2` or a quoted phrase. */
  anchorLabel: string;
  /** The passage under discussion, shown under the anchor. */
  quote?: string;
  resolved: boolean;
  comments: Comment[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * What kind of change an activity event records. The feed's filter chips are
 * built from the kinds actually present in the data, never from this list, so
 * a project only ever shows the kinds it has.
 */
export const ACTIVITY_KINDS = [
  'source',
  'status',
  'annotation',
  'comment',
  'reference',
  'member',
  'sync',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** One recorded change in a project's history — the activity feed's unit. */
export interface ActivityEvent {
  id: Id;
  projectId: Id;
  actorUserId: Id;
  kind: ActivityKind;
  /** Plain text, e.g. `moved Gasparrini et al. 2015 forward`. Escaped at render. */
  summary: string;
  /** The part of `summary` to emphasise (document title, member name). */
  entityLabel?: string;
  /** The entity the event is about — documentId / annotationId / userId. */
  entityId?: Id;
  /** Raw domain values (status ids, role ids), never display labels. */
  from?: string;
  to?: string;
  createdAt: IsoDateTime;
}
