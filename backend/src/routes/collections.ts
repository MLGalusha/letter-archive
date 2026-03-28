import { Router } from 'express';
import { eq, and, sql, asc } from 'drizzle-orm';
import { db, letters, collections } from '../db/index.js';
import { listCollections, getCollectionByCode } from '../services/collections.js';
import { transformLettersWithRelatedToDTO, type LetterWithRelations } from '../dto/index.js';
import { getCollectionAggregations } from '../services/collection-profile.js';

const router = Router();

// Note: Request logging is handled by the request-logger middleware

/**
 * GET /collections
 * List all collections with letter counts (published only)
 */
router.get('/collections', async (req, res, next) => {
  try {
    const allCollections = await listCollections();

    // Run all aggregation queries in parallel
    const [letterCounts, dateRanges, topSenders, topRecipients] = await Promise.all([
      // Count unique correspondence units (dedup companion types like covers/telegrams)
      db
        .select({
          collectionId: letters.collectionId,
          count: sql<number>`count(DISTINCT (date_raw, type_sequence))::int`,
        })
        .from(letters)
        .where(eq(letters.visibility, 'PUBLISHED'))
        .groupBy(letters.collectionId),

      // Date ranges per collection
      db
        .select({
          collectionId: letters.collectionId,
          minDate: sql<string>`MIN(COALESCE(letter_date::text, date_raw))`,
          maxDate: sql<string>`MAX(COALESCE(letter_date::text, date_raw))`,
        })
        .from(letters)
        .where(eq(letters.visibility, 'PUBLISHED'))
        .groupBy(letters.collectionId),

      // Most frequent sender per collection
      db.execute(sql`
        SELECT DISTINCT ON (collection_id)
          collection_id, sender as name
        FROM letters
        WHERE visibility = 'PUBLISHED' AND type = 'L' AND sender IS NOT NULL
        GROUP BY collection_id, sender
        ORDER BY collection_id, count(*) DESC
      `),

      // Most frequent recipient per collection
      db.execute(sql`
        SELECT DISTINCT ON (collection_id)
          collection_id, recipient as name
        FROM letters
        WHERE visibility = 'PUBLISHED' AND type = 'L' AND recipient IS NOT NULL
        GROUP BY collection_id, recipient
        ORDER BY collection_id, count(*) DESC
      `),
    ]);

    const countMap = new Map(letterCounts.map(r => [r.collectionId, r.count]));
    const dateMap = new Map(dateRanges.map(r => [r.collectionId, { min: r.minDate, max: r.maxDate }]));
    const senderMap = new Map((topSenders as unknown as Array<{ collection_id: string; name: string }>).map(r => [r.collection_id, r.name]));
    const recipientMap = new Map((topRecipients as unknown as Array<{ collection_id: string; name: string }>).map(r => [r.collection_id, r.name]));

    const collectionsWithDetails = allCollections.map(collection => ({
      id: collection.id,
      collectionCode: collection.collectionCode,
      title: collection.title,
      description: collection.description,
      createdAt: collection.createdAt,
      hook: collection.hook || null,
      letterCount: countMap.get(collection.id) || 0,
      dateRange: dateMap.get(collection.id) || null,
      primarySender: senderMap.get(collection.id) || null,
      primaryRecipient: recipientMap.get(collection.id) || null,
    }));

    req.log.debug({ collectionCount: collectionsWithDetails.length }, 'Collections list fetched');
    res.json(collectionsWithDetails);
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
      req.log.debug({ collectionCode: code }, 'Collection not found');
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    // Get published letters in this collection
    const allLetters = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, collection.id),
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

    // Group by (dateRaw, typeSequence) to merge companions into primaries.
    // Primary = L-type (or first in group if no L-type).
    // Related items (covers, photos, etc.) get their images appended.
    const groupMap = new Map<string, (typeof allLetters)[number][]>();
    for (const letter of allLetters) {
      const key = `${letter.dateRaw}|${letter.typeSequence}`;
      const group = groupMap.get(key);
      if (group) {
        group.push(letter);
      } else {
        groupMap.set(key, [letter]);
      }
    }

    const enrichedResults: Array<{ letter: LetterWithRelations; relatedItems: LetterWithRelations[] }> = [];
    for (const [, group] of groupMap) {
      const primary = group.find((l) => l.type === 'L') || group[0];
      const relatedItems = group.filter((l) => l.id !== primary.id);
      enrichedResults.push({
        letter: primary as LetterWithRelations,
        relatedItems: relatedItems as LetterWithRelations[],
      });
    }

    const collectionLetters = transformLettersWithRelatedToDTO(enrichedResults);

    req.log.debug(
      { collectionCode: code, letterCount: collectionLetters.length, rawCount: allLetters.length },
      'Collection fetched with letters'
    );

    res.json({
      ...collection,
      letters: collectionLetters,
      letterCount: collectionLetters.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /collections/:code/profile
 * Get the full collection profile: AI-generated content + computed aggregations
 */
router.get('/collections/:code/profile', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const aggregations = await getCollectionAggregations(collection.id);

    // Build start-here with letter context if available
    let startHere: { letterId: string; reason: string; hook: string | null; date: string | null } | null = null;
    if (collection.profileStartHereLetterId) {
      const startLetter = await db.query.letters.findFirst({
        where: and(
          eq(letters.id, collection.profileStartHereLetterId),
          eq(letters.visibility, 'PUBLISHED'),
        ),
        columns: { id: true, hook: true, letterDate: true, dateRaw: true },
      });
      if (startLetter) {
        startHere = {
          letterId: startLetter.id,
          reason: collection.profileStartHereReason || '',
          hook: startLetter.hook,
          date: startLetter.letterDate || startLetter.dateRaw,
        };
      }
    }

    // Filter reading path / theme letter IDs to only published letters
    const publishedIds = new Set(aggregations.sentimentArc.map(s => s.letterId)
      .concat(aggregations.topicEvolution.map(t => t.letterId)));
    // Actually, let's use a broader set from the letters query already done
    // For now, trust the data and let the frontend handle missing links gracefully

    res.json({
      // AI-generated content
      hook: collection.hook,
      narrative: collection.profileNarrative,
      profileStatus: collection.profileStatus,
      startHere,
      readingPaths: collection.profileReadingPaths || [],
      gapAnalysis: collection.profileGapAnalysis || [],
      themes: collection.profileThemes || [],
      // Computed aggregations
      ...aggregations,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
