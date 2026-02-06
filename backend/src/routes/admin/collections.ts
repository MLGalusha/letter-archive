import { Router } from 'express';
import { eq, and, isNull, sql, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, collections } from '../../db/index.js';
import { getCollectionByCode } from '../../services/collections.js';
import { transformLettersToDTO, type LetterWithRelations } from '../../dto/index.js';

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
            published: sql<number>`count(*) filter (where ${letters.visibility} = 'PUBLISHED')::int`,
            draft: sql<number>`count(*) filter (where ${letters.visibility} = 'DRAFT')::int`,
          })
          .from(letters)
          .where(
            and(eq(letters.collectionId, collection.id), isNull(letters.deletedAt))
          );

        return {
          ...collection,
          letterCount: stats?.total || 0,
          publishedCount: stats?.published || 0,
          draftCount: stats?.draft || 0,
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

export default router;
