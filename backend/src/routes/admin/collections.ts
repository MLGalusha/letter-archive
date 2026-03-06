import { Router } from 'express';
import { eq, sql, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, collections, letterPages } from '../../db/index.js';
import { getCollectionByCode } from '../../services/collections.js';
import { transformLettersToDTO, type LetterWithRelations } from '../../dto/index.js';
import { getRows } from '../../services/letter-queries.js';
import { analyzeCollection } from '../../ai/analyze-collection.js';

const router = Router();

const updateCollectionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullable().optional(),
});

/**
 * GET /admin/collections
 * List all collections with full letter counts (all visibility states)
 */
router.get('/', async (_req, res, next) => {
  try {
    const allCollections = await db.query.collections.findMany({
      orderBy: (cols, { asc }) => [asc(cols.collectionCode)],
    });

    const collectionsWithStats = await Promise.all(
      allCollections.map(async (collection) => {
        // Use DISTINCT ON to count unique letter groups, not individual type rows
        // Each group is identified by (collection_id, date_raw, type_sequence)
        // We pick the L-type representative if available
        const statsResult = await db.execute(sql`
          WITH unique_groups AS (
            SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
              workflow, visibility, transcript_status, metadata_content_status, date_raw
            FROM letters
            WHERE collection_id = ${collection.id}
            ORDER BY collection_id, date_raw, type_sequence,
              CASE WHEN type = 'L' THEN 0 ELSE 1 END, type
          )
          SELECT
            count(*)::int as total,
            count(*) filter (where visibility = 'PUBLISHED')::int as published,
            count(*) filter (where visibility = 'HIDDEN')::int as hidden,
            count(*) filter (where workflow = 'UPLOADED')::int as uploaded,
            count(*) filter (where workflow = 'TRANSCRIBED')::int as transcribed,
            count(*) filter (where workflow = 'METADATA_DRAFTED')::int as metadata_ready,
            count(*) filter (where workflow = 'REVIEWED')::int as reviewed,
            count(*) filter (where transcript_status = 'VERIFIED' AND metadata_content_status = 'VERIFIED')::int as verified,
            min(date_raw) as min_date,
            max(date_raw) as max_date
          FROM unique_groups
        `);
        const statsRows = getRows<Record<string, number | string | bigint | null>>(statsResult);
        const stats = statsRows[0] || {};

        // Count letter pages and extra content pages
        const [pageCounts] = await db
          .select({
            letterPageCount: sql<number>`count(*) filter (where ${letters.type} = 'L')::int`,
            extraContentCount: sql<number>`count(*) filter (where ${letters.type} != 'L')::int`,
          })
          .from(letterPages)
          .innerJoin(letters, eq(letterPages.letterId, letters.id))
          .where(
            eq(letters.collectionId, collection.id)
          );

        return {
          ...collection,
          letterCount: Number(stats?.total || 0),
          publishedCount: Number(stats?.published || 0),
          hiddenCount: Number(stats?.hidden || 0),
          uploadedCount: Number(stats?.uploaded || 0),
          transcribedCount: Number(stats?.transcribed || 0),
          metadataReadyCount: Number(stats?.metadata_ready || 0),
          reviewedCount: Number(stats?.reviewed || 0),
          verifiedCount: Number(stats?.verified || 0),
          minDate: stats?.min_date || null,
          maxDate: stats?.max_date || null,
          letterPageCount: pageCounts?.letterPageCount || 0,
          extraContentCount: pageCounts?.extraContentCount || 0,
        };
      })
    );

    res.json(collectionsWithStats);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/collections/:code
 * Get a single collection with ALL letters (any visibility)
 */
router.get('/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const collectionLetters = await db.query.letters.findMany({
      where: eq(letters.collectionId, collection.id),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
      orderBy: [asc(letters.letterDate)],
    });

    res.json({
      ...collection,
      letters: transformLettersToDTO(collectionLetters as LetterWithRelations[]),
      letterCount: collectionLetters.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/collections/:code
 * Update collection metadata
 */
router.put('/:code', async (req, res, next) => {
  try {
    const { code } = req.params;

    const parseResult = updateCollectionSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
      return;
    }

    const collection = await getCollectionByCode(code);
    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const updates = parseResult.data;
    const [updated] = await db
      .update(collections)
      .set(updates)
      .where(eq(collections.id, collection.id))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/collections/:code/analyze
 * Analyze a collection to discover entities, relationships, and potential duplicates
 */
router.post('/:code/analyze', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const result = await analyzeCollection(collection.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
