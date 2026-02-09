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

export interface LetterImage {
  id: string;
  type: LetterImageType;
  pageNumber?: number; // only for letter pages
  imageUrl: string;
  originalFilename?: string;
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
  transcriptConfirmedAt?: string;
  createdAt: string;
  updatedAt?: string;
}
