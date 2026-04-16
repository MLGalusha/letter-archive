/* ── Reader View V2 types ────────────────────────────────── */

/** Segment classification (admin-assigned per segment) */
export type SegmentClass = 'body' | 'continuation' | 'addition' | 'ignore';

export interface SegmentClassification {
  class: SegmentClass;
  isMapped: boolean;
  mappedLineIds?: string[];
}

/** Per-boundary decision between consecutive source lines */
export type ReaderDecision =
  | 'join_with_space'
  | 'join_remove_hyphen'
  | 'new_paragraph'
  | 'keep_separate_block'
  | 'continues_special_area'
  | 'uncertain';

/** Structural block type for the reader view */
export type ReaderBlockType =
  | 'date'
  | 'salutation'
  | 'paragraph'
  | 'closing'
  | 'signature'
  | 'postscript'
  | 'continuation'
  | 'addition'
  | 'address';

/** Normalized line produced from the canonical transcript */
export interface ReaderSourceLine {
  id: string;
  pageNumber: number;
  order: number;
  text: string;
  isBlank: boolean;
  pageBreakBefore: boolean;
  pageBreakAfter: boolean;
  indentHint: 'none' | 'small' | 'large';
  roleHint?: ReaderBlockType | 'body';
  specialAreaHint?: 'continuation' | 'addition';
}

/** Assembled block for rendering in the public reader view */
export interface ReaderBlock {
  id: string;
  type: ReaderBlockType;
  lineIds: string[];
  text: string;
  alignment?: 'left' | 'indented' | 'right-shifted' | 'aside';
}

/** Boundary decision record (stored for audit) */
export interface BoundaryDecision {
  afterLineId: string;
  decision: ReaderDecision;
}
