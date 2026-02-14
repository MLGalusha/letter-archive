import { eq, asc, desc, sql } from 'drizzle-orm';
import {
  db,
  canonicalPlaces,
  letterPlaces,
  type CanonicalPlace,
  type NewCanonicalPlace,
  type PlaceType,
} from '../../db/index.js';
import type { DuplicateSuggestion } from './persons.js';

export async function createCanonicalPlace(
  data: Omit<NewCanonicalPlace, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const [place] = await db
    .insert(canonicalPlaces)
    .values(data)
    .returning({ id: canonicalPlaces.id });
  return place.id;
}

export async function getCanonicalPlaceById(
  id: string,
): Promise<CanonicalPlace | undefined> {
  return db.query.canonicalPlaces.findFirst({
    where: eq(canonicalPlaces.id, id),
  });
}

export async function getAllCanonicalPlaces(): Promise<CanonicalPlace[]> {
  return db.query.canonicalPlaces.findMany({
    orderBy: [asc(canonicalPlaces.canonicalName)],
  });
}

export async function updateCanonicalPlace(
  id: string,
  data: Partial<
    Pick<CanonicalPlace, 'canonicalName' | 'aliases' | 'placeType' | 'notes'>
  >,
): Promise<void> {
  await db
    .update(canonicalPlaces)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(canonicalPlaces.id, id));
}

export async function mergePlaces(keepId: string, mergeId: string): Promise<void> {
  const keepPlace = await getCanonicalPlaceById(keepId);
  const mergePlace = await getCanonicalPlaceById(mergeId);

  if (!keepPlace || !mergePlace) {
    throw new Error('Both places must exist');
  }

  const combinedAliases = [
    ...(keepPlace.aliases || []),
    mergePlace.canonicalName,
    ...(mergePlace.aliases || []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  await updateCanonicalPlace(keepId, { aliases: combinedAliases });

  await db
    .update(letterPlaces)
    .set({ placeId: keepId })
    .where(eq(letterPlaces.placeId, mergeId));

  await db.delete(canonicalPlaces).where(eq(canonicalPlaces.id, mergeId));
}

export async function getAllPlacesWithCounts(): Promise<
  {
    id: string;
    canonicalName: string;
    aliases: string[] | null;
    placeType: PlaceType | null;
    letterCount: number;
  }[]
> {
  const results = await db
    .select({
      id: canonicalPlaces.id,
      canonicalName: canonicalPlaces.canonicalName,
      aliases: canonicalPlaces.aliases,
      placeType: canonicalPlaces.placeType,
      letterCount: sql<number>`COUNT(DISTINCT ${letterPlaces.letterId})`,
    })
    .from(canonicalPlaces)
    .leftJoin(letterPlaces, eq(canonicalPlaces.id, letterPlaces.placeId))
    .groupBy(
      canonicalPlaces.id,
      canonicalPlaces.canonicalName,
      canonicalPlaces.aliases,
      canonicalPlaces.placeType,
    )
    .orderBy(desc(sql`COUNT(DISTINCT ${letterPlaces.letterId})`));

  return results.map((r) => ({
    id: r.id,
    canonicalName: r.canonicalName,
    aliases: r.aliases,
    placeType: r.placeType,
    letterCount: Number(r.letterCount),
  }));
}

function getRows<T>(results: unknown): T[] {
  if (Array.isArray(results)) {
    return results as T[];
  }
  return ((results as { rows?: T[] }).rows ?? []) as T[];
}

export async function findPotentialDuplicatePlaces(
  limit: number = 20,
): Promise<DuplicateSuggestion[]> {
  const results = await db.execute<{
    entity_a_id: string;
    entity_a_name: string;
    entity_a_letter_count: number;
    entity_a_aliases: string[] | null;
    entity_b_id: string;
    entity_b_name: string;
    entity_b_letter_count: number;
    entity_b_aliases: string[] | null;
    similarity_score: number;
  }>(sql`
    WITH place_letter_counts AS (
      SELECT
        cp.id,
        cp.canonical_name,
        cp.aliases,
        COUNT(DISTINCT lp.letter_id) as letter_count
      FROM canonical_places cp
      LEFT JOIN letter_places lp ON cp.id = lp.place_id
      GROUP BY cp.id, cp.canonical_name, cp.aliases
    )
    SELECT
      a.id as entity_a_id,
      a.canonical_name as entity_a_name,
      a.letter_count::int as entity_a_letter_count,
      a.aliases as entity_a_aliases,
      b.id as entity_b_id,
      b.canonical_name as entity_b_name,
      b.letter_count::int as entity_b_letter_count,
      b.aliases as entity_b_aliases,
      similarity(a.canonical_name, b.canonical_name) as similarity_score
    FROM place_letter_counts a
    CROSS JOIN place_letter_counts b
    WHERE a.id < b.id
      AND similarity(a.canonical_name, b.canonical_name) >= 0.50
      AND similarity(a.canonical_name, b.canonical_name) < 1.0
    ORDER BY similarity_score DESC
    LIMIT ${limit}
  `);

  return getRows<{
    entity_a_id: string;
    entity_a_name: string;
    entity_a_letter_count: number;
    entity_a_aliases: string[] | null;
    entity_b_id: string;
    entity_b_name: string;
    entity_b_letter_count: number;
    entity_b_aliases: string[] | null;
    similarity_score: number;
  }>(results).map((row) => ({
    entityAId: row.entity_a_id,
    entityAName: row.entity_a_name,
    entityALetterCount: Number(row.entity_a_letter_count),
    entityAAliases: row.entity_a_aliases || [],
    entityBId: row.entity_b_id,
    entityBName: row.entity_b_name,
    entityBLetterCount: Number(row.entity_b_letter_count),
    entityBAliases: row.entity_b_aliases || [],
    similarity: Math.round(row.similarity_score * 100),
  }));
}

export async function bulkMergePlaces(
  keepId: string,
  mergeIds: string[],
): Promise<void> {
  const keepPlace = await getCanonicalPlaceById(keepId);
  if (!keepPlace) {
    throw new Error('Master place not found');
  }

  const idsToMerge = mergeIds.filter((id) => id !== keepId);
  if (idsToMerge.length === 0) {
    throw new Error('No places to merge');
  }

  for (const mergeId of idsToMerge) {
    const mergePlace = await getCanonicalPlaceById(mergeId);
    if (mergePlace) {
      await mergePlaces(keepId, mergeId);
    }
  }
}

export interface PlaceDetailsForMerge {
  id: string;
  canonicalName: string;
  aliases: string[];
  placeType: PlaceType | null;
  notes: string | null;
  letterCount: number;
  writtenFromCount: number;
  mentionedCount: number;
  destinationCount: number;
}

export async function getPlaceDetailsForMerge(
  id: string,
): Promise<PlaceDetailsForMerge | null> {
  const place = await getCanonicalPlaceById(id);
  if (!place) return null;

  const roleCountsResult = await db
    .select({
      role: letterPlaces.role,
      count: sql<number>`COUNT(*)`,
    })
    .from(letterPlaces)
    .where(eq(letterPlaces.placeId, id))
    .groupBy(letterPlaces.role);

  const roleCounts = {
    written_from: 0,
    mentioned: 0,
    destination: 0,
  };

  for (const r of roleCountsResult) {
    if (r.role === 'written_from') roleCounts.written_from = Number(r.count);
    else if (r.role === 'mentioned') roleCounts.mentioned = Number(r.count);
    else if (r.role === 'destination') roleCounts.destination = Number(r.count);
  }

  return {
    id: place.id,
    canonicalName: place.canonicalName,
    aliases: place.aliases || [],
    placeType: place.placeType,
    notes: place.notes,
    letterCount: roleCounts.written_from + roleCounts.mentioned + roleCounts.destination,
    writtenFromCount: roleCounts.written_from,
    mentionedCount: roleCounts.mentioned,
    destinationCount: roleCounts.destination,
  };
}
