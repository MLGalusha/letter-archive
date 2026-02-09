import { Router } from 'express';
import { eq, and, isNull, isNotNull, inArray, sql, or, ilike, asc, desc, count } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, collections, letterVersions } from '../../db/index.js';
import { getLetterById, resetLetterForProcessing } from '../../services/letters.js';
import { transformLetterToDTO, transformLetterWithRelatedToDTO, type LetterWithRelations } from '../../dto/index.js';
import { processLetter, processMetadata } from '../../pipeline/processor.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'admin-letters' });
const router = Router();

// ============================================================================
// ADMIN LETTERS LIST WITH SERVER-SIDE FILTERING + PAGINATION
// ============================================================================

const adminLettersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  workflow: z.preprocess(
    // Preprocess: split comma-separated string into array BEFORE validation
    (val) => {
      if (typeof val === 'string' && val.includes(',')) {
        return val.split(',');
      }
      return val;
    },
    // Then validate as either single enum or array of enums
    z.union([
      z.enum(['UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'METADATA_EXTRACTING', 'METADATA_DRAFTED', 'REVIEWED']),
      z.array(z.enum(['UPLOADED', 'TRANSCRIBING', 'TRANSCRIBED', 'METADATA_EXTRACTING', 'METADATA_DRAFTED', 'REVIEWED'])),
    ]).optional()
  ),
  collection: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['createdAt', 'letterDate', 'sender', 'recipient', 'workflow', 'visibility', 'collection']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * GET /admin/letters - List letters with server-side filtering, pagination, and stats
 *
 * Query params:
 * - page: Page number (default 1)
 * - limit: Items per page (default 50, max 100)
 * - visibility: 'PUBLISHED' | 'HIDDEN'
 * - workflow: Single value or comma-separated list of workflow states
 * - collection: Collection code (or 'all')
 * - search: Search term for sender/recipient/title
 * - sort: Sort field
 * - sortOrder: 'asc' | 'desc'
 *
 * Response includes:
 * - letters: Paginated letter list
 * - pagination: { page, limit, total, totalPages }
 * - stats: Counts for the collection (not affected by filters except collection)
 */
router.get('/letters', async (req, res, next) => {
  const start = Date.now();
  try {
    const query = adminLettersQuerySchema.parse(req.query);

    req.log.debug(
      { collection: query.collection, visibility: query.visibility, workflow: query.workflow, search: query.search, page: query.page },
      'Admin letters list query'
    );

    // Build base conditions
    const conditions: ReturnType<typeof eq>[] = [
      isNull(letters.deletedAt),
      eq(letters.type, 'L'), // Only L-type letters in admin view
    ];

    // Collection filter
    let collectionId: string | undefined;
    if (query.collection && query.collection !== 'all') {
      const collection = await db.query.collections.findFirst({
        where: eq(collections.collectionCode, query.collection),
      });
      if (collection) {
        collectionId = collection.id;
        conditions.push(eq(letters.collectionId, collection.id));
      } else {
        // Collection not found, return empty
        res.json({
          letters: [],
          pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 0 },
          stats: { total: 0, uploaded: 0, transcribed: 0, metadataReady: 0, published: 0, hidden: 0 },
        });
        return;
      }
    }

    // Visibility filter
    if (query.visibility) {
      conditions.push(eq(letters.visibility, query.visibility));
    }

    // Workflow filter (supports array)
    const workflowValues = query.workflow
      ? Array.isArray(query.workflow) ? query.workflow : [query.workflow]
      : null;
    if (workflowValues && workflowValues.length > 0) {
      conditions.push(inArray(letters.workflow, workflowValues));
    }

    // Search filter (ILIKE on sender, recipient, summary, hook)
    if (query.search && query.search.trim()) {
      const searchTerm = `%${query.search.trim()}%`;
      conditions.push(
        or(
          ilike(letters.sender, searchTerm),
          ilike(letters.recipient, searchTerm),
          ilike(letters.summary, searchTerm),
          ilike(letters.hook, searchTerm)
        )!
      );
    }

    // Calculate stats for the collection (unfiltered by visibility/workflow/search)
    // This lets filter pills show accurate counts
    const statsConditions: ReturnType<typeof eq>[] = [
      isNull(letters.deletedAt),
      eq(letters.type, 'L'),
    ];
    if (collectionId) {
      statsConditions.push(eq(letters.collectionId, collectionId));
    }

    const statsResult = await db.select({
      total: count(),
      // Legacy workflow stats (for backward compat)
      uploaded: sql<number>`COUNT(*) FILTER (WHERE ${letters.workflow} = 'UPLOADED')`,
      transcribing: sql<number>`COUNT(*) FILTER (WHERE ${letters.workflow} = 'TRANSCRIBING')`,
      transcribed: sql<number>`COUNT(*) FILTER (WHERE ${letters.workflow} = 'TRANSCRIBED')`,
      metadataExtracting: sql<number>`COUNT(*) FILTER (WHERE ${letters.workflow} = 'METADATA_EXTRACTING')`,
      metadataReady: sql<number>`COUNT(*) FILTER (WHERE ${letters.workflow} = 'METADATA_DRAFTED')`,
      // Visibility stats
      published: sql<number>`COUNT(*) FILTER (WHERE ${letters.visibility} = 'PUBLISHED')`,
      hidden: sql<number>`COUNT(*) FILTER (WHERE ${letters.visibility} = 'HIDDEN')`,
      // Two-track transcript stats
      transcriptEmpty: sql<number>`COUNT(*) FILTER (WHERE ${letters.transcriptStatus} = 'EMPTY')`,
      transcriptAiDraft: sql<number>`COUNT(*) FILTER (WHERE ${letters.transcriptStatus} = 'AI_DRAFT')`,
      transcriptEdited: sql<number>`COUNT(*) FILTER (WHERE ${letters.transcriptStatus} = 'EDITED')`,
      transcriptVerified: sql<number>`COUNT(*) FILTER (WHERE ${letters.transcriptStatus} = 'VERIFIED')`,
      // Two-track metadata stats
      metadataEmpty: sql<number>`COUNT(*) FILTER (WHERE ${letters.metadataContentStatus} = 'EMPTY')`,
      metadataAiDraft: sql<number>`COUNT(*) FILTER (WHERE ${letters.metadataContentStatus} = 'AI_DRAFT')`,
      metadataEdited: sql<number>`COUNT(*) FILTER (WHERE ${letters.metadataContentStatus} = 'EDITED')`,
      metadataVerified: sql<number>`COUNT(*) FILTER (WHERE ${letters.metadataContentStatus} = 'VERIFIED')`,
    })
      .from(letters)
      .where(and(...statsConditions));

    const stats = statsResult[0] || {
      total: 0, uploaded: 0, transcribing: 0, transcribed: 0,
      metadataExtracting: 0, metadataReady: 0, published: 0, hidden: 0,
      transcriptEmpty: 0, transcriptAiDraft: 0, transcriptEdited: 0, transcriptVerified: 0,
      metadataEmpty: 0, metadataAiDraft: 0, metadataEdited: 0, metadataVerified: 0,
    };

    // Get total count for filtered results (for pagination)
    const countResult = await db.select({ count: count() })
      .from(letters)
      .where(and(...conditions));
    const totalFiltered = countResult[0]?.count || 0;
    const totalPages = Math.ceil(totalFiltered / query.limit);

    // Determine sort order direction
    const sortDirection = query.sortOrder === 'asc' ? asc : desc;

    // Build orderBy based on sort field
    const getOrderBy = () => {
      switch (query.sort) {
        case 'letterDate':
          return sortDirection(sql`REPLACE(${letters.dateRaw}, 'X', '0')`);
        case 'sender':
          return sortDirection(letters.sender);
        case 'recipient':
          return sortDirection(letters.recipient);
        case 'workflow':
          return sortDirection(letters.workflow);
        case 'visibility':
          return sortDirection(letters.visibility);
        case 'collection':
          // Sort by collectionId - letters in same collection have same ID, so this groups them
          // Not perfect alphabetically but functional for grouping
          return sortDirection(letters.collectionId);
        case 'createdAt':
        default:
          return sortDirection(letters.createdAt);
      }
    };

    // Fetch paginated results
    const offset = (query.page - 1) * query.limit;
    const results = await db.query.letters.findMany({
      where: and(...conditions),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc: pageAsc }) => [pageAsc(p.pageNumber)],
        },
      },
      orderBy: getOrderBy(),
      limit: query.limit,
      offset,
    });

    // Transform to DTOs
    const transformedLetters = (results as LetterWithRelations[]).map(letter =>
      transformLetterToDTO(letter)
    );

    const duration = Date.now() - start;
    req.log.info(
      { resultCount: transformedLetters.length, total: totalFiltered, page: query.page, duration },
      'Admin letters list completed'
    );

    res.json({
      letters: transformedLetters,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: totalFiltered,
        totalPages,
      },
      stats: {
        // Total
        total: Number(stats.total),
        // Legacy workflow stats (for backward compat)
        uploaded: Number(stats.uploaded) + Number(stats.transcribing),
        transcribed: Number(stats.transcribed) + Number(stats.metadataExtracting),
        metadataReady: Number(stats.metadataReady),
        // Visibility stats
        published: Number(stats.published),
        hidden: Number(stats.hidden),
        // Two-track transcript stats
        transcript: {
          empty: Number(stats.transcriptEmpty),
          aiDraft: Number(stats.transcriptAiDraft),
          edited: Number(stats.transcriptEdited),
          verified: Number(stats.transcriptVerified),
        },
        // Two-track metadata stats
        metadata: {
          empty: Number(stats.metadataEmpty),
          aiDraft: Number(stats.metadataAiDraft),
          edited: Number(stats.metadataEdited),
          verified: Number(stats.metadataVerified),
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// ON-DEMAND PROCESSING STATE AND FUNCTIONS
// ============================================================================

interface ProcessingState {
  isRunning: boolean;
  isPaused: boolean;
  shouldAbort: boolean;
  currentJob: { letterId: string; type: 'transcription' | 'metadata' } | null;
  completed: number;
  failed: number;
  total: number;
  errors: string[];
  lastCompletedAt: number | null;  // timestamp for live updates
}

let processingState: ProcessingState = {
  isRunning: false,
  isPaused: false,
  shouldAbort: false,
  currentJob: null,
  completed: 0,
  failed: 0,
  total: 0,
  errors: [],
  lastCompletedAt: null,
};

/**
 * Async processing function that runs in the background.
 */
async function processLettersAsync(letterIds: string[], type: 'transcription' | 'metadata') {
  log.info({ type, letterCount: letterIds.length }, 'Starting async processing batch');
  const batchStart = Date.now();

  for (const letterId of letterIds) {
    // Check for abort
    if (processingState.shouldAbort) {
      log.info({ type, completed: processingState.completed, failed: processingState.failed }, 'Processing aborted');
      processingState.isRunning = false;
      break;
    }

    // Wait while paused
    if (processingState.isPaused) {
      log.info({ type, letterId }, 'Processing paused');
    }
    while (processingState.isPaused && !processingState.shouldAbort) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (processingState.isPaused === false && processingState.shouldAbort === false) {
      // Resumed
    }

    if (processingState.shouldAbort) {
      log.info({ type, completed: processingState.completed, failed: processingState.failed }, 'Processing aborted after pause');
      processingState.isRunning = false;
      break;
    }

    processingState.currentJob = { letterId, type };
    const jobStart = Date.now();

    try {
      if (type === 'transcription') {
        await processLetter(letterId);
      } else {
        await processMetadata(letterId);
      }
      processingState.completed++;
      processingState.lastCompletedAt = Date.now();
      const jobDuration = Date.now() - jobStart;
      log.debug({ letterId, type, duration: jobDuration, progress: `${processingState.completed}/${processingState.total}` }, 'Job completed');
    } catch (error) {
      processingState.failed++;
      processingState.lastCompletedAt = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      processingState.errors.push(`${letterId}: ${errorMessage}`);
      log.error({ letterId, type, err: error }, 'Job failed');
    }
  }

  const batchDuration = Date.now() - batchStart;
  log.info(
    {
      type,
      total: processingState.total,
      completed: processingState.completed,
      failed: processingState.failed,
      duration: batchDuration,
    },
    'Async processing batch finished'
  );

  processingState.isRunning = false;
  processingState.currentJob = null;
}

/**
 * GET /admin/processing/status - Get current processing status
 */
router.get('/processing/status', (_req, res) => {
  res.json(processingState);
});

/**
 * POST /admin/processing/start-transcription - Start transcription processing
 * Accepts optional { collectionCode } in body to filter by collection
 */
router.post('/processing/start-transcription', async (req, res, next) => {
  try {
    if (processingState.isRunning) {
      res.status(400).json({ error: 'Processing already in progress' });
      return;
    }

    const { collectionCode } = req.body || {};

    // Build where conditions
    const conditions: ReturnType<typeof eq>[] = [
      eq(letters.type, 'L'),
      eq(letters.workflow, 'UPLOADED'),
      isNull(letters.deletedAt)
    ];

    // If collectionCode provided, filter by collection
    if (collectionCode) {
      const collection = await db.query.collections.findFirst({
        where: eq(collections.collectionCode, collectionCode)
      });
      if (collection) {
        conditions.push(eq(letters.collectionId, collection.id));
      } else {
        // Collection not found - return empty
        res.json({ message: 'Collection not found', total: 0 });
        return;
      }
    }

    // Find eligible letters
    const eligible = await db.query.letters.findMany({
      where: and(...conditions),
      with: { pages: true },
    });

    const toProcess = eligible.filter(l => l.pages.length > 0);

    if (toProcess.length === 0) {
      res.json({ message: 'No letters to process', total: 0 });
      return;
    }

    // Reset state and start
    processingState = {
      isRunning: true,
      isPaused: false,
      shouldAbort: false,
      currentJob: null,
      completed: 0,
      failed: 0,
      total: toProcess.length,
      errors: [],
      lastCompletedAt: null,
    };

    // Start async processing (don't await - runs in background)
    processLettersAsync(toProcess.map(l => l.id), 'transcription');

    res.json({ message: 'Processing started', total: toProcess.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/processing/start-metadata - Start metadata extraction
 * Accepts optional { collectionCode } in body to filter by collection
 */
router.post('/processing/start-metadata', async (req, res, next) => {
  try {
    if (processingState.isRunning) {
      res.status(400).json({ error: 'Processing already in progress' });
      return;
    }

    const { collectionCode } = req.body || {};

    // Build where conditions
    const conditions: ReturnType<typeof eq>[] = [
      eq(letters.type, 'L'),
      eq(letters.workflow, 'TRANSCRIBED'),
      isNotNull(letters.transcriptConfirmedAt),
      isNull(letters.deletedAt)
    ];

    // If collectionCode provided, filter by collection
    if (collectionCode) {
      const collection = await db.query.collections.findFirst({
        where: eq(collections.collectionCode, collectionCode)
      });
      if (collection) {
        conditions.push(eq(letters.collectionId, collection.id));
      } else {
        // Collection not found - return empty
        res.json({ message: 'Collection not found', total: 0 });
        return;
      }
    }

    // Find eligible letters
    const eligible = await db.query.letters.findMany({
      where: and(...conditions),
    });

    if (eligible.length === 0) {
      res.json({ message: 'No letters to process', total: 0 });
      return;
    }

    // Reset state and start
    processingState = {
      isRunning: true,
      isPaused: false,
      shouldAbort: false,
      currentJob: null,
      completed: 0,
      failed: 0,
      total: eligible.length,
      errors: [],
      lastCompletedAt: null,
    };

    // Start async processing (don't await - runs in background)
    processLettersAsync(eligible.map(l => l.id), 'metadata');

    res.json({ message: 'Processing started', total: eligible.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/processing/pause - Pause processing
 */
router.post('/processing/pause', (req, res) => {
  if (!processingState.isRunning) {
    req.log.warn('Pause requested but no processing in progress');
    res.status(400).json({ error: 'No processing in progress' });
    return;
  }
  processingState.isPaused = true;
  req.log.info({ completed: processingState.completed, total: processingState.total }, 'Processing paused');
  res.json({ message: 'Processing paused' });
});

/**
 * POST /admin/processing/resume - Resume processing
 */
router.post('/processing/resume', (req, res) => {
  if (!processingState.isRunning) {
    req.log.warn('Resume requested but no processing in progress');
    res.status(400).json({ error: 'No processing in progress' });
    return;
  }
  processingState.isPaused = false;
  req.log.info({ completed: processingState.completed, total: processingState.total }, 'Processing resumed');
  res.json({ message: 'Processing resumed' });
});

/**
 * POST /admin/processing/abort - Abort processing
 */
router.post('/processing/abort', async (req, res, next) => {
  try {
    if (!processingState.isRunning) {
      req.log.warn('Abort requested but no processing in progress');
      res.status(400).json({ error: 'No processing in progress' });
      return;
    }

    processingState.shouldAbort = true;
    req.log.info(
      { completed: processingState.completed, failed: processingState.failed, total: processingState.total },
      'Processing abort requested'
    );

    // If currently processing, revert the current letter's status back to initial state
    if (processingState.currentJob) {
      const { letterId, type } = processingState.currentJob;
      req.log.info({ letterId, type }, 'Reverting in-progress job state');
      if (type === 'transcription') {
        await db.update(letters).set({
          transcriptionStatus: 'PENDING',
          workflow: 'UPLOADED',
          updatedAt: new Date(),
        }).where(eq(letters.id, letterId));
      } else {
        await db.update(letters).set({
          metadataStatus: 'PENDING',
          workflow: 'TRANSCRIBED',
          updatedAt: new Date(),
        }).where(eq(letters.id, letterId));
      }
    }

    res.json({ message: 'Processing aborted' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// BULK OPERATIONS (must be defined before parameterized routes)
// ============================================================================

const bulkLetterIdsSchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
});

/**
 * POST /admin/letters/bulk/transcribe - Queue multiple letters for transcription
 *
 * Only processes L-type letters with workflow='UPLOADED' and at least one page.
 */
router.post('/letters/bulk/transcribe', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ errors: parseResult.error.errors }, 'Invalid bulk transcribe request');
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds } = parseResult.data;

    req.log.info({ requestedCount: letterIds.length }, 'Bulk transcribe request received');

    // Fetch letters with pages
    const lettersToProcess = await db.query.letters.findMany({
      where: and(
        inArray(letters.id, letterIds),
        eq(letters.type, 'L'),
        eq(letters.workflow, 'UPLOADED'),
        isNull(letters.deletedAt)
      ),
      with: { pages: true },
    });

    // Filter to those with pages and not already running
    const eligible = lettersToProcess.filter(
      (l) => l.pages.length > 0 && l.transcriptionStatus !== 'RUNNING'
    );

    // Queue them
    for (const letter of eligible) {
      await db.update(letters).set({
        transcriptionStatus: 'PENDING',
        transcriptionError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letter.id));
    }

    req.log.info(
      { queued: eligible.length, skipped: letterIds.length - eligible.length },
      'Bulk transcribe completed'
    );

    res.json({
      queued: eligible.length,
      skipped: letterIds.length - eligible.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/bulk/extract-metadata - Queue multiple letters for metadata extraction
 *
 * Only processes L-type letters with workflow='TRANSCRIBED' and confirmed transcript.
 */
router.post('/letters/bulk/extract-metadata', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds } = parseResult.data;

    // Fetch eligible letters
    const lettersToProcess = await db.query.letters.findMany({
      where: and(
        inArray(letters.id, letterIds),
        eq(letters.type, 'L'),
        eq(letters.workflow, 'TRANSCRIBED'),
        isNotNull(letters.transcriptConfirmedAt),
        isNull(letters.deletedAt)
      ),
    });

    // Filter out already running
    const eligible = lettersToProcess.filter(
      (l) => l.metadataStatus !== 'RUNNING'
    );

    // Queue them
    for (const letter of eligible) {
      await db.update(letters).set({
        metadataStatus: 'PENDING',
        metadataError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letter.id));
    }

    res.json({
      queued: eligible.length,
      skipped: letterIds.length - eligible.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/bulk/reset-transcriptions - Reset transcriptions for selected letters
 *
 * Sets workflow back to UPLOADED, clears transcription text, clears transcript confirmation.
 * This is used for re-testing transcription with updated prompts.
 */
router.post('/letters/bulk/reset-transcriptions', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ errors: parseResult.error.errors }, 'Invalid bulk reset request');
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds } = parseResult.data;

    req.log.info({ count: letterIds.length }, 'Bulk reset transcriptions requested');

    // Update all selected letters
    const result = await db.update(letters).set({
      workflow: 'UPLOADED',
      transcriptionText: null,
      transcriptConfirmedAt: null,
      transcriptConfirmedBy: null,
      transcriptionStatus: 'PENDING',
      transcriptionError: null,
      // Also clear metadata since it depends on transcription
      metadataStatus: 'PENDING',
      metadataError: null,
      sender: null,
      recipient: null,
      locationWritten: null,
      hook: null,
      summary: null,
      extractedDate: null,
      extractedDateConfidence: null,
      tags: null,
      // Reset two-track content status
      transcriptStatus: 'EMPTY',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      metadataContentStatus: 'EMPTY',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      updatedAt: new Date(),
    }).where(
      and(
        inArray(letters.id, letterIds),
        isNull(letters.deletedAt)
      )
    );

    req.log.info({ updated: letterIds.length }, 'Bulk reset transcriptions completed');

    res.json({
      message: 'Transcriptions reset',
      updated: letterIds.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/bulk/clear-metadata - Clear metadata for selected letters
 *
 * Clears metadata fields but keeps the transcription intact.
 * Resets workflow to TRANSCRIBED if it was past that point.
 */
router.post('/letters/bulk/clear-metadata', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds } = parseResult.data;

    // Update all selected letters - clear metadata but keep transcription
    await db.update(letters).set({
      sender: null,
      recipient: null,
      locationWritten: null,
      hook: null,
      summary: null,
      extractedDate: null,
      extractedDateConfidence: null,
      tags: null,
      metadataStatus: 'PENDING',
      metadataError: null,
      // Reset metadata two-track status (keep transcript status intact)
      metadataContentStatus: 'EMPTY',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      // Set workflow to TRANSCRIBED if it was past that
      workflow: 'TRANSCRIBED',
      updatedAt: new Date(),
    }).where(
      and(
        inArray(letters.id, letterIds),
        isNull(letters.deletedAt)
      )
    );

    res.json({
      message: 'Metadata cleared',
      updated: letterIds.length,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// SINGLE LETTER OPERATIONS
// ============================================================================

/**
 * GET /admin/letters/:letterId - Get a single letter with pages (admin - any visibility)
 * Also fetches related cards (C) and extras (E) for the same date/sequence
 */
router.get('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const letter = await db.query.letters.findFirst({
      where: and(eq(letters.id, letterId), isNull(letters.deletedAt)),
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

    // Fetch related items (all other types with same date/sequence)
    const related = await db.query.letters.findMany({
      where: and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
        sql`${letters.type} != ${letter.type}`, // Exclude the current letter's type
        isNull(letters.deletedAt)
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

// Validation schema for letter updates
const updateLetterSchema = z.object({
  transcriptionText: z.string().optional(),
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
  locationWritten: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  extractedDate: z.string().nullable().optional(),
  extractedDateConfidence: z.enum(['exact', 'unknown', 'inferred']).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * POST /admin/letters/:letterId/process - Re-enqueue a letter for processing
 *
 * Resets the letter's status and allows the worker to pick it up again.
 */
router.post('/letters/:letterId/process', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const letter = await getLetterById(letterId);

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Reset for processing
    await resetLetterForProcessing(letterId);

    res.json({
      message: 'Letter enqueued for processing',
      letterId,
      note: 'The background worker will pick this up shortly.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/letters/:letterId - Update letter fields
 */
router.put('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Validate request body
    const parseResult = updateLetterSchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ letterId, errors: parseResult.error.errors }, 'Invalid letter update request');
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const updates = parseResult.data;
    req.log.debug({ letterId, fields: Object.keys(updates) }, 'Letter update requested');

    // Check letter exists
    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Build update object
    const dbUpdates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (updates.transcriptionText !== undefined) {
      dbUpdates.transcriptionText = updates.transcriptionText;
    }
    if (updates.sender !== undefined) {
      dbUpdates.sender = updates.sender;
    }
    if (updates.recipient !== undefined) {
      dbUpdates.recipient = updates.recipient;
    }
    if (updates.locationWritten !== undefined) {
      dbUpdates.locationWritten = updates.locationWritten;
    }
    if (updates.hook !== undefined) {
      dbUpdates.hook = updates.hook;
    }
    if (updates.summary !== undefined) {
      dbUpdates.summary = updates.summary;
    }
    if (updates.extractedDate !== undefined) {
      // Only set extractedDate if it's a valid YYYY-MM-DD format or null
      // Display-formatted dates like "1947" or "September 14, 1886" should be ignored
      if (updates.extractedDate === null || updates.extractedDate === '') {
        dbUpdates.extractedDate = null;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(updates.extractedDate)) {
        // Valid ISO date format
        dbUpdates.extractedDate = updates.extractedDate;
      }
      // Otherwise, skip updating extractedDate (it's a display format we can't use)
    }
    if (updates.notes !== undefined) {
      dbUpdates.notes = updates.notes;
    }
    if (updates.extractedDateConfidence !== undefined) {
      dbUpdates.extractedDateConfidence = updates.extractedDateConfidence;
    }
    if (updates.tags !== undefined) {
      dbUpdates.tags = updates.tags;
    }
    if (updates.visibility !== undefined) {
      dbUpdates.visibility = updates.visibility;
      // If publishing, mark as reviewed
      if (updates.visibility === 'PUBLISHED') {
        dbUpdates.reviewedAt = new Date();
        dbUpdates.reviewedBy = 'admin'; // TODO: Use actual user when auth is implemented
      }
    }

    // =========================================================================
    // TWO-TRACK STATUS TRANSITIONS (new system)
    // =========================================================================

    // Transcript edit: AI_DRAFT → EDITED (but not VERIFIED → EDITED, that requires explicit action)
    if (updates.transcriptionText !== undefined) {
      const currentTranscriptStatus = existingLetter.transcriptStatus;
      if (currentTranscriptStatus === 'AI_DRAFT') {
        dbUpdates.transcriptStatus = 'EDITED';
        req.log.debug({ letterId }, 'Transcript status: AI_DRAFT → EDITED');
      }
      // Note: VERIFIED stays VERIFIED - editing verified content keeps it verified
    }

    // Metadata edit: AI_DRAFT → EDITED
    const hasMetadataUpdate = [
      updates.sender,
      updates.recipient,
      updates.locationWritten,
      updates.summary,
      updates.hook,
      updates.extractedDate,
    ].some((field) => field !== undefined);

    if (hasMetadataUpdate) {
      const currentMetadataStatus = existingLetter.metadataContentStatus;
      if (currentMetadataStatus === 'AI_DRAFT') {
        dbUpdates.metadataContentStatus = 'EDITED';
        req.log.debug({ letterId }, 'Metadata status: AI_DRAFT → EDITED');
      }
    }

    // =========================================================================
    // LEGACY WORKFLOW TRANSITIONS (kept for backward compatibility)
    // =========================================================================
    const currentWorkflow = existingLetter.workflow;

    // If admin adds transcription to an UPLOADED letter → TRANSCRIBED
    if (updates.transcriptionText !== undefined) {
      const hasTranscription = updates.transcriptionText && updates.transcriptionText.trim().length > 0;
      if (hasTranscription && currentWorkflow === 'UPLOADED') {
        dbUpdates.workflow = 'TRANSCRIBED';
      } else if (!hasTranscription && ['TRANSCRIBED', 'METADATA_DRAFTED', 'METADATA_EXTRACTING'].includes(currentWorkflow)) {
        // Admin cleared transcription → revert to UPLOADED
        dbUpdates.workflow = 'UPLOADED';
      }
    }

    // If admin adds any metadata to a TRANSCRIBED letter → METADATA_DRAFTED
    if (hasMetadataUpdate) {
      const workflowToCheck = (dbUpdates.workflow as string) || currentWorkflow;
      if (workflowToCheck === 'TRANSCRIBED') {
        dbUpdates.workflow = 'METADATA_DRAFTED';
      }
    }

    // Apply updates
    await db.update(letters).set(dbUpdates).where(eq(letters.id, letterId));

    // Fetch and return updated letter
    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
    });

    if (!updatedLetter) {
      req.log.error({ letterId }, 'Failed to fetch letter after update');
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    req.log.info(
      {
        letterId,
        workflowChange: dbUpdates.workflow ? `${currentWorkflow} -> ${dbUpdates.workflow}` : undefined,
        visibilityChange: updates.visibility,
      },
      'Letter updated'
    );

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/confirm-transcript - Confirm transcript is correct
 *
 * Marks the transcript as confirmed, which triggers metadata extraction.
 * Only works for letters in TRANSCRIBED state.
 */
router.post('/letters/:letterId/confirm-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Only allow confirmation for TRANSCRIBED letters
    if (existingLetter.workflow !== 'TRANSCRIBED') {
      res.status(400).json({
        error: 'Letter must be in TRANSCRIBED state to confirm transcript',
        currentState: existingLetter.workflow,
      });
      return;
    }

    // Mark transcript as confirmed - this triggers metadata extraction by worker
    await db.update(letters).set({
      transcriptConfirmedAt: new Date(),
      transcriptConfirmedBy: 'admin', // TODO: Use actual user when auth is implemented
      metadataStatus: 'PENDING', // Ensure worker picks it up
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    // Fetch and return updated letter
    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: {
          orderBy: (p, { asc }) => [asc(p.pageNumber)],
        },
      },
    });

    if (!updatedLetter) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// VERSION HISTORY ENDPOINTS
// ============================================================================

const versionBodySchema = z.object({
  fieldType: z.enum(['transcript', 'metadata']),
  content: z.union([z.string(), z.record(z.unknown())]),
  source: z.enum(['ai', 'human']),
});

/**
 * GET /admin/letters/:letterId/versions - Get version history for a letter
 *
 * Query params:
 * - fieldType: 'transcript' | 'metadata' (required)
 */
router.get('/letters/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const fieldType = req.query.fieldType as string;

    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }

    // Verify letter exists
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Fetch versions for this letter and field type
    const versions = await db.query.letterVersions.findMany({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType)
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
    });

    res.json({
      versions: versions.map(v => ({
        versionNumber: v.versionNumber,
        content: v.content,
        source: v.source,
        createdAt: v.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/versions - Create a new version snapshot
 *
 * Called on auto-save to preserve version history.
 */
router.post('/letters/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Verify letter exists
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Validate body
    const parseResult = versionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { fieldType, content, source } = parseResult.data;

    // Get the next version number
    const existingVersions = await db.query.letterVersions.findMany({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType)
      ),
      orderBy: (v, { desc }) => [desc(v.versionNumber)],
      limit: 1,
    });

    const nextVersionNumber = existingVersions.length > 0
      ? existingVersions[0].versionNumber + 1
      : 1;

    // Create the version
    const [newVersion] = await db.insert(letterVersions).values({
      letterId,
      fieldType,
      versionNumber: nextVersionNumber,
      content: typeof content === 'string' ? { text: content } : content,
      source,
    }).returning();

    req.log.debug({ letterId, fieldType, versionNumber: nextVersionNumber }, 'Version created');

    // Cleanup old versions (keep last 48 hours)
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await db.delete(letterVersions).where(
      and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
        sql`${letterVersions.createdAt} < ${cutoff}`,
        // Always keep at least version 1 (AI original)
        sql`${letterVersions.versionNumber} > 1`
      )
    );

    res.json({
      versionNumber: newVersion.versionNumber,
      createdAt: newVersion.createdAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/versions/:versionNumber/restore - Restore a previous version
 *
 * Copies the content from the specified version back to the letter.
 */
router.post('/letters/:letterId/versions/:versionNumber/restore', async (req, res, next) => {
  try {
    const { letterId, versionNumber } = req.params;
    const fieldType = req.query.fieldType as string;

    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }

    // Verify letter exists
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Find the version to restore
    const version = await db.query.letterVersions.findFirst({
      where: and(
        eq(letterVersions.letterId, letterId),
        eq(letterVersions.fieldType, fieldType),
        eq(letterVersions.versionNumber, parseInt(versionNumber, 10))
      ),
    });

    if (!version) {
      res.status(404).json({ error: 'Version not found' });
      return;
    }

    // Restore the content
    const content = version.content as Record<string, unknown>;

    if (fieldType === 'transcript') {
      await db.update(letters).set({
        transcriptionText: (content.text as string) || '',
        transcriptStatus: 'EDITED',
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    } else {
      // Restore metadata fields
      await db.update(letters).set({
        sender: (content.sender as string) || null,
        recipient: (content.recipient as string) || null,
        locationWritten: (content.locationWritten as string) || null,
        hook: (content.hook as string) || null,
        summary: (content.summary as string) || null,
        metadataContentStatus: 'EDITED',
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));
    }

    req.log.info({ letterId, fieldType, restoredVersion: versionNumber }, 'Version restored');

    // Fetch and return updated letter
    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// TWO-TRACK VERIFICATION ENDPOINTS (New workflow system)
// ============================================================================

/**
 * POST /admin/letters/:letterId/verify-transcript - Mark transcript as verified
 *
 * This is an explicit user action to say "I've reviewed this transcript and it's correct."
 * Does NOT auto-transition - user must explicitly verify.
 */
router.post('/letters/:letterId/verify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Can only verify if there's content (not EMPTY)
    if (existingLetter.transcriptStatus === 'EMPTY') {
      res.status(400).json({
        error: 'Cannot verify empty transcript',
        currentStatus: existingLetter.transcriptStatus,
      });
      return;
    }

    // Update transcript status to VERIFIED
    await db.update(letters).set({
      transcriptStatus: 'VERIFIED',
      transcriptVerifiedAt: new Date(),
      transcriptVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, previousStatus: existingLetter.transcriptStatus }, 'Transcript verified');

    // Fetch and return updated letter
    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/unverify-transcript - Reset transcript verification
 *
 * Moves transcript from VERIFIED back to EDITED (allowing re-verification).
 */
router.post('/letters/:letterId/unverify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (existingLetter.transcriptStatus !== 'VERIFIED') {
      res.status(400).json({
        error: 'Transcript is not verified',
        currentStatus: existingLetter.transcriptStatus,
      });
      return;
    }

    // Reset to EDITED status
    await db.update(letters).set({
      transcriptStatus: 'EDITED',
      transcriptVerifiedAt: null,
      transcriptVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId }, 'Transcript verification removed');

    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/verify-metadata - Mark metadata as verified
 *
 * This is an explicit user action to say "I've reviewed this metadata and it's correct."
 */
router.post('/letters/:letterId/verify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Can only verify if there's content (not EMPTY)
    if (existingLetter.metadataContentStatus === 'EMPTY') {
      res.status(400).json({
        error: 'Cannot verify empty metadata',
        currentStatus: existingLetter.metadataContentStatus,
      });
      return;
    }

    // Update metadata status to VERIFIED
    await db.update(letters).set({
      metadataContentStatus: 'VERIFIED',
      metadataVerifiedAt: new Date(),
      metadataVerifiedBy: 'admin', // TODO: Use actual user when auth is implemented
      // Also mark as reviewed for legacy compatibility
      reviewedAt: new Date(),
      reviewedBy: 'admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, previousStatus: existingLetter.metadataContentStatus }, 'Metadata verified');

    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/letters/:letterId/unverify-metadata - Reset metadata verification
 *
 * Moves metadata from VERIFIED back to EDITED (allowing re-verification).
 */
router.post('/letters/:letterId/unverify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (existingLetter.metadataContentStatus !== 'VERIFIED') {
      res.status(400).json({
        error: 'Metadata is not verified',
        currentStatus: existingLetter.metadataContentStatus,
      });
      return;
    }

    // Reset to EDITED status
    await db.update(letters).set({
      metadataContentStatus: 'EDITED',
      metadataVerifiedAt: null,
      metadataVerifiedBy: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId }, 'Metadata verification removed');

    const updatedLetter = await db.query.letters.findFirst({
      where: eq(letters.id, letterId),
      with: {
        collection: true,
        pages: { orderBy: (p, { asc }) => [asc(p.pageNumber)] },
      },
    });

    res.json(transformLetterToDTO(updatedLetter as LetterWithRelations));
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/letters/:letterId - Soft delete a letter
 */
router.delete('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    // Check letter exists
    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      req.log.warn({ letterId }, 'Delete requested for non-existent letter');
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Soft delete
    await db.update(letters).set({
      deletedAt: new Date(),
      deletedBy: 'admin', // TODO: Use actual user when auth is implemented
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId }, 'Letter soft deleted');
    res.json({ message: 'Letter deleted successfully', letterId });
  } catch (error) {
    next(error);
  }
});

export default router;
