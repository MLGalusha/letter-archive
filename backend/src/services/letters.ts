import { eq, and, ne, sql } from 'drizzle-orm';
import {
  db,
  type Database,
  letters,
  type Letter,
  type LetterType,
  type DateConfidence,
} from '../db/index.js';
import { isPlaceholderValue } from '../utils/placeholders.js';
import { clearedEntityExtractionOwnership } from './letter/entity-extraction-job.js';
import { buildExtraContentSourceInvalidationPatch } from './letter/extra-content-job.js';
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

export type ExtraContentGroupIdentity = Pick<
  LetterIdentity,
  'collectionId' | 'dateRaw' | 'typeSequence'
>;

export type LetterUpdateDatabase = Pick<Database, 'update'>;

/**
 * Finds an existing letter by its identity, or creates a new one.
 */
export async function findOrCreateLetter(params: CreateLetterParams): Promise<Letter> {
  const existing = await db.query.letters.findFirst({
    where: and(
      eq(letters.collectionId, params.collectionId),
      eq(letters.dateRaw, params.dateRaw),
      eq(letters.type, params.type),
      eq(letters.typeSequence, params.typeSequence),
    ),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(letters)
    .values({
      collectionId: params.collectionId,
      dateRaw: params.dateRaw,
      type: params.type,
      typeSequence: params.typeSequence,
      letterDate: params.letterDate,
      dateConfidence: params.dateConfidence,
    })
    .returning();

  return created;
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
 * Invalidates the primary letter's derived extra-content job after one of its
 * T/C/E source pages changes. A running owner keeps its attempt ID and is marked
 * dirty so it can reconcile the newer source; idle jobs return to PENDING.
 */
export async function invalidateExtraContentJobForSourceChange(
  identity: ExtraContentGroupIdentity,
  database: LetterUpdateDatabase = db,
): Promise<void> {
  await database
    .update(letters)
    .set({
      ...buildExtraContentSourceInvalidationPatch(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.collectionId, identity.collectionId),
      eq(letters.dateRaw, identity.dateRaw),
      eq(letters.type, 'L'),
      eq(letters.typeSequence, identity.typeSequence),
    ));
}

/**
 * Resets a letter for re-processing.
 */
export async function resetLetterForProcessing(letterId: string): Promise<boolean> {
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
      ...transcriptionPrerequisiteConditions(),
      ne(letters.transcriptionStatus, 'RUNNING'),
    ))
    .returning({ id: letters.id });

  return reset.length > 0;
}
