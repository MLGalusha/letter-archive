import { sql, type AnyColumn } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';

export const log = createLogger({ module: 'letter-operations' });

/** Compare a database timestamp with a JavaScript Date at representable precision. */
export function observedTimestampMatches(column: AnyColumn, observed: Date) {
  return sql`date_trunc('milliseconds', ${column}) = ${observed.toISOString()}::timestamptz`;
}

export const contentStatusValues = ['EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED'] as const;

export const VALID_RELATIONSHIP_TYPES = [
  'spouse', 'romantic-partner', 'parent-child', 'sibling', 'extended-family',
  'friend', 'acquaintance', 'professional', 'institutional', 'unknown',
  // Legacy values (still valid in DB, mapped from old extractions)
  'fiancé/fiancée', 'parent', 'child', 'grandparent', 'grandchild',
  'aunt/uncle', 'nephew/niece', 'cousin', 'in-law',
  'business-associate', 'employer', 'employee',
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
    'fiance': 'romantic-partner',
    'fiancee': 'romantic-partner',
    'fianc': 'romantic-partner',
    'engaged': 'romantic-partner',
    'married': 'spouse',
    'husband': 'spouse',
    'wife': 'spouse',
    'mom': 'parent-child',
    'dad': 'parent-child',
    'mother': 'parent-child',
    'father': 'parent-child',
    'son': 'parent-child',
    'daughter': 'parent-child',
    'brother': 'sibling',
    'sister': 'sibling',
    'grandmother': 'extended-family',
    'grandfather': 'extended-family',
    'grandson': 'extended-family',
    'granddaughter': 'extended-family',
    'aunt': 'extended-family',
    'uncle': 'extended-family',
    'niece': 'extended-family',
    'nephew': 'extended-family',
    'cousin': 'extended-family',
    'in-law': 'extended-family',
    'business associate': 'professional',
    'colleague': 'professional',
    'coworker': 'professional',
    'co-worker': 'professional',
    'boss': 'professional',
    'manager': 'professional',
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
      return 'cover';
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

export interface BulkSourceEntry {
  letterId: string;
  primarySourceRevision: number;
}

export type BulkSourceSkipCode =
  | 'NOT_FOUND'
  | 'SOURCE_CHANGED'
  | 'INELIGIBLE'
  | 'SOURCE_CHANGED_OR_INELIGIBLE'
  | 'MUTATION_FAILED';

export interface BulkSourceSkip {
  letterId: string;
  code: BulkSourceSkipCode;
  reason: string;
}

export interface BulkResult {
  requested: number;
  queued: number;
  skipped: number;
  skipReasons: BulkSourceSkip[];
  unconfirmedCount?: number;
}

export interface BulkClearResult {
  requested: number;
  applied: number;
  skipped: number;
  skipReasons: BulkSourceSkip[];
}

export interface BulkUpdateFieldEntry {
  letterId: string;
  primarySourceRevision: number;
  sender?: string;
  recipient?: string;
}

export interface BulkUpdateFieldsResult {
  requested: number;
  applied: number;
  skipped: number;
  updated: number;
  skipReasons: Array<{
    letterId: string;
    code: 'NOT_FOUND' | 'SOURCE_CHANGED' | 'WRITE_CONFLICT' | 'MUTATION_FAILED';
  }>;
}

export interface UpdateLetterInput {
  primarySourceRevision: number;
  transcriptionText?: string;
  sender?: string | null;
  recipient?: string | null;
  locationWritten?: string | null;
  hook?: string | null;
  summary?: string | null;
  extractedDate?: string | null;
  tags?: string[] | null;
  visibility?: 'PUBLISHED' | 'HIDDEN';
  transcriptPublished?: boolean;
  metadataPublished?: boolean;
  notes?: string | null;
  readingText?: string | null;
}

export interface VersionInput {
  primarySourceRevision: number;
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
