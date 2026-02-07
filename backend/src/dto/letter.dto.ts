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

export type FrontendLetterImageType = 'letter' | 'photo' | 'ephemera' | 'voice' | 'article' | 'diary' | 'cover' | 'card' | 'telegram';

export interface FrontendLetterImage {
  id: string;
  type: FrontendLetterImageType;
  pageNumber?: number;
  imageUrl: string;
  originalFilename?: string;
}

export interface FrontendLetterMetadata {
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
  collectionCode?: string;
  images: FrontendLetterImage[];
  transcript: FrontendLetterTranscript;
  metadata: FrontendLetterMetadata;
  status: FrontendLetterStatus;
  workflowState: WorkflowState;
  visibility: VisibilityState;
  transcriptConfirmedAt?: string;
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
      return 'letter';
    case 'P':
      return 'photo';
    case 'E':
      return 'ephemera';
    case 'V':
      return 'voice';
    case 'A':
      return 'article';
    case 'D':
      return 'diary';
    case 'C':
      return 'cover';
    case 'N':
      return 'card';
    case 'T':
      return 'telegram';
    default:
      return 'letter';
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

/**
 * Formats a partial date (dateRaw with X's) for display.
 * Examples:
 *   18860914 → "September 14, 1886"
 *   1947XXXX → "1947"
 *   19XXXXXX → "1900s"
 *   XXXX0914 → "September 14th"
 *   XXXXXXXX → "Unknown"
 */
function formatPartialDate(dateRaw: string): string {
  const yearPart = dateRaw.slice(0, 4);
  const monthPart = dateRaw.slice(4, 6);
  const dayPart = dateRaw.slice(6, 8);

  const yearKnown = !yearPart.includes('X');
  const decadeKnown = !yearPart.slice(0, 3).includes('X');
  const centuryKnown = !yearPart.slice(0, 2).includes('X');
  const monthKnown = !monthPart.includes('X');
  const dayKnown = !dayPart.includes('X');

  // Build components
  let monthStr = '';
  let dayStr = '';
  let yearStr = '';

  if (monthKnown) {
    const month = parseInt(monthPart, 10);
    if (month >= 1 && month <= 12) {
      monthStr = MONTH_NAMES[month - 1];
    }
  }

  if (dayKnown) {
    const day = parseInt(dayPart, 10);
    if (day >= 1 && day <= 31) {
      dayStr = `${day}${getOrdinalSuffix(day)}`;
    }
  }

  if (yearKnown) {
    yearStr = yearPart;
  } else if (decadeKnown) {
    yearStr = `${yearPart.slice(0, 3)}0s`;
  } else if (centuryKnown) {
    yearStr = `${yearPart.slice(0, 2)}00s`;
  }

  // Combine based on what's known
  if (monthStr && dayStr && yearStr) {
    return `${monthStr} ${dayStr}, ${yearStr}`;
  }
  if (monthStr && dayStr) {
    return `${monthStr} ${dayStr}`;
  }
  if (monthStr && yearStr) {
    return `${monthStr} ${yearStr}`;
  }
  if (dayStr && yearStr) {
    return `${dayStr}, ${yearStr}`;
  }
  if (monthStr) {
    return monthStr;
  }
  if (dayStr) {
    return dayStr;
  }
  if (yearStr) {
    return yearStr;
  }

  return 'Unknown';
}

/**
 * Formats a letter date for display.
 * Always uses dateRaw to avoid JavaScript Date timezone issues with historical dates.
 * (e.g., new Date('1886-03-14') in UTC becomes March 13 in PST)
 */
export function formatLetterDate(letter: Letter): string | undefined {
  if (letter.dateRaw) {
    return formatPartialDate(letter.dateRaw);
  }
  return undefined;
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
    collectionCode: letter.collection.collectionCode,
    images: letter.pages.map((page) => ({
      id: page.id,
      type: imageType,
      pageNumber: page.pageNumber,
      imageUrl: `/images/${page.id}${page.checksumSha256 ? `?v=${page.checksumSha256.slice(0, 8)}` : ''}`,
      originalFilename: page.originalFilename,
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
      hook: letter.hook || undefined,
      description: letter.summary || undefined,
      tags: letter.tags || undefined,
      notes: letter.notes || undefined,
      verified: letter.reviewedAt !== null,
      verifiedBy: letter.reviewedBy || undefined,
      verifiedAt: letter.reviewedAt?.toISOString(),
      firstPageFilename: letter.pages[0]?.originalFilename,
    },
    status: mapWorkflowVisibilityToStatus(letter.workflow, letter.visibility),
    workflowState: letter.workflow,
    visibility: letter.visibility,
    transcriptConfirmedAt: letter.transcriptConfirmedAt?.toISOString(),
    createdAt: letter.createdAt.toISOString(),
    updatedAt: letter.updatedAt?.toISOString(),
  };
}

/**
 * Extracts page-specific text from combined transcription.
 * The combined text uses "--- Page N ---" separators.
 *
 * For multi-page letters, format is:
 *   --- Page 1 ---
 *   [text]
 *   --- Page 2 ---
 *   [text]
 *
 * When split by separator regex, parts[0] is empty (before first separator),
 * so actual page text is at parts[pageIndex + 1].
 */
function extractPageText(fullText: string, pageIndex: number, totalPages: number): string {
  if (totalPages === 1) {
    return fullText;
  }

  // Split by page separator pattern
  const parts = fullText.split(/\n*---\s*Page\s*\d+\s*---\n*/i);

  // parts[0] is empty (before first separator), so use pageIndex + 1
  const partIndex = pageIndex + 1;
  if (parts.length > partIndex) {
    return parts[partIndex].trim();
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

  // Separate by type - covers (C) come last, everything else is considered supplementary
  const covers = relatedItems.filter((item) => item.type === 'C');
  const others = relatedItems.filter((item) => item.type !== 'C');

  // Build additional images: supplementary items first, then covers last
  const additionalImages: FrontendLetterImage[] = [];

  // Add supplementary items (photos, ephemera, voice, article, diary, cards, telegrams)
  for (const item of others) {
    const imageType = mapTypeToImageType(item.type);
    for (const page of item.pages) {
      additionalImages.push({
        id: page.id,
        type: imageType,
        pageNumber: page.pageNumber,
        imageUrl: `/images/${page.id}${page.checksumSha256 ? `?v=${page.checksumSha256.slice(0, 8)}` : ''}`,
        originalFilename: page.originalFilename,
      });
    }
  }

  // Add covers last
  for (const cover of covers) {
    const imageType = mapTypeToImageType(cover.type);
    for (const page of cover.pages) {
      additionalImages.push({
        id: page.id,
        type: imageType,
        pageNumber: page.pageNumber,
        imageUrl: `/images/${page.id}${page.checksumSha256 ? `?v=${page.checksumSha256.slice(0, 8)}` : ''}`,
        originalFilename: page.originalFilename,
      });
    }
  }

  return {
    ...baseDTO,
    images: [...baseDTO.images, ...additionalImages],
  };
}
