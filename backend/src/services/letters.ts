import { eq, and, ne, sql } from 'drizzle-orm';
import {
  db,
  type Database,
  letters,
  type Letter,
  type LetterType,
  type DateConfidence,
  type JobStatus,
} from '../db/index.js';
import type { EntityExtraction } from '../ai/schemas/entityExtraction.js';
import { isPlaceholderValue } from '../utils/placeholders.js';
import { buildExtraContentSourceInvalidationPatch } from './letter/extra-content-job.js';

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
 * record, preferring the primary L-type row when present.
 */
export async function resolveRepresentativeLetterId(
  letterId: string,
  options: { publishedOnly?: boolean } = {},
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

  const conditions = [
    eq(letters.collectionId, target.collectionId),
    eq(letters.dateRaw, target.dateRaw),
    eq(letters.typeSequence, target.typeSequence),
  ];

  if (options.publishedOnly) {
    conditions.push(eq(letters.visibility, 'PUBLISHED'));
  }

  const groupedLetters = await db.query.letters.findMany({
    where: and(...conditions),
    columns: {
      id: true,
      type: true,
    },
  });

  if (groupedLetters.length === 0) return null;

  const [representative] = [...groupedLetters].sort((a, b) => {
    const aRank = a.type === 'L' ? 0 : 1;
    const bRank = b.type === 'L' ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return a.type.localeCompare(b.type);
  });

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
 * Atomically claim a job by transitioning its status from expectedStatus to RUNNING.
 * Returns true if the claim succeeded (status was expectedStatus), false if someone else got it first.
 * This prevents the worker and on-demand processing from double-processing the same item.
 */
export async function claimEntityExtraction(
  letterId: string,
  expectedStatus: JobStatus = 'PENDING',
): Promise<boolean> {
  const result = await db
    .update(letters)
    .set({
      entityExtractionStatus: 'RUNNING',
      updatedAt: new Date(),
    })
    .where(and(
      eq(letters.id, letterId),
      eq(letters.entityExtractionStatus, expectedStatus),
      ne(letters.transcriptionStatus, 'RUNNING'),
      eq(letters.metadataStatus, 'SUCCESS'),
    ))
    .returning({ id: letters.id });

  return result.length > 0;
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
      ne(letters.transcriptionStatus, 'RUNNING'),
      ne(letters.metadataStatus, 'RUNNING'),
      ne(letters.entityExtractionStatus, 'RUNNING'),
    ))
    .returning({ id: letters.id });

  return reset.length > 0;
}

/**
 * Updates entity extraction results (Prompt 2) for a letter.
 * Tracked separately from basic metadata to allow independent retry.
 */
export async function updateEntityExtraction(
  letterId: string,
  status: JobStatus,
  entityData?: EntityExtraction,
  error?: string | null
): Promise<void> {
  const updates: Partial<Letter> = {
    entityExtractionStatus: status,
    updatedAt: new Date(),
  };

  if (entityData) {
    updates.entityExtractionJson = entityData;
  }

  if (error !== undefined) {
    updates.entityExtractionError = error;
  }

  await db.update(letters).set(updates).where(eq(letters.id, letterId));
}
