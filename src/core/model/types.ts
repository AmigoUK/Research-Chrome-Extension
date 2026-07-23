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
}

export interface Project {
  id: Id;
  name: string;
  description?: string;
  defaultCitationStyleId?: Id;
  sections: string[];
  members: ProjectMember[];
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

export type ReferenceSource = 'extractedFromPage' | 'importedFromZotero' | 'manual';

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
