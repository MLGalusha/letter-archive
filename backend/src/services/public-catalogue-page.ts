import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db, letters } from '../db/index.js';
import type { PublicLetterQuery } from '../schemas/letter.js';
import { publicCatalogueChronologySql, publicCatalogueLetterTypeSql, publicCatalogueRepresentativeOrderSql } from './public-catalogue-unit.js';

interface CatalogueUnit {
  collectionId: string;
  dateRaw: string;
  typeSequence: number;
}

/** Select small unit keys before loading page images or text for the requested page. */
export function cataloguePageSql(conditions: SQL[], query: PublicLetterQuery) {
  const direction = query.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;
  const chronology = publicCatalogueChronologySql(sql`date_raw`, sql`collection_id`, sql`type_sequence`, query.sortOrder === 'desc');
  const ordering = query.sort === 'letterDate' ? chronology
    : sql`${query.sort === 'sender' ? sql`sender` : sql`created_at`} ${direction}, ${chronology}`;
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
        ROW_NUMBER() OVER (ORDER BY ${ordering}) AS position
      FROM roots
      ORDER BY ${ordering}
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
