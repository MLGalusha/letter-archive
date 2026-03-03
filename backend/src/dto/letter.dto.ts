import type {
  Letter,
  LetterPage,
  Collection,
  WorkflowState,
  VisibilityState,
  LetterType,
  ContentStatus,
  LetterPerson,
  LetterPlace,
  CanonicalPerson,
  CanonicalPlace,
  PersonRole,
  PlaceRole,
  PlaceType,
  EmotionalTone,
  RelationshipType,
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

export interface FrontendLineSegmentWord {
  text: string;
  bbox: [number, number, number, number];
}

export interface FrontendLineSegment {
  line: number;
  baseline: number[][];
  bbox: [number, number, number, number];
  ocrText: string;
  words?: FrontendLineSegmentWord[];
}

export interface FrontendLetterImage {
  id: string;
  type: FrontendLetterImageType;
  pageNumber?: number;
  imageUrl: string;
  originalFilename?: string;
  lineSegments?: FrontendLineSegment[];
}

// V2 Metadata types
export interface FrontendNotableQuote {
  text: string;
  context?: string;
  position?: 'opening' | 'middle' | 'closing';
}

export interface FrontendLinkedPerson {
  id: string;
  personId: string;
  canonicalName: string;
  role: PersonRole;
  nameAsWritten?: string;
  relationshipToSender?: string;
  context?: string;
  confidence: number;
}

export interface FrontendLinkedPlace {
  id: string;
  placeId: string;
  canonicalName: string;
  role: PlaceRole;
  placeType?: PlaceType;
  nameAsWritten?: string;
  context?: string;
  confidence: number;
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
  // V2 metadata fields
  emotionalTone?: EmotionalTone;
  senderRecipientRelationship?: RelationshipType;
  primaryTopics?: string[];
  notableQuotes?: FrontendNotableQuote[];
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
  // Legacy field kept for backward compat
  transcriptConfirmedAt?: string;
  createdAt: string;
  updatedAt?: string;
  // Entity extraction (Prompt 2)
  entityExtractionStatus?: string;
  entityExtractionJson?: unknown;
  entityExtractionError?: string;
  // Linked entities (populated when fetching letter detail)
  linkedPersons?: FrontendLinkedPerson[];
  linkedPlaces?: FrontendLinkedPlace[];
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

  // Workflow states for HIDDEN visibility (unpublished letters)
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
// V2 METADATA HELPERS
// ============================================================================

/**
 * Extracts notable quotes from metadataV2Json
 */
function extractNotableQuotes(letter: Letter): FrontendNotableQuote[] | undefined {
  const metadata = letter.metadataV2Json as {
    notable_quotes?: Array<{ text: string; context?: string; position?: string }>;
  } | null;

  if (!metadata?.notable_quotes?.length) {
    return undefined;
  }

  return metadata.notable_quotes.map((q) => ({
    text: q.text,
    context: q.context,
    position: q.position as 'opening' | 'middle' | 'closing' | undefined,
  }));
}

// ============================================================================
// MAIN TRANSFORMER
// ============================================================================

// Letter person with joined canonical person data
export interface LetterPersonWithPerson extends LetterPerson {
  person: CanonicalPerson;
}

// Letter place with joined canonical place data
export interface LetterPlaceWithPlace extends LetterPlace {
  place: CanonicalPlace;
}

export interface LetterWithRelations extends Letter {
  collection: Collection;
  pages: LetterPage[];
  // Optional entity relations (populated when fetching detail view)
  persons?: LetterPersonWithPerson[];
  places?: LetterPlaceWithPlace[];
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
      lineSegments: Array.isArray(page.lineSegments)
        ? page.lineSegments as FrontendLineSegment[]
        : undefined,
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
      verified: letter.transcriptStatus === 'VERIFIED',
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
      verified: letter.metadataContentStatus === 'VERIFIED',
      verifiedBy: letter.metadataVerifiedBy || undefined,
      verifiedAt: letter.metadataVerifiedAt?.toISOString(),
      firstPageFilename: letter.pages[0]?.originalFilename,
      // V2 metadata fields
      emotionalTone: letter.emotionalTone || undefined,
      senderRecipientRelationship: letter.senderRecipientRelationship || undefined,
      primaryTopics: letter.primaryTopics || undefined,
      notableQuotes: extractNotableQuotes(letter),
    },
    status: mapWorkflowVisibilityToStatus(letter.workflow, letter.visibility),
    workflowState: letter.workflow,
    visibility: letter.visibility,
    // Two-track content status
    transcriptStatus: letter.transcriptStatus,
    metadataContentStatus: letter.metadataContentStatus,
    transcriptVerifiedAt: letter.transcriptVerifiedAt?.toISOString(),
    transcriptVerifiedBy: letter.transcriptVerifiedBy || undefined,
    metadataVerifiedAt: letter.metadataVerifiedAt?.toISOString(),
    metadataVerifiedBy: letter.metadataVerifiedBy || undefined,
    // Extra content transcription
    extraContentTranscript: letter.extraContentTranscript || undefined,
    extraContentStatus: letter.extraContentStatus,
    extraContentVerifiedAt: letter.extraContentVerifiedAt?.toISOString(),
    extraContentVerifiedBy: letter.extraContentVerifiedBy || undefined,
    // AI notes
    aiNotes: letter.aiNotes || undefined,
    // Entity extraction (Prompt 2)
    entityExtractionStatus: letter.entityExtractionStatus || undefined,
    entityExtractionJson: letter.entityExtractionJson || undefined,
    entityExtractionError: letter.entityExtractionError || undefined,
    // Legacy field
    transcriptConfirmedAt: letter.transcriptConfirmedAt?.toISOString(),
    createdAt: letter.createdAt.toISOString(),
    updatedAt: letter.updatedAt?.toISOString(),
    // Linked entities (only populated for detail view)
    linkedPersons: letter.persons?.map((lp) => ({
      id: lp.id,
      personId: lp.personId,
      canonicalName: lp.person.canonicalName,
      role: lp.role,
      nameAsWritten: lp.nameAsWritten || undefined,
      relationshipToSender: lp.relationshipToSender || undefined,
      context: lp.context || undefined,
      confidence: lp.confidence,
    })),
    linkedPlaces: letter.places?.map((lpl) => ({
      id: lpl.id,
      placeId: lpl.placeId,
      canonicalName: lpl.place.canonicalName,
      role: lpl.role,
      placeType: lpl.place.placeType || undefined,
      nameAsWritten: lpl.nameAsWritten || undefined,
      context: lpl.context || undefined,
      confidence: lpl.confidence,
    })),
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
 * Transforms multiple letters with their related items to DTOs.
 * Each entry contains a letter and its related items (cards, extras, etc.).
 */
export function transformLettersWithRelatedToDTO(
  lettersWithRelated: Array<{ letter: LetterWithRelations; relatedItems: LetterWithRelations[] }>
): FrontendLetter[] {
  return lettersWithRelated.map(({ letter, relatedItems }) =>
    transformLetterWithRelatedToDTO(letter, relatedItems)
  );
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
        lineSegments: Array.isArray(page.lineSegments)
          ? page.lineSegments as FrontendLineSegment[]
          : undefined,
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
        lineSegments: Array.isArray(page.lineSegments)
          ? page.lineSegments as FrontendLineSegment[]
          : undefined,
      });
    }
  }

  return {
    ...baseDTO,
    images: [...baseDTO.images, ...additionalImages],
  };
}
