import { eq } from 'drizzle-orm';
import { db, collections, type Collection } from '../db/index.js';

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
