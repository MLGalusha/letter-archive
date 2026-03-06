import { Router } from 'express';
import { eq, and, inArray, ilike, asc, desc, sql } from 'drizzle-orm';
import { db, letters, collections } from '../db/index.js';
import { letterQuerySchema } from '../schemas/letter.js';
import {
  transformLetterToDTO,
  transformLettersToDTO,
  transformLetterWithRelatedToDTO,
  transformLettersWithRelatedToDTO,
  type LetterWithRelations,
} from '../dto/index.js';
import { logIfSlow, TIMING_THRESHOLDS } from '../utils/logger.js';

const router = Router();

/**
 * GET /letters - List letters with optional filtering
 *
 * IMPORTANT: Workflow filter is applied to the PRIMARY of each group, not to
 * individual letter records. This ensures that filtering to "UPLOADED" doesn't
 * show a C-type cover when its L-type letter is already TRANSCRIBED.
 */
router.get('/letters', async (req, res, next) => {
  const start = Date.now();
  try {
    const query = letterQuerySchema.parse(req.query);

    req.log.debug(
      { collection: query.collection, visibility: query.visibility, workflow: query.workflow, page: query.page },
      'Letters list query'
    );

    // Build conditions WITHOUT workflow filter (applied after grouping)
    const conditions = [];

    // Filter by collection code - supports partial matching (e.g., "7" matches "007")
    if (query.collection) {
      const escapedCollection = query.collection.replace(/%/g, '\\%').replace(/_/g, '\\_');
      const matchingCollections = await db.query.collections.findMany({
        where: ilike(collections.collectionCode, `%${escapedCollection}`),
      });
      if (matchingCollections.length > 0) {
        conditions.push(inArray(letters.collectionId, matchingCollections.map(c => c.id)));
      } else {
        // Collection not found, return empty results
        res.json({ letters: [], page: query.page, limit: query.limit, total: 0 });
        return;
      }
    }

    // Filter by visibility (can apply directly since all types share visibility)
    if (query.visibility) {
      conditions.push(eq(letters.visibility, query.visibility));
    }

    // NOTE: workflow filter NOT applied here - applied after grouping below

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

    // Fetch all letters (no workflow filter yet) - we need all types to determine primary
    // Note: We fetch more than limit to account for filtering after grouping
    const results = await db.query.letters.findMany({
      where: and(...conditions),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc: pageAsc }) => [pageAsc(p.pageNumber)],
        },
      },
      orderBy: [sortFn(getSortExpression())],
    });

    // Group letters by (collectionId, dateRaw, typeSequence) to handle related items
    const allResults = results as LetterWithRelations[];

    // Build a map of group keys to all letters in that group
    const groupMap = new Map<string, LetterWithRelations[]>();
    for (const letter of allResults) {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      group.push(letter);
      groupMap.set(key, group);
    }

    // Select primaries and apply workflow filter to the PRIMARY (not individual records)
    const filteredResults: LetterWithRelations[] = [];
    for (const [_key, group] of groupMap) {
      // Find the primary: L-type if exists, else first by type alphabetically
      const lType = group.find((l) => l.type === 'L');
      const primary = lType || [...group].sort((a, b) => a.type.localeCompare(b.type))[0];

      // Apply workflow filter to PRIMARY's workflow state
      if (query.workflow && primary.workflow !== query.workflow) {
        continue; // Skip entire group if primary doesn't match workflow filter
      }

      filteredResults.push(primary);
    }

    // Apply pagination after filtering
    const paginatedResults = filteredResults.slice(
      (query.page - 1) * query.limit,
      query.page * query.limit
    );

    // Enrich primary letters with related content from the already-loaded groupMap
    const enrichedResults = paginatedResults.map((letter) => {
      const key = `${letter.collectionId}:${letter.dateRaw}:${letter.typeSequence}`;
      const group = groupMap.get(key) || [];
      const relatedItems = group.filter((l) => l.id !== letter.id);
      return { letter, relatedItems };
    });

    // Transform to frontend-compatible format with related items
    const transformedLetters = transformLettersWithRelatedToDTO(enrichedResults);

    const duration = Date.now() - start;
    req.log.info(
      { resultCount: transformedLetters.length, totalGroups: filteredResults.length, page: query.page, duration },
      'Letters list completed'
    );
    logIfSlow(req.log, 'letters list query', duration, TIMING_THRESHOLDS.DB_QUERY);

    res.json({
      letters: transformedLetters,
      page: query.page,
      limit: query.limit,
      total: filteredResults.length,
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
    req.log.debug({ letterId }, 'Fetching letter');

    const letter = await db.query.letters.findFirst({
      where: and(
        eq(letters.id, letterId),

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
      req.log.debug({ letterId }, 'Letter not found or not published');
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Fetch related items (all other types with same date/sequence)
    const related = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
        sql`${letters.type} != ${letter.type}`, // Exclude the current letter's type

      ),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
      orderBy: (l, { asc }) => [asc(l.type)], // Alphabetical by type
    });
    const relatedItems = related as LetterWithRelations[];

    // Transform to frontend-compatible format, including related items
    res.json(transformLetterWithRelatedToDTO(letter as LetterWithRelations, relatedItems));
  } catch (error) {
    next(error);
  }
});

/**
 * GET /letters/:letterId/adjacent - Get prev/next letters in the same collection
 * Returns the adjacent letter IDs and the current position within the collection
 */
router.get('/letters/:letterId/adjacent', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Find the current letter
    const letter = await db.query.letters.findFirst({
      where: and(
        eq(letters.id, letterId),

        eq(letters.visibility, 'PUBLISHED')
      ),
      columns: {
        id: true,
        collectionId: true,
        dateRaw: true,
        createdAt: true,
      },
    });

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Only include L-type (letter) records in navigation, ordered by date
    const collectionLetters = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.type, 'L'),
        eq(letters.visibility, 'PUBLISHED'),

      ),
      columns: {
        id: true,
        dateRaw: true,
        createdAt: true,
      },
      orderBy: [asc(letters.dateRaw), asc(letters.createdAt)],
    });

    // Find current position
    const currentIndex = collectionLetters.findIndex(l => l.id === letterId);

    if (currentIndex === -1) {
      // Letter exists but not in L-type list (might be a cover)
      res.json({
        prev: null,
        next: null,
        position: null,
        total: collectionLetters.length,
      });
      return;
    }

    const prev = currentIndex > 0 ? collectionLetters[currentIndex - 1].id : null;
    const next = currentIndex < collectionLetters.length - 1 ? collectionLetters[currentIndex + 1].id : null;

    res.json({
      prev,
      next,
      position: currentIndex + 1,
      total: collectionLetters.length,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
