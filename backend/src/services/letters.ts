import { eq, and, ne, sql } from 'drizzle-orm';
import {
  db,
  letters,
  type Letter,
  type LetterType,
  type DateConfidence,
} from '../db/index.js';
import { isPlaceholderValue } from '../utils/placeholders.js';
import { clearedEntityExtractionOwnership } from './letter/entity-extraction-job.js';
import { clearedTranscriptConfirmationIntent } from './letter/metadata-job.js';
import { transcriptionPrerequisiteConditions } from './processing-eligibility.js';
import {
  isPublicCatalogueLetterType,
  publicCatalogueLetterTypeSql,
  selectPublicCatalogueRepresentative,
} from './public-catalogue-unit.js';

export interface LetterIdentity {
  collectionId: string;
  dateRaw: string;
  type: LetterType;
  typeSequence: number;
}

export interface CreateLetterParams extends LetterIdentity {
  letterDate: string | null;
  dateConfidence: DateConfidence;
}

/**
 * Reads the exact letter currently committed for one filename-derived identity.
 *
 * Membership creation belongs to the transactional page-source owner so an upload
 * cannot expose a page-less correspondence member.
 */
export async function findLetterByIdentity(
  identity: LetterIdentity,
): Promise<Letter | undefined> {
  return db.query.letters.findFirst({
    where: and(
      eq(letters.collectionId, identity.collectionId),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.type, identity.type),
      eq(letters.typeSequence, identity.typeSequence),
    ),
  });
}

/**
 * Gets a letter by ID with its pages.
 */
export async function getLetterWithPages(letterId: string) {
  return db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    with: {
      collection: true,
      pages: {
        orderBy: (pages, { asc }) => [asc(pages.pageNumber)],
      },
    },
  });
}

/**
 * Gets a letter by ID.
 */
export async function getLetterById(letterId: string): Promise<Letter | undefined> {
  return db.query.letters.findFirst({
    where: eq(letters.id, letterId),
  });
}

/**
 * Resolve any letter id in a grouped correspondence unit to its representative
 * record, preferring the primary L-type row when present. Public resolution
 * only returns catalogue roots; C/T/E/N rows can resolve through a published
 * primary sibling but can never represent a public unit themselves.
 */
export async function resolveRepresentativeLetterId(
  letterId: string,
  options: { publishedOnly?: boolean; collectionId?: string } = {},
): Promise<string | null> {
  const target = await db.query.letters.findFirst({
    where: eq(letters.id, letterId),
    columns: {
      id: true,
      collectionId: true,
      dateRaw: true,
      typeSequence: true,
    },
  });

  if (!target) return null;
  if (options.collectionId && target.collectionId !== options.collectionId) return null;

  const conditions = [
    eq(letters.collectionId, target.collectionId),
    eq(letters.dateRaw, target.dateRaw),
    eq(letters.typeSequence, target.typeSequence),
  ];

  if (options.publishedOnly) {
    conditions.push(eq(letters.visibility, 'PUBLISHED'));
    conditions.push(publicCatalogueLetterTypeSql(letters.type));
  }

  const groupedLetters = await db.query.letters.findMany({
    where: and(...conditions),
    columns: {
      id: true,
      type: true,
    },
  });

  const eligibleLetters = options.publishedOnly
    ? groupedLetters.filter((letter) => isPublicCatalogueLetterType(letter.type))
    : groupedLetters;

  if (eligibleLetters.length === 0) return null;

  const representative = options.publishedOnly
    ? selectPublicCatalogueRepresentative(eligibleLetters)
    : [...eligibleLetters].sort((a, b) => {
        const aRank = a.type === 'L' ? 0 : 1;
        const bRank = b.type === 'L' ? 0 : 1;
        if (aRank !== bRank) return aRank - bRank;
        return a.type.localeCompare(b.type) || a.id.localeCompare(b.id);
      })[0];

  return representative?.id ?? null;
}

/**
 * Resets a letter for re-processing.
 */
export async function resetLetterForProcessing(
  letterId: string,
  expectedPrimarySourceRevision: number,
): Promise<boolean> {
  const reset = await db
    .update(letters)
    .set({
      workflow: 'UPLOADED',
      transcriptionStatus: 'PENDING',
      transcriptionRunId: null,
      transcriptionLeaseExpiresAt: null,
      transcriptionLeaseRunId: null,
      transcriptionClaimKind: null,
      transcriptionError: null,
      transcriptionAttemptCount: 0,
      metadataStatus: 'PENDING',
      metadataRunId: null,
      metadataRunRevision: null,
      metadataLeaseExpiresAt: null,
      metadataLeaseRunId: null,
      metadataClaimKind: null,
      metadataRevision: sql`${letters.metadataRevision} + 1`,
      metadataError: null,
      metadataAttemptCount: 0,
      entityExtractionJson: null,
      entityExtractionStatus: 'PENDING',
      ...clearedEntityExtractionOwnership(),
      entityExtractionError: null,
      // Reset two-track content status to EMPTY
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EMPTY',
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      ...clearedTranscriptConfirmationIntent(),
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      transcriptPublished: false,
      metadataPublished: false,
      deadLetter: false,
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.primarySourceRevision, expectedPrimarySourceRevision),
      ...transcriptionPrerequisiteConditions(),
      ne(letters.transcriptionStatus, 'RUNNING'),
    ))
    .returning({ id: letters.id });

  return reset.length > 0;
}
