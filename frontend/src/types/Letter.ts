// src/types/Letter.ts

export type LetterStatus =
  | 'uploaded'
  | 'processing'
  | 'processed'
  | 'needs_review'
  | 'published'
  | 'hidden';

export type WorkflowState =
  | 'UPLOADED'
  | 'TRANSCRIBING'
  | 'TRANSCRIBED'
  | 'METADATA_EXTRACTING'
  | 'METADATA_DRAFTED'
  | 'REVIEWED';

export type WorkflowFilterValue = WorkflowState;

export type VisibilityState = 'PUBLISHED' | 'HIDDEN';

// Two-track content status system
export type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

export type JobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export type DateConfidence = 'exact' | 'unknown' | 'inferred';

export type NoteCategory =
  | 'identity'
  | 'date'
  | 'transcription'
  | 'relationship'
  | 'context'
  | 'cross-reference'
  | 'location'
  | 'condition';

export type NotePriority = 'high' | 'medium' | 'low';

export type NoteResolutionTrigger =
  | 'sender_filled'
  | 'recipient_filled'
  | 'date_confirmed'
  | 'date_conflict_resolved'
  | 'location_filled'
  | 'relationship_set'
  | 'transcription_edited';

export interface StructuredNote {
  id: string;
  content: string;
  category: NoteCategory;
  priority: NotePriority;
  status: 'open' | 'resolved' | 'dismissed';
  resolves_when: NoteResolutionTrigger | null;
  resolved_at: string | null;
  resolved_by: string | null;
  source: 'ai' | 'admin';
}

export type StructuredNoteDraft = Pick<
  StructuredNote,
  'content' | 'category' | 'priority'
>;

// V2 Metadata types
export type EmotionalTone =
  | 'joyful'
  | 'affectionate'
  | 'hopeful'
  | 'grateful'
  | 'matter-of-fact'
  | 'nostalgic'
  | 'anxious'
  | 'sad'
  | 'angry';

export type RelationshipType =
  | 'spouse'
  | 'romantic-partner'
  | 'parent-child'
  | 'sibling'
  | 'extended-family'
  | 'friend'
  | 'acquaintance'
  | 'professional'
  | 'institutional'
  | 'unknown';

export type PersonRelationshipType =
  | 'spouse'
  | 'fiancé/fiancée'
  | 'romantic-partner'
  | 'parent-child'
  | 'sibling'
  | 'grandparent-grandchild'
  | 'aunt-uncle-niece-nephew'
  | 'cousin'
  | 'in-law'
  | 'friend'
  | 'acquaintance'
  | 'business-associate'
  | 'employer-employee'
  | 'unknown';

export type PersonRole = 'sender' | 'recipient' | 'mentioned';
export type PlaceRole = 'written_from' | 'mentioned' | 'destination';
export type PlaceType = 'city' | 'region' | 'country' | 'street' | 'landmark' | 'other';

// Entity types for linked persons/places
export interface LinkedPerson {
  id: string;
  personId: string;
  canonicalName: string;
  role: PersonRole;
  nameAsWritten?: string;
  relationshipToSender?: string;
  context?: string;
  confidence: number;
}

export interface LinkedPlace {
  id: string;
  placeId: string;
  canonicalName: string;
  role: PlaceRole;
  placeType?: PlaceType;
  nameAsWritten?: string;
  context?: string;
  confidence: number;
}

// Notable quote type
export interface NotableQuote {
  text: string;
  context?: string;
  position?: 'opening' | 'middle' | 'closing';
}

export type LetterImageType =
  | 'letter'
  | 'photo'
  | 'ephemera'
  | 'voice'
  | 'article'
  | 'diary'
  | 'cover'
  | 'card'
  | 'telegram';

export interface ExtraContentItem {
  type: LetterImageType;
  label: string;
  transcript: string;
  imageIds: string[];
}

// Segment system types
export type SegmentTrustState = 'unverified' | 'trusted';
export type SegmentClass = 'body' | 'continuation' | 'addition' | 'ignore';
export type LineGeometryType = 'baseline' | 'bbox';
export type SegmentGeometrySource =
  | 'machine'
  | 'human-created'
  | 'human-adjusted';
export type SegmentGeometryOperation =
  | 'detected'
  | 'create-box'
  | 'create-polygon'
  | 'create-freehand'
  | 'duplicate'
  | 'resize'
  | 'move'
  | 'move-vertex'
  | 'add-vertex'
  | 'delete-vertex'
  | 'reshape'
  | 'rotate'
  | 'extend'
  | 'subtract'
  | 'delete';

export interface SegmentGeometryProvenance {
  /** Whether the current outline is detector-owned, newly drawn, or adjusted by a reviewer. */
  source: SegmentGeometrySource;
  /** The detector/default state or most recent human geometry operation. */
  operation: SegmentGeometryOperation;
  /** Stable source IDs retained across adjustments, duplication, and future composition. */
  parentSegmentIds: string[];
}

export type PageLayoutDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'top-to-bottom'
  | 'bottom-to-top'
  | 'mixed'
  | 'unknown';
export type PageLayoutTextDirection =
  | 'horizontal-lr'
  | 'horizontal-rl'
  | 'vertical-lr'
  | 'vertical-rl';
export type PageLayoutJsonValue =
  | null
  | boolean
  | number
  | string
  | PageLayoutJsonValue[]
  | { [key: string]: PageLayoutJsonValue };

export interface LineSegmentWord {
  text: string;
  bbox: [number, number, number, number];
}

export interface LineSegment {
  /** Stable detector/editor identity. Legacy records may not have one yet. */
  id?: string;
  line: number;
  /** Undefined for native bbox-only records. */
  geometryType?: LineGeometryType;
  providerId?: string;
  providerOrdinal?: number;
  providerTextDirection?: PageLayoutTextDirection;
  baseline?: number[][];
  bbox: [number, number, number, number];
  /** Records whether bbox is provider geometry or a derived display hitbox. */
  bboxSource?: string;
  /** Review ownership and lineage for the persisted geometry. */
  geometryProvenance?: SegmentGeometryProvenance;
  ocrText: string;
  words?: LineSegmentWord[];
  boundary?: { x: number; y: number }[];
  /** Kraken 6 compatibility metadata retained until legacy records migrate. */
  group?: number | null;
  regionIds?: string[];
  excluded?: boolean;
  segmentClass?: SegmentClass;
  isMapped?: boolean;
  mappedText?: string;
}

export interface MergedLineSegment extends LineSegment {
  merged: boolean;
  constituents: LineSegment[];
}

export interface PageLayoutPoint {
  x: number;
  y: number;
}

export interface PageLayoutBoundingBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface PageLayoutWord {
  id: string;
  text: string;
  boundingBox: PageLayoutBoundingBox;
}

interface PageLayoutLineCommon {
  id: string;
  providerId?: string;
  providerOrdinal?: number;
  text: string | null;
  direction: PageLayoutDirection;
  providerTextDirection?: PageLayoutTextDirection;
  baseDirection?: 'L' | 'R' | null;
  tags?: Record<string, PageLayoutJsonValue> | null;
  regionIds?: string[];
  unresolvedProviderRegionIds?: PageLayoutJsonValue[];
  language?: string[] | null;
  words?: PageLayoutWord[];
  sourceLineNumber?: number;
  displayExtent?: {
    boundingBox: PageLayoutBoundingBox | null;
    source: string;
    derived: boolean;
  };
}

export interface PageLayoutBaselineLine extends PageLayoutLineCommon {
  kind: 'baseline';
  baseline: PageLayoutPoint[];
  boundary?: PageLayoutPoint[];
  boundingBox?: PageLayoutBoundingBox;
}

export interface PageLayoutBboxLine extends PageLayoutLineCommon {
  kind: 'bbox';
  boundingBox: PageLayoutBoundingBox;
}

export type PageLayoutLine = PageLayoutBaselineLine | PageLayoutBboxLine;

export interface PageLayoutRegion {
  id: string;
  providerId?: string;
  providerOrdinal?: number;
  type: string;
  boundary: PageLayoutPoint[];
  lineIds: string[];
  tags?: Record<string, PageLayoutJsonValue> | null;
  language?: string[] | null;
}

export interface PageLayoutReadingOrderPath {
  id: string;
  direction: PageLayoutDirection;
  lineIds: string[];
  source?: 'provider' | 'geometry' | 'legacy' | 'human';
  providerOrdinal?: number;
  providerIndices?: number[];
  providerMappingComplete?: boolean;
  complete?: boolean;
}

export interface PageLayoutV2 {
  schemaVersion: 2;
  layoutId: string;
  runId: string;
  pageId: string;
  image: {
    width: number;
    height: number;
    checksumSha256: string;
    rasterChecksumSha256?: string;
    rasterChecksumAlgorithm?: 'sha256-rgb8-v1';
    coordinateSpace: {
      unit: 'pixel';
      origin: 'top-left';
      xAxis: 'right';
      yAxis: 'down';
    };
    source?: {
      width: number;
      height: number;
      checksumSha256: string;
      mode: string;
      exifOrientation: number | null;
    };
    normalization?: {
      operation: string;
      applied: boolean;
      exifReadError: boolean;
    };
  };
  provenance: {
    producer: {
      name: string;
      version: string;
      api?: string;
      providerRunId?: string;
    };
    model: {
      name: string;
      version: string;
      checksumSha256: string;
      kind?: string;
      sizeBytes?: number;
    };
    config: {
      name: string;
      version: string;
      checksumSha256: string;
      parameters?: Record<string, PageLayoutJsonValue>;
    };
  };
  lineRepresentation: 'baselines' | 'bbox' | 'mixed';
  textDirection: PageLayoutTextDirection;
  scriptDetection: boolean;
  language: string[] | null;
  pageBoundary?: PageLayoutPoint[];
  lines: PageLayoutLine[];
  regions: PageLayoutRegion[];
  readingOrder: {
    primary: PageLayoutReadingOrderPath;
    alternatives: PageLayoutReadingOrderPath[];
  };
}

export interface LetterImage {
  id: string;
  type: LetterImageType;
  pageNumber?: number; // only for letter pages
  imageUrl: string;
  originalFilename?: string;
  sourceChecksum?: string;
  width?: number;
  height?: number;
  lineSegments?: LineSegment[];
  geometryRevision?: number;
  geometryChecksumSha256?: string | null;
  lineSegmentsChecksumSha256?: string | null;
  pageLayout?: PageLayoutV2;
  pageLayoutChecksumSha256?: string;
  segmentTrustState?: SegmentTrustState;
}

/**
 * Image fields intentionally exposed by the public letter API.
 *
 * Keep this separate from LetterImage: filenames, OCR geometry, and review
 * state belong to the admin contract even though both shapes render through
 * the same image components.
 */
export interface PublicLetterImage {
  id: string;
  type: LetterImageType;
  pageNumber?: number;
  imageUrl: string;
  width?: number;
  height?: number;
}

export interface LetterCardData {
  id: string;
  title?: string;
  imageUrl?: string;
  imageType: LetterImageType;
  primaryChip?: string;
  sender?: string;
  recipient?: string;
  collectionCode?: string;
  createdAt?: string;
  date?: string;
  dateRaw?: string;
  hook?: string;
  searchPreview?: ArchiveSearchPreview;
}

export interface ArchiveShelfItem extends LetterCardData {
  location?: string;
  verified: boolean;
  searchText?: string;
}

export interface ArchiveSearchHighlightRange {
  start: number;
  end: number;
}

export interface ArchiveSearchPreview {
  excerpt: string;
  matchCount: number;
  highlightRanges: ArchiveSearchHighlightRange[];
  matchedFieldLabel: string;
  hookHighlightRanges?: ArchiveSearchHighlightRange[];
}

export interface ArchiveFacetValue {
  value: string;
  count: number;
}

export interface ArchiveFormatFacet {
  value: LetterImageType;
  label: string;
  count: number;
}

export interface ArchiveCollectionFacet {
  value: string;
  label: string;
  count: number;
}

export interface ArchiveYearFacet {
  value: number;
  count: number;
}

export interface ArchiveSearchFacets {
  formats: ArchiveFormatFacet[];
  collections: ArchiveCollectionFacet[];
  correspondents: ArchiveFacetValue[];
  places: ArchiveFacetValue[];
  years: ArchiveYearFacet[];
  topics: ArchiveFacetValue[];
  tones: ArchiveFacetValue[];
  relationships: ArchiveFacetValue[];
}

export interface LetterMetadata {
  sender?: string;
  recipient?: string;
  date?: string;
  extractedDate?: string;
  dateRaw?: string;
  dateConfidence?: DateConfidence;
  location?: string;
  hook?: string;
  description?: string;
  /** Hook with «SENDER:...»/«RECIPIENT:...» tags for admin display */
  taggedHook?: string;
  /** Summary with «SENDER:...»/«RECIPIENT:...» tags for admin display */
  taggedDescription?: string;
  tags?: string[];
  notes?: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
  firstPageFilename?: string;
  // V2 metadata fields
  emotionalTone?: EmotionalTone;
  senderRecipientRelationship?: RelationshipType;
  primaryTopics?: string[];
  notableQuotes?: NotableQuote[];
}

export interface LetterPageTranscript {
  pageNumber: number;
  text: string;
  confidence?: number;
}

export type TranscriptLineRole = 'date' | 'salutation' | 'body' | 'closing' | 'signature' | 'postscript' | 'margin-note' | 'address';

export type SpecialAreaType = 'continuation' | 'addition';
export type SpecialAreaPosition = 'top' | 'bottom' | 'left-margin' | 'right-margin' | 'corner' | 'between-lines';
export type SpecialAreaOrientation = 'normal' | 'sideways-left' | 'sideways-right' | 'inverted';

export interface SpecialArea {
  id: number;
  label: string;
  type: SpecialAreaType;
  position: SpecialAreaPosition;
  orientation: SpecialAreaOrientation;
  continuesFromLine: number | null;
  readingOrder: number | null;
}

export interface TranscriptLine {
  text: string;
  x: number;
  paragraph: number | null;
  continues: boolean;
  role: TranscriptLineRole | null;
  areaId?: number | null;
}

export interface StructuredPage {
  pageNumber: number;
  lines: TranscriptLine[];
  specialAreas?: SpecialArea[];
}

export interface LetterTranscript {
  pages: LetterPageTranscript[];
  fullText: string;
  verified: boolean;
  structuredPages?: StructuredPage[];
}

/** Public transcript projection. Raw structured OCR lines are admin-only. */
export interface PublicLetterTranscript {
  pages: LetterPageTranscript[];
  fullText: string;
  verified: boolean;
}

/** Metadata fields deliberately allowed across the public API boundary. */
export interface PublicLetterMetadata {
  sender?: string;
  recipient?: string;
  date?: string;
  dateRaw?: string;
  dateConfidence?: DateConfidence;
  location?: string;
  hook?: string;
  description?: string;
  tags?: string[];
  verified: boolean;
  emotionalTone?: EmotionalTone;
  senderRecipientRelationship?: RelationshipType;
  primaryTopics?: string[];
  notableQuotes?: NotableQuote[];
}

export interface PublicLinkedPerson {
  personId: string;
  canonicalName: string;
  role: string;
}

export interface PublicLinkedPlace {
  placeId: string;
  canonicalName: string;
  role: string;
}

export interface PublicExtraContentItem {
  type: LetterImageType;
  label: string;
  transcript: string;
  imageIds: string[];
}

/**
 * Positive public letter contract. Admin workflow, verification identities,
 * extraction state, flags, raw OCR geometry, and filenames are absent by
 * design rather than represented as optional fields.
 */
export interface PublicLetter {
  id: string;
  title: string;
  collectionCode?: string;
  images: PublicLetterImage[];
  transcript: PublicLetterTranscript;
  metadata: PublicLetterMetadata;
  status: 'published';
  visibility: 'PUBLISHED';
  transcriptPublished: boolean;
  metadataPublished: boolean;
  transcriptStatus: ContentStatus;
  metadataContentStatus: ContentStatus;
  extraContentTranscript?: string;
  extraContentItems?: PublicExtraContentItem[];
  extraContentStatus: ContentStatus;
  photoDescription?: string;
  photoDescriptionStatus?: ContentStatus;
  readingText?: string;
  linkedPersons?: PublicLinkedPerson[];
  linkedPlaces?: PublicLinkedPlace[];
  createdAt: string;
  updatedAt?: string;
}

export type AdminLetterPageCountsByType = Readonly<
  Record<LetterImageType, number>
>;

/**
 * Positive read model owned by the paginated admin Dashboard list.
 *
 * Detail content and provenance deliberately remain on `Letter`; the list exposes
 * only the facts needed to render rows and issue source-bound Dashboard actions.
 */
export interface AdminLetterSummary {
  id: string;
  title: string;
  collectionCode: string;
  primarySourceRevision: number;
  primaryImageType: LetterImageType;
  pageCountsByType: AdminLetterPageCountsByType;
  metadata: {
    sender?: string;
    recipient?: string;
    dateRaw: string;
  };
  visibility: VisibilityState;
  transcriptPublished: boolean;
  metadataPublished: boolean;
  transcriptStatus: ContentStatus;
  metadataContentStatus: ContentStatus;
  extraContentStatus: ContentStatus;
  photoDescriptionStatus: ContentStatus;
  metadataJobStatus: JobStatus;
  transcriptDigest: string;
  transcriptConfirmed: boolean;
  flagged: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

export interface Letter {
  id: string;
  title: string;
  collectionCode?: string;
  primarySourceRevision: number;
  /** Revision-bound transcript identity returned by the admin detail API. */
  transcriptRevision?: number;
  /** SHA-256 of the exact persisted UTF-8 transcript, when supplied. */
  transcriptChecksumSha256?: string;
  images: LetterImage[];
  transcript: LetterTranscript;
  metadata: LetterMetadata;
  status: LetterStatus;
  workflowState: WorkflowState;
  visibility: VisibilityState;
  transcriptPublished: boolean;
  metadataPublished: boolean;
  // Two-track content status system
  transcriptStatus: ContentStatus;
  metadataContentStatus: ContentStatus;
  /** Opaque identity for the currently accepted transcript confirmation. */
  transcriptConfirmationId?: string;
  /**
   * Durable metadata job state exposed by the admin-detail/list read model.
   * Optional during the additive backend/frontend rollout.
   */
  metadataJobStatus?: JobStatus;
  transcriptVerifiedAt?: string;
  transcriptVerifiedBy?: string;
  metadataVerifiedAt?: string;
  metadataVerifiedBy?: string;
  // Extra content transcription (telegrams, covers, ephemera)
  extraContentTranscript?: string;
  extraContentItems?: ExtraContentItem[];
  extraContentStatus: ContentStatus;
  extraContentVerifiedAt?: string;
  extraContentVerifiedBy?: string;
  // Photo description workflow
  photoDescription?: string;
  photoDescriptionStatus?: ContentStatus;
  photoDescriptionVerifiedAt?: string;
  photoDescriptionVerifiedBy?: string;
  photoDescriptionContext?: string;
  // AI notes (structured current format or legacy text)
  aiNotes?: StructuredNote[] | string | null;
  // Reading view text (independent spacing from raw transcript)
  readingText?: string;
  // Entity extraction (Prompt 2)
  entityExtractionStatus?: string;
  entityExtractionJson?: unknown;
  entityExtractionError?: string;
  // Legacy field
  transcriptConfirmedAt?: string;
  createdAt: string;
  updatedAt?: string;
  flagged: boolean;
  flaggedAt?: string;
  flaggedBy?: string;
  // Linked entities (populated when fetching letter detail)
  linkedPersons?: LinkedPerson[];
  linkedPlaces?: LinkedPlace[];
}
