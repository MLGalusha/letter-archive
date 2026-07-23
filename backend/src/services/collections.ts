import { and, eq, isNull } from 'drizzle-orm';
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
    .returning();

  return created;
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
 * Resolve and repair a collection's start-here selection as one coherent
 * snapshot. The letter ID and its explanation share the same CAS boundary, so
 * a concurrent curator update can never return a winner ID with an old reason.
 */
export async function resolveCollectionStartHere(
  collectionId: string,
  current: {
    letterId: string | null | undefined;
    reason: string | null | undefined;
  },
): Promise<CollectionStartHereSnapshot> {
  const resolveCandidate = async (
    observed: CollectionStartHereSnapshot,
  ): Promise<CollectionStartHereSnapshot> => {
    if (observed.letterId) {
      const resolvedCurrentId = await resolveRepresentativeLetterId(observed.letterId, {
        publishedOnly: true,
        collectionId,
      });
      if (resolvedCurrentId) {
        return {
          letterId: resolvedCurrentId,
          reason: observed.reason,
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
      // An explanation belongs to one selection. Auto-picking a different
      // unit must not inherit the explanation for the stale saved unit.
      reason: null,
    };
  };

  let observed: CollectionStartHereSnapshot = {
    letterId: current.letterId ?? null,
    reason: current.reason ?? null,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const resolved = await resolveCandidate(observed);
    if (
      resolved.letterId === observed.letterId
      && resolved.reason === observed.reason
    ) {
      return resolved;
    }

    const observedIdCondition = observed.letterId === null
      ? isNull(collections.profileStartHereLetterId)
      : eq(collections.profileStartHereLetterId, observed.letterId);
    const observedReasonCondition = observed.reason === null
      ? isNull(collections.profileStartHereReason)
      : eq(collections.profileStartHereReason, observed.reason);
    const updated = await db
      .update(collections)
      .set({
        profileStartHereLetterId: resolved.letterId,
        profileStartHereReason: resolved.reason,
      })
      .where(and(
        eq(collections.id, collectionId),
        observedIdCondition,
        observedReasonCondition,
      ))
      .returning({
        profileStartHereLetterId: collections.profileStartHereLetterId,
        profileStartHereReason: collections.profileStartHereReason,
      });

    if (updated.length > 0) return resolved;

    const winner = await db.query.collections.findFirst({
      where: eq(collections.id, collectionId),
      columns: {
        profileStartHereLetterId: true,
        profileStartHereReason: true,
      },
    });
    if (!winner) {
      return {
        letterId: null,
        reason: null,
      };
    }
    observed = {
      letterId: winner.profileStartHereLetterId ?? null,
      reason: winner.profileStartHereReason ?? null,
    };
  }

  return resolveCandidate(observed);
}
