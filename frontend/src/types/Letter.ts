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

export type VisibilityState = 'PUBLISHED' | 'HIDDEN';

// Two-track content status system
export type ContentStatus = 'EMPTY' | 'AI_DRAFT' | 'EDITED' | 'VERIFIED';

// V2 Metadata types
export type EmotionalTone = 'joyful' | 'hopeful' | 'neutral' | 'anxious' | 'sad' | 'angry' | 'desperate';

export type RelationshipType =
  | 'spouse'
  | 'fiancé/fiancée'
  | 'romantic-partner'
  | 'parent'
  | 'child'
  | 'sibling'
  | 'grandparent'
  | 'grandchild'
  | 'aunt/uncle'
  | 'nephew/niece'
  | 'cousin'
  | 'in-law'
  | 'friend'
  | 'acquaintance'
  | 'business-associate'
  | 'employer'
  | 'employee'
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

export interface LineSegment {
  line: number;
  baseline: number[][];
  bbox: [number, number, number, number];
  ocrText: string;
}

export interface LetterImage {
  id: string;
  type: LetterImageType;
  pageNumber?: number; // only for letter pages
  imageUrl: string;
  originalFilename?: string;
  lineSegments?: LineSegment[];
}

export interface LetterMetadata {
  sender?: string;
  recipient?: string;
  date?: string;
  dateRaw?: string;
  dateConfidence?: 'exact' | 'unknown' | 'inferred';
  location?: string;
  hook?: string;
  description?: string;
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

export interface LetterTranscript {
  pages: LetterPageTranscript[];
  fullText: string;
  verified: boolean;
}

export interface Letter {
  id: string;
  title: string;
  collectionCode?: string;
  images: LetterImage[];
  transcript: LetterTranscript;
  metadata: LetterMetadata;
  status: LetterStatus;
  workflowState: WorkflowState;
  visibility: VisibilityState;
  // Two-track content status system
  transcriptStatus: ContentStatus;
  metadataContentStatus: ContentStatus;
  transcriptVerifiedAt?: string;
  transcriptVerifiedBy?: string;
  metadataVerifiedAt?: string;
  metadataVerifiedBy?: string;
  // Extra content transcription (telegrams, covers, ephemera)
  extraContentTranscript?: string;
  extraContentStatus: ContentStatus;
  extraContentVerifiedAt?: string;
  extraContentVerifiedBy?: string;
  // AI notes (observations, suggestions)
  aiNotes?: string;
  // Entity extraction (Prompt 2)
  entityExtractionStatus?: string;
  entityExtractionJson?: unknown;
  entityExtractionError?: string;
  // Legacy field
  transcriptConfirmedAt?: string;
  createdAt: string;
  updatedAt?: string;
  // Linked entities (populated when fetching letter detail)
  linkedPersons?: LinkedPerson[];
  linkedPlaces?: LinkedPlace[];
  // Count of L-type pages across the letter group - only in list responses
  lettersCount?: number;
  // Count of related items (envelopes, photos, etc.) - only in list responses
  extrasCount?: number;
}
