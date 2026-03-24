import { createLogger } from '../../utils/logger.js';

export const log = createLogger({ module: 'letter-operations' });

export const contentStatusValues = ['EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED'] as const;

export const VALID_RELATIONSHIP_TYPES = [
  'spouse', 'fiancé/fiancée', 'romantic-partner', 'parent', 'child', 'sibling',
  'grandparent', 'grandchild', 'aunt/uncle', 'nephew/niece', 'cousin', 'in-law',
  'friend', 'acquaintance', 'business-associate', 'employer', 'employee', 'unknown',
] as const;

export type RelationshipType = typeof VALID_RELATIONSHIP_TYPES[number];

export function normalizeRelationshipType(value: string | null | undefined): RelationshipType | null {
  if (!value) return null;

  const normalized = value.toLowerCase().trim();

  if (VALID_RELATIONSHIP_TYPES.includes(normalized as RelationshipType)) {
    return normalized as RelationshipType;
  }

  const mappings: Record<string, RelationshipType> = {
    'romantic partners': 'romantic-partner',
    'romantic partner': 'romantic-partner',
    'partners': 'romantic-partner',
    'partner': 'romantic-partner',
    'fiance': 'fiancé/fiancée',
    'fiancee': 'fiancé/fiancée',
    'fianc': 'fiancé/fiancée',
    'engaged': 'fiancé/fiancée',
    'married': 'spouse',
    'husband': 'spouse',
    'wife': 'spouse',
    'mom': 'parent',
    'dad': 'parent',
    'mother': 'parent',
    'father': 'parent',
    'son': 'child',
    'daughter': 'child',
    'brother': 'sibling',
    'sister': 'sibling',
    'grandmother': 'grandparent',
    'grandfather': 'grandparent',
    'grandson': 'grandchild',
    'granddaughter': 'grandchild',
    'aunt': 'aunt/uncle',
    'uncle': 'aunt/uncle',
    'niece': 'nephew/niece',
    'nephew': 'nephew/niece',
    'business associate': 'business-associate',
    'colleague': 'business-associate',
    'coworker': 'business-associate',
    'co-worker': 'business-associate',
    'boss': 'employer',
    'manager': 'employer',
  };

  if (mappings[normalized]) {
    return mappings[normalized];
  }

  log.warn({ original: value, normalized }, 'Unknown relationship type from AI, defaulting to unknown');
  return 'unknown';
}

/**
 * Types that can be transcribed. Excludes P (Photo) and V (Voice).
 */
export const TRANSCRIBABLE_TYPES = ['L', 'T', 'C', 'E', 'N', 'A', 'D'] as const;

export function isTranscribableType(type: string): boolean {
  return (TRANSCRIBABLE_TYPES as readonly string[]).includes(type);
}

export function getDocumentTypeFromCode(type: string): string {
  switch (type) {
    case 'T':
      return 'telegram';
    case 'C':
      return 'cover/envelope';
    case 'E':
      return 'ephemera';
    case 'N':
      return 'card';
    case 'P':
      return 'photo';
    default:
      return 'document';
  }
}

export interface BulkResult {
  queued: number;
  skipped: number;
  skipReasons: Array<{ letterId: string; reason: string }>;
  processing: boolean;
  unconfirmedCount?: number;
}

export interface BulkClearResult {
  message: string;
  updated: number;
}

export interface BulkUpdateFieldEntry {
  letterId: string;
  sender?: string;
  recipient?: string;
}

export interface BulkUpdateFieldsResult {
  message: string;
  updated: number;
}

export interface UpdateLetterInput {
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  extractedDate?: string | null;
  extractedDateConfidence?: 'exact' | 'unknown' | 'inferred' | null;
  tags?: string[] | null;
  visibility?: 'PUBLISHED' | 'HIDDEN';
  notes?: string | null;
}

export interface UpdateLetterResult {
  dbUpdates: Record<string, unknown>;
  workflowChange?: string;
}

export interface VersionInput {
  fieldType: 'transcript' | 'metadata';
  content: string | Record<string, unknown>;
  source: 'ai' | 'human';
}

export interface VersionResult {
  versionNumber: number;
  createdAt: string;
}

export interface TranscriptionRegenerateResult {
  mainTranscript: boolean;
  extras: boolean;
  extrasCount: number;
}

export interface TranscribeLetterOnlyResult {
  pageCount: number;
  textLength: number;
}

export interface TranscribeExtrasResult {
  transcribedCount: number;
  extraContentStatus: string;
  message?: string;
}

export interface DescribePhotoResult {
  describedCount: number;
  photoDescriptionStatus: string;
  message?: string;
}
