import { Router } from 'express';
import { eq, and, isNull, sql, asc } from 'drizzle-orm';
import { db, letters, collections } from '../db/index.js';
import { listCollections, getCollectionByCode } from '../services/collections.js';
import { transformLettersToDTO, type LetterWithRelations } from '../dto/index.js';

const router = Router();

/**
 * GET /collections
 * List all collections with letter counts (published only)
 */
router.get('/collections', async (_req, res, next) => {
  try {
    const allCollections = await listCollections();

    // Get letter counts for each collection (published only for public API)
    const collectionsWithCounts = await Promise.all(
      allCollections.map(async (collection) => {
        const [countResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(letters)
          .where(
            and(
              eq(letters.collectionId, collection.id),
              isNull(letters.deletedAt),
              eq(letters.visibility, 'PUBLISHED')
            )
          );

        return {
          ...collection,
          letterCount: countResult?.count || 0,
        };
      })
    );

    res.json(collectionsWithCounts);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /collections/next-number
 * Get the next available collection number
 */
router.get('/collections/next-number', async (_req, res, next) => {
  try {
    const allCollections = await listCollections();
    const maxCode = allCollections.reduce((max, c) => {
      const num = parseInt(c.collectionCode, 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);

    res.json({ nextCollectionNumber: maxCode + 1 });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /collections/:code
 * Get a single collection with its published letters
 */
router.get('/collections/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    // Get published letters in this collection
    const collectionLetters = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, collection.id),
        isNull(letters.deletedAt),
        eq(letters.visibility, 'PUBLISHED')
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

export default router;
