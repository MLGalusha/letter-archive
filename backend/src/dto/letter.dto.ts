import type {
  Letter,
  LetterPage,
  Collection,
  WorkflowState,
  VisibilityState,
  LetterType,
} from '../db/index.js';

// ============================================================================
// FRONTEND-COMPATIBLE TYPES (mirror frontend/src/types/Letter.ts)
// ============================================================================

export type FrontendLetterStatus =
  | 'uploaded'
  | 'processing'
  | 'processed'
  | 'needs_review'
  | 'published'
  | 'hidden';

export type FrontendLetterImageType = 'envelope_front' | 'envelope_back' | 'letter_page' | 'card' | 'extra';

export interface FrontendLetterImage {
  id: string;
  type: FrontendLetterImageType;
  pageNumber?: number;
  imageUrl: string;
}

export interface FrontendLetterMetadata {
  sender?: string;
  recipient?: string;
  date?: string;
  dateRaw?: string;
  dateConfidence?: 'exact' | 'unknown' | 'inferred';
  location?: string;
  description?: string;
  tags?: string[];
  notes?: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: string;
}

export interface FrontendLetterPageTranscript {
  pageNumber: number;
  text: string;
  confidence?: number;
}

export interface FrontendLetterTranscript {
  pages: FrontendLetterPageTranscript[];
  fullText: string;
  verified: boolean;
}

export interface FrontendLetter {
  id: string;
  title: string;
  images: FrontendLetterImage[];
  transcript: FrontendLetterTranscript;
  metadata: FrontendLetterMetadata;
  status: FrontendLetterStatus;
  workflowState: WorkflowState;
  visibility: VisibilityState;
  createdAt: string;
  updatedAt?: string;
}

// ============================================================================
// MAPPING FUNCTIONS
// ============================================================================

/**
 * Maps backend workflow + visibility states to frontend status.
 */
export function mapWorkflowVisibilityToStatus(
  workflow: WorkflowState,
  visibility: VisibilityState
): FrontendLetterStatus {
  // Visibility takes precedence for final states
  if (visibility === 'PUBLISHED') return 'published';
  if (visibility === 'HIDDEN') return 'hidden';

  // Workflow states for DRAFT visibility
  switch (workflow) {
    case 'UPLOADED':
      return 'uploaded';
    case 'TRANSCRIBING':
    case 'METADATA_EXTRACTING':
      return 'processing';
    case 'TRANSCRIBED':
    case 'METADATA_DRAFTED':
      return 'needs_review';
    case 'REVIEWED':
      return 'processed';
    default:
      return 'uploaded';
  }
}

/**
 * Maps letter type to frontend image type.
 */
export function mapTypeToImageType(type: LetterType): FrontendLetterImageType {
  switch (type) {
    case 'L':
      return 'letter_page';
    case 'C':
      return 'card';
    case 'E':
      return 'extra';
    default:
      return 'letter_page';
  }
}

/**
 * Generates a title from letter metadata.
 */
export function generateTitle(letter: Letter, collection: Collection): string {
  if (letter.sender && letter.recipient) {
    return `Letter from ${letter.sender} to ${letter.recipient}`;
  }
  if (letter.sender) {
    return `Letter from ${letter.sender}`;
  }
  if (letter.recipient) {
    return `Letter to ${letter.recipient}`;
  }

  // Fallback: use collection and date
  const dateStr = formatLetterDate(letter) || letter.dateRaw;
  return `${collection.title || `Collection ${collection.collectionCode}`} - ${dateStr}`;
}

/**
 * Formats a letter date for display.
 * Prefers extracted date over filename-derived date.
 */
export function formatLetterDate(letter: Letter): string | undefined {
  const dateToUse = letter.extractedDate || letter.letterDate;
  if (!dateToUse) return undefined;

  try {
    return new Date(dateToUse).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return undefined;
  }
}

// ============================================================================
// MAIN TRANSFORMER
// ============================================================================

export interface LetterWithRelations extends Letter {
  collection: Collection;
  pages: LetterPage[];
}

/**
 * Transforms a database letter entity (with relations) into frontend-compatible format.
 */
export function transformLetterToDTO(letter: LetterWithRelations): FrontendLetter {
  const imageType = mapTypeToImageType(letter.type);

  return {
    id: letter.id,
    title: generateTitle(letter, letter.collection),
    images: letter.pages.map((page) => ({
      id: page.id,
      type: imageType,
      pageNumber: page.pageNumber,
      imageUrl: `/images/${page.id}`,
    })),
    transcript: {
      pages: letter.transcriptionText
        ? letter.pages.map((page, index) => ({
            pageNumber: page.pageNumber,
            text: letter.transcriptionText
              ? extractPageText(letter.transcriptionText, index, letter.pages.length)
              : '',
          }))
        : [],
      fullText: letter.transcriptionText || '',
      verified: letter.workflow === 'REVIEWED',
    },
    metadata: {
      sender: letter.sender || undefined,
      recipient: letter.recipient || undefined,
      date: formatLetterDate(letter),
      dateRaw: letter.dateRaw,
      dateConfidence: letter.extractedDateConfidence || letter.dateConfidence,
      location: letter.locationWritten || undefined,
      description: letter.summary || undefined,
      tags: letter.tags || undefined,
      notes: letter.notes || undefined,
      verified: letter.reviewedAt !== null,
      verifiedBy: letter.reviewedBy || undefined,
      verifiedAt: letter.reviewedAt?.toISOString(),
    },
    status: mapWorkflowVisibilityToStatus(letter.workflow, letter.visibility),
    workflowState: letter.workflow,
    visibility: letter.visibility,
    createdAt: letter.createdAt.toISOString(),
    updatedAt: letter.updatedAt?.toISOString(),
  };
}

/**
 * Extracts page-specific text from combined transcription.
 * The combined text uses "--- Page N ---" separators.
 */
function extractPageText(fullText: string, pageIndex: number, totalPages: number): string {
  if (totalPages === 1) {
    return fullText;
  }

  // Split by page separator pattern
  const parts = fullText.split(/\n*---\s*Page\s*\d+\s*---\n*/i);

  // If we have proper splits, return the relevant part
  if (parts.length > pageIndex) {
    return parts[pageIndex].trim();
  }

  // Fallback: return full text for first page, empty for others
  return pageIndex === 0 ? fullText : '';
}

/**
 * Transforms multiple letters to DTOs.
 */
export function transformLettersToDTO(letters: LetterWithRelations[]): FrontendLetter[] {
  return letters.map(transformLetterToDTO);
}

/**
 * Transforms a letter with related cards/extras into a single DTO.
 * The related items' pages are appended to the images array.
 * Order: letter pages first, then extras (E), then card (C) last.
 */
export function transformLetterWithRelatedToDTO(
  letter: LetterWithRelations,
  relatedItems: LetterWithRelations[]
): FrontendLetter {
  const baseDTO = transformLetterToDTO(letter);

  // Separate extras and cards
  const extras = relatedItems.filter((item) => item.type === 'E');
  const cards = relatedItems.filter((item) => item.type === 'C');

  // Build additional images: extras first, then cards
  const additionalImages: FrontendLetterImage[] = [];

  // Add extras
  for (const extra of extras) {
    const imageType = mapTypeToImageType(extra.type);
    for (const page of extra.pages) {
      additionalImages.push({
        id: page.id,
        type: imageType,
        pageNumber: page.pageNumber,
        imageUrl: `/images/${page.id}`,
      });
    }
  }

  // Add cards (last)
  for (const card of cards) {
    const imageType = mapTypeToImageType(card.type);
    for (const page of card.pages) {
      additionalImages.push({
        id: page.id,
        type: imageType,
        pageNumber: page.pageNumber,
        imageUrl: `/images/${page.id}`,
      });
    }
  }

  return {
    ...baseDTO,
    images: [...baseDTO.images, ...additionalImages],
  };
}
