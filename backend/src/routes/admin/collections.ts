import { Router } from 'express';
import { eq, sql, asc } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, letterPages } from '../../db/index.js';
import {
  getCollectionByCode,
  resolveCollectionStartHere,
} from '../../services/collections.js';
import { transformLettersWithRelatedToDTO, type LetterWithRelations } from '../../dto/index.js';
import { getRows } from '../../services/letter-queries.js';
import { resolveRepresentativeLetterId } from '../../services/letters.js';
import {
  assessCollectionCompleteness,
  generateCollectionProfile,
} from '../../ai/generate-collection-profile.js';
import { AppError } from '../../utils/response-helpers.js';
import {
  applyCollectionEditorMutation,
  collectionIdentityFingerprint,
} from '../../services/collection-editor-mutation.js';
import {
  storeGeneratedCollectionProfile,
  updateCollectionProfile,
  updateCollectionSourceMetadata,
  type CollectionProfileChanges,
} from '../../services/collection-profile-mutations.js';

const router = Router();

interface ProfileCorrespondent {
  name: string;
  biography: string | null;
  hook: string | null;
}

function normalizeProfileCorrespondents(input: unknown): ProfileCorrespondent[] {
  if (!Array.isArray(input)) return [];

  const correspondents = new Map<string, ProfileCorrespondent>();

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const rawName = 'name' in item && typeof item.name === 'string' ? item.name.trim() : '';
    if (!rawName) continue;

    const hook = 'hook' in item && typeof item.hook === 'string'
      ? item.hook.trim() || null
      : null;
    const biography = 'biography' in item && typeof item.biography === 'string'
      ? item.biography.trim() || null
      : null;

    correspondents.set(rawName.toLowerCase(), {
      name: rawName,
      hook,
      biography,
    });
  }

  return Array.from(correspondents.values());
}

const updateCollectionSchema = z.object({
  profileRevision: z.number().int().nonnegative(),
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
        max(date_raw) as max_date,
        min(date_raw) filter (where date_raw NOT LIKE '%X%') as min_date_specific,
        max(date_raw) filter (where date_raw NOT LIKE '%X%') as max_date_specific
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

    // Batch type counts query — count of letters by type per collection
    const typeCountResult = await db.execute(sql`
      SELECT collection_id, type, count(*)::int as cnt
      FROM letters
      GROUP BY collection_id, type
    `);
    const typeCountRows = getRows<{ collection_id: string; type: string; cnt: number }>(typeCountResult);
    const typeCountMap = new Map<string, Record<string, number>>();
    for (const row of typeCountRows) {
      const collId = row.collection_id as string;
      if (!typeCountMap.has(collId)) typeCountMap.set(collId, {});
      typeCountMap.get(collId)![row.type as string] = Number(row.cnt);
    }

    const collectionsWithStats = allCollections.map((collection) => {
      const stats = statsMap.get(collection.id) || {};
      const pageCounts = pageCountMap.get(collection.id);
      const typeCounts = typeCountMap.get(collection.id) || {};

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
        minDate: stats?.min_date_specific || stats?.min_date || null,
        maxDate: stats?.max_date_specific || stats?.max_date || null,
        minDateSpecific: Boolean(stats?.min_date_specific),
        maxDateSpecific: Boolean(stats?.max_date_specific),
        letterPageCount: pageCounts?.letterPageCount || 0,
        extraContentCount: pageCounts?.extraContentCount || 0,
        typeCounts: {
          letter: typeCounts['L'] || 0,
          photo: typeCounts['P'] || 0,
          cover: typeCounts['C'] || 0,
          telegram: typeCounts['T'] || 0,
          card: typeCounts['N'] || 0,
          ephemera: typeCounts['E'] || 0,
          voice: typeCounts['V'] || 0,
          article: typeCounts['A'] || 0,
          diary: typeCounts['D'] || 0,
        },
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

    const allLetters = await db.query.letters.findMany({
      where: eq(letters.collectionId, collection.id),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
      orderBy: [asc(letters.letterDate)],
    });

    // Group by (dateRaw, typeSequence) so companion rows like covers, telegrams,
    // and photos are attached to their primary letter instead of counted separately.
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

    const groupedLetters: Array<{ letter: LetterWithRelations; relatedItems: LetterWithRelations[] }> = [];
    for (const [, group] of groupMap) {
      const primary = group.find((letter) => letter.type === 'L') || group[0];
      const relatedItems = group.filter((letter) => letter.id !== primary.id);
      groupedLetters.push({
        letter: primary as LetterWithRelations,
        relatedItems: relatedItems as LetterWithRelations[],
      });
    }

    const collectionLetters = transformLettersWithRelatedToDTO(groupedLetters);
    const resolvedStartHere = await resolveCollectionStartHere(
      collection.id,
      {
        letterId: collection.profileStartHereLetterId,
        reason: collection.profileStartHereReason,
      },
    );

    res.json({
      ...collection,
      profileStartHereLetterId: resolvedStartHere.letterId,
      profileStartHereReason: resolvedStartHere.reason,
      profileCorrespondents: normalizeProfileCorrespondents(collection.profileCorrespondents),
      identityFingerprint: collectionIdentityFingerprint(allLetters),
      letters: collectionLetters,
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
    requireProfileRevision(req.body);

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

    const { profileRevision, ...changes } = parseResult.data;
    const updated = await updateCollectionSourceMetadata({
      collection,
      expectedProfileRevision: profileRevision,
      ...changes,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

const renameCorrespondentSchema = z.object({
  oldName: z.string().trim().min(1),
  newName: z.string().trim().min(1),
  roles: z.array(z.enum(['sender', 'recipient'])).min(1),
});

const collectionEditorUpdateSchema = z.object({
  profileRevision: z.number().int().nonnegative(),
  identityFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  hook: z.string().max(500).nullable().optional(),
  profileNarrative: z.string().max(10000).optional(),
  profileStartHereLetterId: z.string().uuid().nullable().optional(),
  profileCorrespondents: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    hook: z.string().max(500).nullable().optional(),
    biography: z.string().max(10000).nullable().optional(),
  })).optional(),
  description: z.string().max(2000).nullable().optional(),
  correspondentRenames: z.array(renameCorrespondentSchema).default([]),
});

router.put('/:code/editor', async (req, res, next) => {
  try {
    const parseResult = collectionEditorUpdateSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parseResult.error.errors,
      });
      return;
    }

    const { code } = req.params;
    const {
      profileRevision,
      identityFingerprint,
      profileCorrespondents,
      correspondentRenames,
      ...updates
    } = parseResult.data;
    const result = await applyCollectionEditorMutation({
      code,
      expectedProfileRevision: profileRevision,
      expectedIdentityFingerprint: identityFingerprint,
      ...updates,
      ...(profileCorrespondents !== undefined
        ? {
            profileCorrespondents:
              normalizeProfileCorrespondents(profileCorrespondents),
          }
        : {}),
      correspondentRenames,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/:code/correspondents', async (req, res, next) => {
  try {
    const { code } = req.params;
    const data = renameCorrespondentSchema.parse(req.body ?? {});
    const normalizedOldName = data.oldName.trim().toLowerCase();
    const normalizedNewName = data.newName.trim();

    if (normalizedOldName === normalizedNewName.toLowerCase()) {
      res.json({ updatedCount: 0, message: 'No changes needed' });
      return;
    }

    const result = await applyCollectionEditorMutation({
      code,
      correspondentRenames: [data],
    });

    res.json({
      updatedCount: result.updatedLetterCount,
      message: result.updatedLetterCount === 0
        ? 'No matching correspondents found'
        : `Updated ${result.updatedLetterCount} ${result.updatedLetterCount === 1 ? 'letter' : 'letters'}`,
    });
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
  profileRevision: z.number().int().nonnegative(),
});

function requireProfileRevision(body: unknown): void {
  if (
    !body
    || typeof body !== 'object'
    || !Object.hasOwn(body, 'profileRevision')
  ) {
    throw new AppError(
      409,
      'Collection profile version is missing; reload before saving',
    );
  }
}

/**
 * POST /admin/collections/:code/generate-profile
 * Generate an AI collection profile (or regenerate with force: true)
 */
router.post('/:code/generate-profile', async (req, res, next) => {
  try {
    const { code } = req.params;
    requireProfileRevision(req.body);
    const collection = await getCollectionByCode(code);

    if (!collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    const body = generateProfileSchema.parse(req.body || {});
    if (body.profileRevision !== collection.profileRevision) {
      throw new AppError(
        409,
        'Collection sources changed; reload before generating the profile',
      );
    }

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

    const profileRevision = await storeGeneratedCollectionProfile({
      collectionId: collection.id,
      expectedProfileRevision: body.profileRevision,
      profile: result,
    });

    res.json({
      ...result,
      profileStatus: 'AI_DRAFT',
      profileRevision,
    });
  } catch (error) {
    next(error);
  }
});

const updateProfileSchema = z.object({
  profileRevision: z.number().int().nonnegative(),
  hook: z.string().max(500).nullable().optional(),
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
  profileCorrespondents: z.array(z.object({
    name: z.string().trim().min(1).max(255),
    hook: z.string().max(500).nullable().optional(),
    biography: z.string().max(10000).nullable().optional(),
  })).optional(),
  profileStatus: z.enum(['EMPTY', 'AI_DRAFT', 'EDITED', 'VERIFIED']).optional(),
  highlightImageId: z.string().uuid().nullable().optional(),
});

/**
 * PUT /admin/collections/:code/profile
 * Update profile content and/or status
 */
router.put('/:code/profile', async (req, res, next) => {
  try {
    const { code } = req.params;
    requireProfileRevision(req.body);
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

    const {
      profileRevision,
      profileCorrespondents,
      ...data
    } = parseResult.data;
    const changes: CollectionProfileChanges = {
      ...data,
      ...(profileCorrespondents !== undefined
        ? {
            profileCorrespondents:
              normalizeProfileCorrespondents(profileCorrespondents),
          }
        : {}),
    };
    if (data.profileStartHereLetterId !== undefined) {
      if (data.profileStartHereLetterId === null) {
        changes.profileStartHereLetterId = null;
      } else {
        const resolvedStartHereLetterId = await resolveRepresentativeLetterId(
          data.profileStartHereLetterId,
          {
            publishedOnly: true,
            collectionId: collection.id,
          },
        );
        if (!resolvedStartHereLetterId) {
          res.status(400).json({ error: 'Featured letter must be published' });
          return;
        }
        changes.profileStartHereLetterId = resolvedStartHereLetterId;
      }
    }
    if (data.highlightImageId !== undefined) {
      if (data.highlightImageId !== null) {
        const highlightPage = await db.query.letterPages.findFirst({
          where: eq(letterPages.id, data.highlightImageId),
          columns: { id: true },
          with: {
            letter: {
              columns: { collectionId: true },
            },
          },
        });
        if (
          !highlightPage
          || highlightPage.letter.collectionId !== collection.id
        ) {
          res.status(400).json({
            error: 'Highlight image must belong to this collection',
          });
          return;
        }
      }
      changes.highlightImageId = data.highlightImageId;
    }
    const updated = await updateCollectionProfile({
      collection,
      expectedProfileRevision: profileRevision,
      changes,
    });
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

export default router;
