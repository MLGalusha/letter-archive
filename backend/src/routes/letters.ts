import { Router } from 'express';
import { eq, and, isNull, inArray, asc, desc, sql } from 'drizzle-orm';
import { db, letters, collections } from '../db/index.js';
import { letterQuerySchema } from '../schemas/letter.js';
import {
  transformLetterToDTO,
  transformLettersToDTO,
  transformLetterWithRelatedToDTO,
  type LetterWithRelations,
} from '../dto/index.js';

const router = Router();

/**
 * GET /letters - List letters with optional filtering
 */
router.get('/letters', async (req, res, next) => {
  try {
    const query = letterQuerySchema.parse(req.query);
    const conditions = [isNull(letters.deletedAt)];

    // Filter by collection code
    if (query.collection) {
      const collection = await db.query.collections.findFirst({
        where: eq(collections.collectionCode, query.collection),
      });
      if (collection) {
        conditions.push(eq(letters.collectionId, collection.id));
      } else {
        // Collection not found, return empty results
        res.json({ letters: [], page: query.page, limit: query.limit, total: 0 });
        return;
      }
    }

    // Filter by visibility
    if (query.visibility) {
      conditions.push(eq(letters.visibility, query.visibility));
    }

    // Filter by workflow
    if (query.workflow) {
      conditions.push(eq(letters.workflow, query.workflow));
    }

    // Determine sort column and order
    // For date sorting, use dateRaw with X replaced by 0
    // This makes unknown dates sort at the start of their range:
    // 18XXXXXX → 18000000, so "1800s" comes before "1801"
    const sortFn = query.sortOrder === 'asc' ? asc : desc;
    const getSortExpression = () => {
      switch (query.sort) {
        case 'letterDate':
          // Replace X with 0 so unknown parts sort at the beginning of their range
          return sql`REPLACE(${letters.dateRaw}, 'X', '0')`;
        case 'sender':
          return letters.sender;
        case 'workflow':
          return letters.workflow;
        case 'visibility':
          return letters.visibility;
        case 'createdAt':
        default:
          return letters.createdAt;
      }
    };

    const results = await db.query.letters.findMany({
      where: and(...conditions),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc: pageAsc }) => [pageAsc(p.pageNumber)],
        },
      },
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
      orderBy: [sortFn(getSortExpression())],
    });

    // Transform to frontend-compatible format
    const transformedLetters = transformLettersToDTO(results as LetterWithRelations[]);

    res.json({
      letters: transformedLetters,
      page: query.page,
      limit: query.limit,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /letters/:letterId - Get a single letter with pages
 * Also fetches related cards (C) and extras (E) for the same date/sequence
 */
router.get('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const letter = await db.query.letters.findFirst({
      where: and(
        eq(letters.id, letterId),
        isNull(letters.deletedAt),
        eq(letters.visibility, 'PUBLISHED')
      ),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // If this is a letter (L type), fetch related cards (C) and extras (E)
    let relatedItems: LetterWithRelations[] = [];
    if (letter.type === 'L') {
      const related = await db.query.letters.findMany({
        where: and(
          eq(letters.collectionId, letter.collectionId),
          eq(letters.dateRaw, letter.dateRaw),
          eq(letters.typeSequence, letter.typeSequence),
          inArray(letters.type, ['P', 'E', 'V', 'A', 'D', 'C', 'N', 'T']),
          isNull(letters.deletedAt)
        ),
        with: {
          collection: true,
          pages: {
            orderBy: (p, { asc }) => [asc(p.pageNumber)],
          },
        },
        orderBy: (l, { asc }) => [asc(l.type)], // C before E
      });
      relatedItems = related as LetterWithRelations[];
    }

    // Transform to frontend-compatible format, including related items
    res.json(transformLetterWithRelatedToDTO(letter as LetterWithRelations, relatedItems));
  } catch (error) {
    next(error);
  }
});

export default router;
