// src/types/Letter.ts

export type LetterStatus =
  | 'uploaded'
  | 'processing'
  | 'processed'
  | 'needs_review'
  | 'published'
  | 'hidden';

export type LetterImageType =
  | 'envelope_front'
  | 'envelope_back'
  | 'letter_page';

export interface LetterImage {
  id: string;
  type: LetterImageType;
  pageNumber?: number; // only for letter pages
  imageUrl: string;
}

export interface LetterMetadata {
  sender?: string;
  recipient?: string;
  date?: string;
  location?: string;
  description?: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
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
  images: LetterImage[];
  transcript: LetterTranscript;
  metadata: LetterMetadata;
  status: LetterStatus;
  createdAt: string;
  updatedAt?: string;
}
