import { Router } from 'express';
import { eq, sql, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, collections, letterPages } from '../../db/index.js';
import { getCollectionByCode } from '../../services/collections.js';
import { transformLettersToDTO, type LetterWithRelations } from '../../dto/index.js';
import { getRows } from '../../services/letter-queries.js';
import { analyzeCollection } from '../../ai/analyze-collection.js';
import { resolveCollectionEntities } from '../../services/entities/resolution.js';
import {
  assessCollectionCompleteness,
  generateCollectionProfile,
} from '../../ai/generate-collection-profile.js';

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

    // Batch stats query — one query for ALL collections instead of N+1
    const statsResult = await db.execute(sql`
      WITH unique_groups AS (
        SELECT DISTINCT ON (collection_id, date_raw, type_sequence)
          collection_id, workflow, visibility, transcript_status, metadata_content_status, date_raw
        FROM letters
        ORDER BY collection_id, date_raw, type_sequence,
          CASE WHEN type = 'L' THEN 0 ELSE 1 END, type
      )
      SELECT
        collection_id,
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
      GROUP BY collection_id
    `);
    const statsRows = getRows<Record<string, number | string | bigint | null>>(statsResult);
    const statsMap = new Map(statsRows.map(r => [r.collection_id as string, r]));

    // Batch page counts query — one query for ALL collections
    const pageCountRows = await db
      .select({
        collectionId: letters.collectionId,
        letterPageCount: sql<number>`count(*) filter (where ${letters.type} = 'L')::int`,
        extraContentCount: sql<number>`count(*) filter (where ${letters.type} != 'L')::int`,
      })
      .from(letterPages)
      .innerJoin(letters, eq(letterPages.letterId, letters.id))
      .groupBy(letters.collectionId);
    const pageCountMap = new Map(pageCountRows.map(r => [r.collectionId, r]));

    const collectionsWithStats = allCollections.map((collection) => {
      const stats = statsMap.get(collection.id) || {};
      const pageCounts = pageCountMap.get(collection.id);

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
    });

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

/**
 * POST /admin/collections/:code/resolve-entities
 * Run collection-level entity resolution (merges, generics, fills, bios)
 */
router.post('/:code/resolve-entities', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const result = await resolveCollectionEntities(collection.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// COLLECTION PROFILE ENDPOINTS
// ============================================================================

/**
 * GET /admin/collections/:code/profile/completeness
 * Check data completeness before generating a profile
 */
router.get('/:code/profile/completeness', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const completeness = await assessCollectionCompleteness(collection.id);
    res.json(completeness);
  } catch (error) {
    next(error);
  }
});

const generateProfileSchema = z.object({
  force: z.boolean().optional(),
});

/**
 * POST /admin/collections/:code/generate-profile
 * Generate an AI collection profile (or regenerate with force: true)
 */
router.post('/:code/generate-profile', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const body = generateProfileSchema.parse(req.body || {});

    // Check if profile already exists
    if (collection.profileStatus !== 'EMPTY' && !body.force) {
      res.status(409).json({
        error: 'Profile already exists',
        message: 'Use force: true to regenerate',
        profileStatus: collection.profileStatus,
      });
      return;
    }

    const result = await generateCollectionProfile(collection.id);

    // Store results
    await db.update(collections).set({
      profileNarrative: result.narrative,
      profileStartHereLetterId: result.startHereLetterId,
      profileStartHereReason: result.startHereReason,
      profileReadingPaths: result.readingPaths,
      profileGapAnalysis: result.gapAnalysis,
      profileThemes: result.themes,
      profileStatus: 'AI_DRAFT',
      profileGeneratedAt: new Date(),
    }).where(eq(collections.id, collection.id));

    res.json({
      ...result,
      profileStatus: 'AI_DRAFT',
    });
  } catch (error) {
    next(error);
  }
});

const updateProfileSchema = z.object({
  profileNarrative: z.string().max(10000).optional(),
  profileStartHereLetterId: z.string().uuid().nullable().optional(),
  profileStartHereReason: z.string().max(500).optional(),
  profileReadingPaths: z.array(z.object({
    title: z.string(),
    description: z.string(),
    letterIds: z.array(z.string().uuid()),
  })).optional(),
  profileGapAnalysis: z.array(z.object({
    startDate: z.string(),
    endDate: z.string(),
    description: z.string(),
  })).optional(),
  profileThemes: z.array(z.object({
    name: z.string(),
    description: z.string(),
    letterIds: z.array(z.string().uuid()),
  })).optional(),
  profileStatus: z.enum(['AI_DRAFT', 'EDITED', 'VERIFIED']).optional(),
});

/**
 * PUT /admin/collections/:code/profile
 * Update profile content and/or status
 */
router.put('/:code/profile', async (req, res, next) => {
  try {
    const { code } = req.params;
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const parseResult = updateProfileSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
      return;
    }

    const updates: Record<string, unknown> = {};
    const data = parseResult.data;

    if (data.profileNarrative !== undefined) updates.profileNarrative = data.profileNarrative;
    if (data.profileStartHereLetterId !== undefined) updates.profileStartHereLetterId = data.profileStartHereLetterId;
    if (data.profileStartHereReason !== undefined) updates.profileStartHereReason = data.profileStartHereReason;
    if (data.profileReadingPaths !== undefined) updates.profileReadingPaths = data.profileReadingPaths;
    if (data.profileGapAnalysis !== undefined) updates.profileGapAnalysis = data.profileGapAnalysis;
    if (data.profileThemes !== undefined) updates.profileThemes = data.profileThemes;
    if (data.profileStatus !== undefined) updates.profileStatus = data.profileStatus;

    // Auto-upgrade status from AI_DRAFT to EDITED if content changes (but not if status is explicitly set)
    if (!data.profileStatus && collection.profileStatus === 'AI_DRAFT' && Object.keys(updates).length > 0) {
      updates.profileStatus = 'EDITED';
    }

    if (Object.keys(updates).length > 0) {
      await db.update(collections).set(updates).where(eq(collections.id, collection.id));
    }

    const updated = await db.query.collections.findFirst({
      where: eq(collections.id, collection.id),
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
