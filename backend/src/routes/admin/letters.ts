import { Router } from 'express';
import { eq, and, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, letters, collections } from '../../db/index.js';
import { getLetterById, resetLetterForProcessing } from '../../services/letters.js';
import { transformLetterToDTO, transformLetterWithRelatedToDTO, type LetterWithRelations } from '../../dto/index.js';
import { processLetter, processMetadata } from '../../pipeline/processor.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger({ module: 'admin-letters' });
const router = Router();

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
      reviewedAt: null,
      reviewedBy: null,
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
      reviewedAt: null,
      reviewedBy: null,
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
  visibility: z.enum(['DRAFT', 'PUBLISHED', 'HIDDEN']).optional(),
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

    // Workflow auto-transition based on content changes
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
    const hasMetadataUpdate = [
      updates.sender,
      updates.recipient,
      updates.locationWritten,
      updates.summary,
      updates.extractedDate,
    ].some((field) => field !== undefined && field !== null && field !== '');

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

/**
 * POST /admin/letters/:letterId/review - Mark letter as reviewed
 *
 * Sets workflow to REVIEWED and records review timestamp.
 * This is an admin sign-off indicating they don't need to revisit this letter.
 */
router.post('/letters/:letterId/review', async (req, res, next) => {
  try {
    const { letterId } = req.params;

    const existingLetter = await getLetterById(letterId);
    if (!existingLetter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Set workflow to REVIEWED and record review timestamp
    await db.update(letters).set({
      workflow: 'REVIEWED',
      reviewedAt: new Date(),
      reviewedBy: 'admin', // TODO: Use actual user when auth is implemented
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
