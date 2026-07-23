import { sql as rawSql } from '../db/index.js';
import { PUBLIC_CATALOGUE_LETTER_TYPES } from './public-catalogue-unit.js';

/**
 * Quality tiers for letter selection priority:
 *   1 = Fully verified (transcript AND metadata both VERIFIED)
 *   2 = Half verified (transcript OR metadata VERIFIED)
 *   3 = Has metadata  (metadata_content_status is AI_DRAFT or EDITED)
 *   4 = Any published letter
 *
 * Within the best available tier, prefers letters that have images.
 * Returns one random letter from the top tier, or null if none exist.
 */
export interface FeaturedLetterResult {
  id: string;
  hook: string | null;
  summary: string | null;
  letterDate: string | null;
  dateRaw: string;
  sender: string | null;
  recipient: string | null;
  collectionId: string;
  collectionCode: string;
  collectionTitle: string | null;
  imageUrl: string | null;
  imageType: string;
}

export async function pickFeaturedLetter(
  collectionId?: string,
): Promise<FeaturedLetterResult | null> {
  const collectionFilter = collectionId
    ? rawSql`AND l.collection_id = ${collectionId}`
    : rawSql``;
  const publicCatalogueTypes = rawSql(PUBLIC_CATALOGUE_LETTER_TYPES);

  const rows = await rawSql<FeaturedLetterResult[]>`
    WITH ranked AS (
      SELECT
        l.id,
        CASE
          WHEN l.metadata_published THEN l.hook
          WHEN l.type = 'P'
            AND l.photo_description_status = 'VERIFIED'
            AND NOT EXISTS (
            SELECT 1
            FROM letters peer
            WHERE peer.collection_id = l.collection_id
              AND peer.date_raw = l.date_raw
              AND peer.type_sequence = l.type_sequence
              AND peer.visibility = 'PUBLISHED'
              AND peer.type <> 'P'
          ) THEN l.photo_description
          ELSE NULL
        END AS hook,
        CASE WHEN l.metadata_published THEN l.summary ELSE NULL END AS summary,
        l.letter_date   AS "letterDate",
        l.date_raw       AS "dateRaw",
        CASE WHEN l.metadata_published THEN l.sender ELSE NULL END AS sender,
        CASE WHEN l.metadata_published THEN l.recipient ELSE NULL END AS recipient,
        l.collection_id  AS "collectionId",
        c.collection_code AS "collectionCode",
        c.title           AS "collectionTitle",
        l.type            AS "imageType",
        CASE
          WHEN l.transcript_published
           AND l.metadata_published
           AND l.transcript_status = 'VERIFIED'
           AND l.metadata_content_status = 'VERIFIED' THEN 1
          WHEN (l.transcript_published AND l.transcript_status = 'VERIFIED')
            OR (l.metadata_published AND l.metadata_content_status = 'VERIFIED') THEN 2
          WHEN l.metadata_published
            AND l.metadata_content_status IN ('AI_DRAFT', 'EDITED') THEN 3
          ELSE 4
        END AS quality_tier,
        EXISTS (
          SELECT 1 FROM letter_pages lp WHERE lp.letter_id = l.id
        ) AS has_images
      FROM letters l
      JOIN collections c ON c.id = l.collection_id
      WHERE l.visibility = 'PUBLISHED'
        AND l.type IN ${publicCatalogueTypes}
        ${collectionFilter}
    )
    SELECT
      r.id, r.hook, r.summary, r."letterDate", r."dateRaw",
      r.sender, r.recipient, r."collectionId",
      r."collectionCode", r."collectionTitle", r."imageType",
      CASE WHEN r.has_images THEN
        '/images/' || (
          SELECT lp.id ||
            CASE WHEN lp.checksum_sha256 IS NOT NULL
              THEN '?v=' || LEFT(lp.checksum_sha256, 8)
              ELSE ''
            END
          FROM letter_pages lp
          WHERE lp.letter_id = r.id
          ORDER BY lp.page_number
          LIMIT 1
        )
      ELSE NULL END AS "imageUrl"
    FROM ranked r
    WHERE r.quality_tier = (SELECT MIN(quality_tier) FROM ranked)
    ORDER BY r.has_images DESC, RANDOM()
    LIMIT 1
  `;

  return rows[0] ?? null;
}
