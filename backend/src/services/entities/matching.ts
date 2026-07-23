import { sql } from 'drizzle-orm';
import { db, type Database } from '../../db/index.js';

type MatchingDatabase = Pick<Database, 'execute'>;

const MATCH_THRESHOLDS = {
  AUTO_LINK: 0.85,
  SUGGEST: 0.50,
};

export interface MatchResult {
  entityId: string;
  canonicalName: string;
  matchedOn: 'canonical_name' | 'alias';
  similarity: number;
}

function getRows<T>(results: unknown): T[] {
  if (Array.isArray(results)) {
    return results as T[];
  }
  return ((results as { rows?: T[] }).rows ?? []) as T[];
}

export async function findMatchingPersons(
  name: string,
  limit: number = 5,
  database: MatchingDatabase = db,
): Promise<MatchResult[]> {
  const results = await database.execute<{
    id: string;
    canonical_name: string;
    matched_on: string;
    similarity_score: number;
  }>(sql`
    SELECT
      id,
      canonical_name,
      'canonical_name' as matched_on,
      similarity(canonical_name, ${name}) as similarity_score
    FROM canonical_persons
    WHERE similarity(canonical_name, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}

    UNION ALL

    SELECT
      id,
      canonical_name,
      'alias' as matched_on,
      (SELECT MAX(similarity(alias, ${name})) FROM unnest(aliases) AS alias) as similarity_score
    FROM canonical_persons
    WHERE EXISTS (
      SELECT 1 FROM unnest(aliases) AS alias
      WHERE similarity(alias, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}
    )

    ORDER BY similarity_score DESC
    LIMIT ${limit}
  `);

  return getRows<{
    id: string;
    canonical_name: string;
    matched_on: string;
    similarity_score: number;
  }>(results).map((row) => ({
    entityId: row.id,
    canonicalName: row.canonical_name,
    matchedOn: row.matched_on as 'canonical_name' | 'alias',
    similarity: Math.round(row.similarity_score * 100),
  }));
}

export async function findMatchingPlaces(
  name: string,
  limit: number = 5,
  database: MatchingDatabase = db,
): Promise<MatchResult[]> {
  const results = await database.execute<{
    id: string;
    canonical_name: string;
    matched_on: string;
    similarity_score: number;
  }>(sql`
    SELECT
      id,
      canonical_name,
      'canonical_name' as matched_on,
      similarity(canonical_name, ${name}) as similarity_score
    FROM canonical_places
    WHERE similarity(canonical_name, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}

    UNION ALL

    SELECT
      id,
      canonical_name,
      'alias' as matched_on,
      (SELECT MAX(similarity(alias, ${name})) FROM unnest(aliases) AS alias) as similarity_score
    FROM canonical_places
    WHERE EXISTS (
      SELECT 1 FROM unnest(aliases) AS alias
      WHERE similarity(alias, ${name}) > ${MATCH_THRESHOLDS.SUGGEST}
    )

    ORDER BY similarity_score DESC
    LIMIT ${limit}
  `);

  return getRows<{
    id: string;
    canonical_name: string;
    matched_on: string;
    similarity_score: number;
  }>(results).map((row) => ({
    entityId: row.id,
    canonicalName: row.canonical_name,
    matchedOn: row.matched_on as 'canonical_name' | 'alias',
    similarity: Math.round(row.similarity_score * 100),
  }));
}
