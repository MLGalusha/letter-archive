import { eq } from 'drizzle-orm';
import { db, collections, type Collection } from '../db/index.js';
import { resolveRepresentativeLetterId } from './letters.js';
import { pickFeaturedLetter } from './pick-featured-letter.js';

/**
 * Finds an existing collection by code, or creates a new one.
 */
export async function findOrCreateCollection(collectionCode: string): Promise<Collection> {
  // Try to find existing
  const existing = await db.query.collections.findFirst({
    where: eq(collections.collectionCode, collectionCode),
  });

  if (existing) {
    return existing;
  }

  // Create new collection
  const [created] = await db
    .insert(collections)
    .values({
      collectionCode,
      title: `Collection ${collectionCode}`,
    })
    .onConflictDoNothing({ target: collections.collectionCode })
    .returning();

  if (created) return created;

  const winner = await db.query.collections.findFirst({
    where: eq(collections.collectionCode, collectionCode),
  });
  if (!winner) {
    throw new Error(`Collection ${collectionCode} conflicted but could not be reloaded`);
  }
  return winner;
}

/**
 * Gets a collection by ID.
 */
export async function getCollectionById(id: string): Promise<Collection | undefined> {
  return db.query.collections.findFirst({
    where: eq(collections.id, id),
  });
}

/**
 * Gets a collection by code.
 */
export async function getCollectionByCode(code: string): Promise<Collection | undefined> {
  return db.query.collections.findFirst({
    where: eq(collections.collectionCode, code),
  });
}

/**
 * Lists all collections.
 */
export async function listCollections(): Promise<Collection[]> {
  return db.query.collections.findMany({
    orderBy: (cols, { asc }) => [asc(cols.collectionCode)],
  });
}

export interface CollectionStartHereSnapshot {
  letterId: string | null;
  reason: string | null;
}

/**
 * Resolve a collection's start-here selection without mutating profile state.
 * GET callers may validate or derive a display fallback, but only the guarded
 * profile mutation route owns persistence and profile revision changes.
 */
export async function resolveCollectionStartHere(
  collectionId: string,
  current: {
    letterId: string | null | undefined;
    reason: string | null | undefined;
  },
): Promise<CollectionStartHereSnapshot> {
  if (current.letterId) {
    const resolvedCurrentId = await resolveRepresentativeLetterId(
      current.letterId,
      {
        publishedOnly: true,
        collectionId,
      },
    );
    if (resolvedCurrentId) {
      return {
        letterId: resolvedCurrentId,
        reason: current.reason ?? null,
      };
    }
  }

  const autoPick = await pickFeaturedLetter(collectionId);
  if (!autoPick?.id) {
    return {
      letterId: null,
      reason: null,
    };
  }

  const autoLetterId = await resolveRepresentativeLetterId(autoPick.id, {
    publishedOnly: true,
    collectionId,
  });
  return {
    letterId: autoLetterId,
    // An explanation belongs to one selection. A display fallback must not
    // inherit the explanation for a stale saved unit.
    reason: null,
  };
}
