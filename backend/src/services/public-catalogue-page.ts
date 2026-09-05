import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db, letters } from '../db/index.js';
import type { PublicLetterQuery } from '../schemas/letter.js';
import { publicCatalogueLetterTypeSql, publicCatalogueRepresentativeOrderSql } from './public-catalogue-unit.js';

interface CatalogueUnit {
  collectionId: string;
  dateRaw: string;
  typeSequence: number;
}

/** Select small unit keys before loading page images or text for the requested page. */
export function cataloguePageSql(conditions: SQL[], query: PublicLetterQuery) {
  const direction = query.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;
  const sort = query.sort === 'sender' ? sql`sender` : query.sort === 'createdAt'
    ? sql`created_at` : sql`REPLACE(date_raw, 'X', '0')`;
  return sql`
    WITH roots AS (
      SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
        collection_id, date_raw, type_sequence, created_at,
        CASE WHEN metadata_published THEN sender ELSE NULL END AS sender
      FROM ${letters}
      WHERE ${and(...conditions, publicCatalogueLetterTypeSql(letters.type))}
      ORDER BY collection_id, date_raw, type_sequence,
        ${publicCatalogueRepresentativeOrderSql(letters.type)}, ${letters.id}
    ), page AS (
      SELECT collection_id AS "collectionId", date_raw AS "dateRaw", type_sequence AS "typeSequence",
        ROW_NUMBER() OVER (ORDER BY ${sort} ${direction}, date_raw ${direction}, collection_id ${direction}, type_sequence ${direction}) AS position
      FROM roots
      ORDER BY ${sort} ${direction}, date_raw ${direction}, collection_id ${direction}, type_sequence ${direction}
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
    )
    SELECT (SELECT COUNT(*)::int FROM roots) AS total,
      COALESCE(json_agg(page ORDER BY position), '[]'::json) AS units FROM page
  `;
}

export async function getPublicCataloguePage(conditions: SQL[], query: PublicLetterQuery) {
  const result = await db.execute(cataloguePageSql(conditions, query));
  const row = (result as unknown as Array<{ total: number; units: CatalogueUnit[] }>)[0];
  const units = row?.units ?? [];
  return {
    total: Number(row?.total ?? 0),
    units,
    where: units.length ? and(...conditions, or(...units.map((unit) => and(
      eq(letters.collectionId, unit.collectionId),
      eq(letters.dateRaw, unit.dateRaw),
      eq(letters.typeSequence, unit.typeSequence),
    )))) : sql`FALSE`,
  };
}
