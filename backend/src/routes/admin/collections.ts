import { Router } from 'express';
import { eq, and, isNull, sql, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, collections, letterPages } from '../../db/index.js';
import { getCollectionByCode } from '../../services/collections.js';
import { transformLettersToDTO, type LetterWithRelations } from '../../dto/index.js';
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
        const [stats] = await db
          .select({
            total: sql<number>`count(*)::int`,
            // Visibility counts
            published: sql<number>`count(*) filter (where ${letters.visibility} = 'PUBLISHED')::int`,
            hidden: sql<number>`count(*) filter (where ${letters.visibility} = 'HIDDEN')::int`,
            // Workflow state counts
            uploaded: sql<number>`count(*) filter (where ${letters.workflow} = 'UPLOADED')::int`,
            transcribed: sql<number>`count(*) filter (where ${letters.workflow} = 'TRANSCRIBED')::int`,
            metadataReady: sql<number>`count(*) filter (where ${letters.workflow} = 'METADATA_DRAFTED')::int`,
            reviewed: sql<number>`count(*) filter (where ${letters.workflow} = 'REVIEWED')::int`,
            // Fully verified count (both transcript AND metadata verified)
            verified: sql<number>`count(*) filter (where ${letters.transcriptStatus} = 'VERIFIED' AND ${letters.metadataContentStatus} = 'VERIFIED')::int`,
            // Date range
            minDate: sql<string | null>`min(${letters.dateRaw})`,
            maxDate: sql<string | null>`max(${letters.dateRaw})`,
          })
          .from(letters)
          .where(
            and(eq(letters.collectionId, collection.id), isNull(letters.deletedAt))
          );

        // Count letter pages and extra content pages
        const [pageCounts] = await db
          .select({
            letterPageCount: sql<number>`count(*) filter (where ${letters.type} = 'L')::int`,
            extraContentCount: sql<number>`count(*) filter (where ${letters.type} != 'L')::int`,
          })
          .from(letterPages)
          .innerJoin(letters, eq(letterPages.letterId, letters.id))
          .where(
            and(eq(letters.collectionId, collection.id), isNull(letters.deletedAt))
          );

        return {
          ...collection,
          letterCount: stats?.total || 0,
          publishedCount: stats?.published || 0,
          hiddenCount: stats?.hidden || 0,
          uploadedCount: stats?.uploaded || 0,
          transcribedCount: stats?.transcribed || 0,
          metadataReadyCount: stats?.metadataReady || 0,
          reviewedCount: stats?.reviewed || 0,
          verifiedCount: stats?.verified || 0,
          minDate: stats?.minDate || null,
          maxDate: stats?.maxDate || null,
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
      where: and(
        eq(letters.collectionId, collection.id),
        isNull(letters.deletedAt)
      ),
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
