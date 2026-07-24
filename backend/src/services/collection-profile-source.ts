import { sql } from 'drizzle-orm';
import { db, type Database } from '../db/index.js';

type CollectionProfileSourceDatabase = Pick<Database, 'execute'>;

function getRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * The database function is the single definition of the collection-profile
 * source corpus. Generation, verification, and public delivery all compare
 * the same value instead of relying solely on every possible metadata writer
 * to remember a collection-level invalidation side effect.
 */
export async function computeCollectionProfileSourceFingerprint(
  collectionId: string,
  database: CollectionProfileSourceDatabase = db,
): Promise<string | null> {
  const result = await database.execute(sql`
    SELECT compute_collection_profile_source_fingerprint(
      ${collectionId}::uuid
    ) AS fingerprint
  `);
  const [row] = getRows<{ fingerprint: string | null }>(result);
  return row?.fingerprint ?? null;
}

export async function getCurrentCollectionProfilePublicationIds(
  collectionIds: string[],
  database: CollectionProfileSourceDatabase = db,
): Promise<Set<string>> {
  if (collectionIds.length === 0) return new Set();

  const ids = sql.join(
    collectionIds.map((collectionId) => sql`${collectionId}::uuid`),
    sql`, `,
  );
  const result = await database.execute(sql`
    SELECT
      c.id::text AS collection_id
    FROM collections c
    WHERE c.id IN (${ids})
      AND c.profile_status = 'VERIFIED'
      AND c.profile_source_fingerprint IS NOT NULL
      AND c.profile_source_fingerprint
        = compute_collection_profile_source_fingerprint(c.id)
  `);
  return new Set(
    getRows<{ collection_id: string }>(result)
      .map((row) => row.collection_id),
  );
}

export async function collectionProfileSourceIsCurrent(
  collectionId: string,
  storedFingerprint: string | null,
  database: CollectionProfileSourceDatabase = db,
): Promise<boolean> {
  if (!storedFingerprint) return false;
  return (
    await computeCollectionProfileSourceFingerprint(collectionId, database)
  ) === storedFingerprint;
}

/**
 * Re-check public profile authority in one PostgreSQL statement.
 *
 * Public routes may perform several dependent reads after their initial
 * collection lookup. This final guard deliberately reads the current status,
 * stored fingerprint, and live source fingerprint from one statement snapshot
 * so a concurrent revocation cannot be split across separate checks.
 */
export async function collectionProfilePublicationIsCurrent(
  collectionId: string,
  database: CollectionProfileSourceDatabase = db,
): Promise<boolean> {
  const result = await database.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM collections c
      WHERE c.id = ${collectionId}::uuid
        AND c.profile_status = 'VERIFIED'
        AND c.profile_source_fingerprint IS NOT NULL
        AND c.profile_source_fingerprint
          = compute_collection_profile_source_fingerprint(c.id)
    ) AS current
  `);
  const [row] = getRows<{ current: boolean }>(result);
  return row?.current === true;
}
