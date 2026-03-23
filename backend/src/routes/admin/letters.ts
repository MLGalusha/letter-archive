import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { db, letters, letterPages, collections } from '../../db/index.js';
import { getLetterById, resetLetterForProcessing } from '../../services/letters.js';
import { getAbsoluteStoragePath } from '../../services/storage.js';
import { runMetadataExtractionV2, runEntityExtractionOnly, type ExtractionOptions } from '../../pipeline/metadataV2.js';
import { detectAndStorePageLines } from '../../services/line-finder.js';
import { propagateName, propagatePlaceholderReplacement } from '../../services/name-propagation.js';
import { aiUpdateMetadata } from '../../services/metadata-update.js';
import { isPlaceholderValue } from '../../utils/placeholders.js';
import { checkNoteAutoResolutions } from '../../services/note-resolution.js';
import type { StructuredNote, NoteCategory, NotePriority } from '../../ai/schemas/metadataV2.js';

// Service imports
import {
  queryAdminLetters,
  adminLettersQuerySchema,
  fetchLetterWithRelatedAndTransform,
} from '../../services/letter-queries.js';
import {
  getProcessingStatus,
  getQueueStatus,
  startTranscriptionProcessing,
  startMetadataProcessing,
  pauseProcessing,
  resumeProcessing,
  abortProcessing,
  removeFromQueue,
  clearQueue,
  retryJob,
  cancelActiveJob,
  startEntityExtractionProcessing,
  startEntityResolutionProcessing,
  getEntityResolutionStatus,
  processingFilterSchema,
  queueJobTypeSchema,
} from '../../services/processing-queue.js';
import {
  bulkTranscribe,
  bulkExtractMetadata,
  bulkClearTranscriptions,
  bulkUpdateFields,
  bulkClearMetadata,
  buildLetterUpdates,
  getVersions,
  createVersion,
  restoreVersion,
  verifyTranscript,
  unverifyTranscript,
  verifyMetadata,
  unverifyMetadata,
  regenerateTranscription,
  transcribeLetterOnly,
  transcribeExtras,
  updateExtraContent,
  verifyExtraContent,
  unverifyExtraContent,
  updateAiNotes,
  updateLinkedPerson,
  updateLinkedPlace,
  addLinkedPerson,
  addLinkedPlace,
  removeLinkedPerson,
  removeLinkedPlace,
  type UpdateLetterInput,
} from '../../services/letter-operations.js';

const router = Router();

// ============================================================================
// REQUEST VALIDATION SCHEMAS
// ============================================================================

const bulkLetterIdsSchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
});

const bulkMetadataSchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
  skipConfirmationCheck: z.boolean().optional().default(false),
});

const bulkUpdateFieldsSchema = z.object({
  updates: z.array(z.object({
    letterId: z.string().uuid(),
    sender: z.string().optional(),
    recipient: z.string().optional(),
  })).min(1),
});

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

const versionBodySchema = z.object({
  fieldType: z.enum(['transcript', 'metadata']),
  content: z.union([z.string(), z.record(z.unknown())]),
  source: z.enum(['ai', 'human']),
});

const updateLinkedPersonSchema = z.object({
  canonicalName: z.string().min(1, 'Name is required'),
});

const updateLinkedPlaceSchema = z.object({
  canonicalName: z.string().min(1, 'Name is required'),
});

const addLinkedPersonSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['sender', 'recipient', 'mentioned']),
});

const addLinkedPlaceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['written_from', 'mentioned', 'destination']),
});

const reExtractSchema = z.object({
  confirmedSender: z.string().optional(),
  confirmedRecipient: z.string().optional(),
  mode: z.enum(['full', 'metadata_only', 'entities_only']),
});

const updateIdentitySchema = z.object({
  sender: z.string().nullable().optional(),
  recipient: z.string().nullable().optional(),
});

// ============================================================================
// LETTER LISTING
// ============================================================================

router.get('/letters', async (req, res, next) => {
  try {
    const query = adminLettersQuerySchema.parse(req.query);
    req.log.debug(
      { collection: query.collection, visibility: query.visibility, workflow: query.workflow, search: query.search, page: query.page },
      'Admin letters list query',
    );

    const result = await queryAdminLetters(query);

    req.log.info(
      { resultCount: result.letters.length, total: result.pagination.total, page: query.page },
      'Admin letters list completed',
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PROCESSING QUEUE
// ============================================================================

router.get('/processing/status', (_req, res) => {
  res.json(getProcessingStatus());
});

router.get('/processing/queue', async (_req, res, next) => {
  try {
    res.json(await getQueueStatus());
  } catch (error) {
    next(error);
  }
});

router.post('/processing/start-transcription', async (req, res, next) => {
  try {
    const options = processingFilterSchema.parse(req.body || {});
    const result = await startTranscriptionProcessing(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/processing/start-metadata', async (req, res, next) => {
  try {
    const options = processingFilterSchema.parse(req.body || {});
    const result = await startMetadataProcessing(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/processing/start-entities', async (req, res, next) => {
  try {
    const options = processingFilterSchema.parse(req.body || {});
    const result = await startEntityExtractionProcessing(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/processing/start-entity-resolution', async (req, res, next) => {
  try {
    const { collectionCode } = z.object({ collectionCode: z.string().min(1) }).parse(req.body || {});
    const result = await startEntityResolutionProcessing(collectionCode);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/processing/entity-resolution-status', (_req, res) => {
  res.json(getEntityResolutionStatus());
});

router.post('/processing/pause', (_req, res) => {
  try {
    res.json(pauseProcessing());
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post('/processing/resume', (_req, res) => {
  try {
    res.json(resumeProcessing());
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

router.post('/processing/abort', async (req, res, next) => {
  try {
    const result = await abortProcessing();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// QUEUE MANAGEMENT
// ============================================================================

router.post('/processing/cancel', async (req, res, next) => {
  try {
    const { letterId, type } = req.body;
    const jobType = queueJobTypeSchema.parse(type);
    if (!letterId || typeof letterId !== 'string') {
      res.status(400).json({ error: 'letterId required' });
      return;
    }
    const result = await cancelActiveJob(letterId, jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/processing/queue/remove', async (req, res, next) => {
  try {
    const { letterId, type } = req.body;
    const jobType = queueJobTypeSchema.parse(type);
    if (!letterId || typeof letterId !== 'string') {
      res.status(400).json({ error: 'letterId required' });
      return;
    }
    const result = await removeFromQueue(letterId, jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/processing/queue/clear', async (req, res, next) => {
  try {
    const { type } = req.body;
    const jobType = queueJobTypeSchema.parse(type);
    const result = await clearQueue(jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/processing/queue/retry', async (req, res, next) => {
  try {
    const { letterId, type } = req.body;
    const jobType = queueJobTypeSchema.parse(type);
    if (!letterId || typeof letterId !== 'string') {
      res.status(400).json({ error: 'letterId required' });
      return;
    }
    const result = await retryJob(letterId, jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// BULK OPERATIONS
// ============================================================================

router.post('/letters/bulk/transcribe', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const result = await bulkTranscribe(parseResult.data.letterIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/bulk/extract-metadata', async (req, res, next) => {
  try {
    const parseResult = bulkMetadataSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const { letterIds, skipConfirmationCheck } = parseResult.data;
    const result = await bulkExtractMetadata(letterIds, skipConfirmationCheck);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/bulk/clear-transcriptions', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const result = await bulkClearTranscriptions(parseResult.data.letterIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/letters/bulk/update-fields', async (req, res, next) => {
  try {
    const parseResult = bulkUpdateFieldsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const result = await bulkUpdateFields(parseResult.data.updates);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/bulk/clear-metadata', async (req, res, next) => {
  try {
    const parseResult = bulkLetterIdsSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request', details: parseResult.error.errors });
      return;
    }
    const result = await bulkClearMetadata(parseResult.data.letterIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// FLAG TOGGLE
// ============================================================================

const toggleFlagSchema = z.object({
  flagged: z.boolean(),
});

router.patch('/letters/:letterId/flag', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = toggleFlagSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { flagged } = parseResult.data;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    await db.update(letters).set({
      flagged,
      flaggedAt: flagged ? new Date() : null,
      flaggedBy: flagged ? 'admin' : null,
    }).where(eq(letters.id, letterId));

    req.log.info({ letterId, flagged }, 'Letter flag toggled');

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// SINGLE LETTER OPERATIONS
// ============================================================================

router.get('/letters/:letterId', async (req, res, next) => {
  try {
    const letterDTO = await fetchLetterWithRelatedAndTransform(req.params.letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Fire-and-forget: track that this letter was opened
    db.execute(sql`
      INSERT INTO letter_views (letter_id, last_opened_at) VALUES (${req.params.letterId}, now())
      ON CONFLICT (letter_id) DO UPDATE SET last_opened_at = now()
    `).catch(err => req.log.warn({ letterId: req.params.letterId, err }, 'Failed to update lastOpenedAt'));

    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/process', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    await resetLetterForProcessing(letterId);
    res.json({ message: 'Letter enqueued for processing', letterId });
  } catch (error) {
    next(error);
  }
});

router.put('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = updateLetterSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const result = await buildLetterUpdates(letterId, parseResult.data as UpdateLetterInput);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Apply the updates
    await db.update(letters).set(result.dbUpdates).where(eq(letters.id, letterId));

    req.log.info({ letterId, workflowChange: result.workflowChange }, 'Letter updated');

    // Auto-resolve notes triggered by field changes
    const fieldTriggers: Array<[string | undefined | null, string]> = [
      [parseResult.data.sender, 'sender'],
      [parseResult.data.recipient, 'recipient'],
      [parseResult.data.locationWritten, 'locationWritten'],
      [parseResult.data.extractedDateConfidence, 'extractedDateConfidence'],
      [parseResult.data.extractedDate, 'extractedDate'],
      [parseResult.data.transcriptionText, 'transcriptionText'],
    ];
    for (const [value, field] of fieldTriggers) {
      if (value !== undefined) {
        checkNoteAutoResolutions(letterId, field).catch(err =>
          req.log.warn({ letterId, field, err }, 'Note auto-resolution failed'));
      }
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// TRANSCRIPT CONFIRMATION & REGENERATION
// ============================================================================

router.post('/letters/:letterId/confirm-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    if (letter.workflow !== 'TRANSCRIBED') {
      res.status(400).json({ error: 'Letter must be in TRANSCRIBED state', currentState: letter.workflow });
      return;
    }
    await db.update(letters).set({
      transcriptConfirmedAt: new Date(),
      transcriptConfirmedBy: 'admin',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    await runMetadataExtractionV2(letterId);

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/regenerate-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    if (!letter.transcriptConfirmedAt) {
      res.status(400).json({ error: 'Transcript must be confirmed before regenerating metadata' });
      return;
    }
    if (letter.metadataStatus === 'RUNNING') {
      res.status(400).json({ error: 'Metadata extraction is already in progress' });
      return;
    }
    await db.update(letters).set({
      metadataAttemptCount: 0,
      metadataError: null,
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

    await runMetadataExtractionV2(letterId);

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/regenerate-entities', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    if (!letter.transcriptionText) {
      res.status(400).json({ error: 'Letter must have a transcription before extracting entities' });
      return;
    }
    if (letter.entityExtractionStatus === 'RUNNING') {
      res.status(400).json({ error: 'Entity extraction is already in progress' });
      return;
    }
    await runEntityExtractionOnly(letterId);

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// RE-EXTRACTION WITH CORRECTIONS
// ============================================================================

router.post('/letters/:letterId/re-extract', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = reExtractSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { confirmedSender, confirmedRecipient, mode } = parseResult.data;

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (!letter.transcriptionText) {
      res.status(400).json({ error: 'Letter must have a transcription before re-extraction' });
      return;
    }

    // Build correction context from previous AI results
    const metadataV2 = letter.metadataV2Json as Record<string, unknown> | null;
    const senderObj = metadataV2?.sender as { name?: string | null } | undefined;
    const recipientObj = metadataV2?.recipient as { name?: string | null } | undefined;

    const extractionOptions: ExtractionOptions = {
      confirmedSender: confirmedSender,
      confirmedRecipient: confirmedRecipient,
      previousAiSender: senderObj?.name ?? letter.sender ?? undefined,
      previousAiRecipient: recipientObj?.name ?? letter.recipient ?? undefined,
    };

    req.log.info(
      { letterId, mode, confirmedSender, confirmedRecipient },
      'Starting re-extraction with corrections',
    );

    if (mode === 'full') {
      // Reset attempt count so the pipeline doesn't block on MAX_ATTEMPTS
      await db.update(letters).set({
        metadataAttemptCount: 0,
        metadataError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

      await runMetadataExtractionV2(letterId, extractionOptions);
    } else if (mode === 'metadata_only') {
      await db.update(letters).set({
        metadataAttemptCount: 0,
        metadataError: null,
        updatedAt: new Date(),
      }).where(eq(letters.id, letterId));

      // Run full pipeline but we only care about Phase 1 results
      // The pipeline always runs Phase 2 after Phase 1, but Phase 2 failure is non-fatal
      await runMetadataExtractionV2(letterId, extractionOptions);
    } else if (mode === 'entities_only') {
      await runEntityExtractionOnly(letterId, extractionOptions);
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// QUICK IDENTITY UPDATE (no AI)
// ============================================================================

router.patch('/letters/:letterId/identity', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = updateIdentitySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const { sender: newSender, recipient: newRecipient } = parseResult.data;

    if (newSender === undefined && newRecipient === undefined) {
      res.status(400).json({ error: 'At least one of sender or recipient must be provided' });
      return;
    }

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const updatePaths: string[] = [];

    // Process sender change
    if (newSender !== undefined) {
      const oldSender = letter.sender;

      if ((isPlaceholderValue(oldSender) || !oldSender) && newSender) {
        // Path A: Placeholder replacement (old was placeholder or null, new name provided)
        try {
          await propagatePlaceholderReplacement({ letterId, field: 'sender', newName: newSender });
          updatePaths.push('sender:placeholder-replaced');
        } catch (err) {
          req.log.warn({ letterId, err }, 'Placeholder replacement failed for sender, falling back to simple update');
          await db.update(letters).set({ sender: newSender, updatedAt: new Date() }).where(eq(letters.id, letterId));
          updatePaths.push('sender:simple-fallback');
        }
      } else if (oldSender && newSender) {
        // Path B: Propagation (old name is a real name, new name provided)
        if (oldSender !== newSender) {
          try {
            await propagateName({ letterId, field: 'sender', oldName: oldSender, newName: newSender });
            updatePaths.push('sender:propagated');
          } catch (err) {
            req.log.warn({ letterId, err }, 'Name propagation failed for sender, falling back to simple update');
            await db.update(letters).set({ sender: newSender, updatedAt: new Date() }).where(eq(letters.id, letterId));
            updatePaths.push('sender:simple-fallback');
          }
        }
        // If old === new, no-op
      } else if (oldSender && !newSender) {
        // Path C: Clear the field
        await db.update(letters).set({ sender: null, updatedAt: new Date() }).where(eq(letters.id, letterId));
        updatePaths.push('sender:cleared');
      }
    }

    // Process recipient change
    if (newRecipient !== undefined) {
      const oldRecipient = letter.recipient;

      if ((isPlaceholderValue(oldRecipient) || !oldRecipient) && newRecipient) {
        // Path A: Placeholder replacement (old was placeholder or null, new name provided)
        try {
          await propagatePlaceholderReplacement({ letterId, field: 'recipient', newName: newRecipient });
          updatePaths.push('recipient:placeholder-replaced');
        } catch (err) {
          req.log.warn({ letterId, err }, 'Placeholder replacement failed for recipient, falling back to simple update');
          await db.update(letters).set({ recipient: newRecipient, updatedAt: new Date() }).where(eq(letters.id, letterId));
          updatePaths.push('recipient:simple-fallback');
        }
      } else if (oldRecipient && newRecipient) {
        // Path B: Propagation (old name is a real name, new name provided)
        if (oldRecipient !== newRecipient) {
          try {
            await propagateName({ letterId, field: 'recipient', oldName: oldRecipient, newName: newRecipient });
            updatePaths.push('recipient:propagated');
          } catch (err) {
            req.log.warn({ letterId, err }, 'Name propagation failed for recipient, falling back to simple update');
            await db.update(letters).set({ recipient: newRecipient, updatedAt: new Date() }).where(eq(letters.id, letterId));
            updatePaths.push('recipient:simple-fallback');
          }
        }
      } else if (oldRecipient && !newRecipient) {
        // Path C: Clear
        await db.update(letters).set({ recipient: null, updatedAt: new Date() }).where(eq(letters.id, letterId));
        updatePaths.push('recipient:cleared');
      }
    }

    req.log.info({ letterId, newSender, newRecipient, updatePaths }, 'Smart identity update completed');

    // Auto-resolve notes triggered by identity changes
    if (newSender !== undefined && newSender) {
      checkNoteAutoResolutions(letterId, 'sender').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for sender'));
    }
    if (newRecipient !== undefined && newRecipient) {
      checkNoteAutoResolutions(letterId, 'recipient').catch(err =>
        req.log.warn({ letterId, err }, 'Note auto-resolution failed for recipient'));
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// VERSION HISTORY
// ============================================================================

router.get('/letters/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const fieldType = req.query.fieldType as string;
    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const versions = await getVersions(letterId, fieldType as 'transcript' | 'metadata');
    res.json({ versions: versions || [] });
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/versions', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const parseResult = versionBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await createVersion(letterId, parseResult.data);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/versions/:versionNumber/restore', async (req, res, next) => {
  try {
    const { letterId, versionNumber } = req.params;
    const fieldType = req.query.fieldType as string;
    if (!fieldType || !['transcript', 'metadata'].includes(fieldType)) {
      res.status(400).json({ error: 'fieldType query param required (transcript or metadata)' });
      return;
    }
    const vn = parseInt(versionNumber, 10);
    if (isNaN(vn) || vn < 1) {
      res.status(400).json({ error: 'Invalid version number' });
      return;
    }
    const result = await restoreVersion(letterId, vn, fieldType as 'transcript' | 'metadata');
    if (!result) {
      res.status(404).json({ error: 'Letter or version not found' });
      return;
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after restore' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// TWO-TRACK VERIFICATION
// ============================================================================

router.post('/letters/:letterId/verify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyTranscript(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/unverify-transcript', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyTranscript(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found or not verified' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/verify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyMetadata(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/unverify-metadata', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyMetadata(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found or not verified' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// TRANSCRIPTION
// ============================================================================

router.post('/letters/:letterId/regenerate-transcription', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const includeExtras = req.query.includeExtras === 'true';
    const result = await regenerateTranscription(letterId, includeExtras);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json({
      letter: letterDTO,
      regenerated: {
        mainTranscript: result.mainTranscript,
        extras: result.extras,
        extrasCount: result.extrasCount,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/transcribe-letter', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await transcribeLetterOnly(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json({
      letter: letterDTO,
      transcribed: {
        pageCount: result.pageCount,
        textLength: result.textLength,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/transcribe-extras', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await transcribeExtras(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(500).json({ error: 'Failed to fetch updated letter' });
      return;
    }
    res.json({
      letter: letterDTO,
      transcribedCount: result.transcribedCount,
      extraContentStatus: result.extraContentStatus,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// EXTRA CONTENT
// ============================================================================

router.put('/letters/:letterId/extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { extraContent, extraContentTranscript } = (req.body ?? {}) as {
      extraContent?: string | null;
      extraContentTranscript?: string | null;
    };
    const nextExtraContent =
      extraContent !== undefined ? extraContent : extraContentTranscript;
    if (nextExtraContent === undefined) {
      res.status(400).json({ error: 'extraContent field required' });
      return;
    }
    const result = await updateExtraContent(letterId, nextExtraContent);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/verify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await verifyExtraContent(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/unverify-extra-content', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const result = await unverifyExtraContent(letterId);
    if (!result) {
      res.status(404).json({ error: 'Letter not found or not verified' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// AI NOTES
// ============================================================================

router.put('/letters/:letterId/ai-notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const { aiNotes } = req.body;
    const result = await updateAiNotes(letterId, aiNotes ?? []);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

const addNoteSchema = z.object({
  content: z.string().min(1),
  category: z.enum(['identity', 'date', 'transcription', 'relationship', 'context', 'cross-reference', 'location', 'condition']),
  priority: z.enum(['high', 'medium', 'low']),
});

router.post('/letters/:letterId/notes', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = addNoteSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const existingNotes: StructuredNote[] = Array.isArray(letter.aiNotes)
      ? (letter.aiNotes as StructuredNote[])
      : [];

    const newNote: StructuredNote = {
      id: crypto.randomUUID(),
      content: parseResult.data.content,
      category: parseResult.data.category as NoteCategory,
      priority: parseResult.data.priority as NotePriority,
      status: 'open',
      resolves_when: null,
      resolved_at: null,
      resolved_by: null,
      source: 'admin',
    };

    const updatedNotes = [...existingNotes, newNote];
    await db.update(letters).set({ aiNotes: updatedNotes, updatedAt: new Date() }).where(eq(letters.id, letterId));

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

const updateNoteStatusSchema = z.object({
  status: z.enum(['dismissed', 'resolved']),
});

router.patch('/letters/:letterId/notes/:noteId', async (req, res, next) => {
  try {
    const { letterId, noteId } = req.params;
    const parseResult = updateNoteStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }

    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const existingNotes: StructuredNote[] = Array.isArray(letter.aiNotes)
      ? (letter.aiNotes as StructuredNote[])
      : [];

    const noteIndex = existingNotes.findIndex(n => n.id === noteId);
    if (noteIndex === -1) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    existingNotes[noteIndex] = {
      ...existingNotes[noteIndex],
      status: parseResult.data.status,
      resolved_at: new Date().toISOString(),
      resolved_by: 'admin',
    };

    await db.update(letters).set({ aiNotes: existingNotes, updatedAt: new Date() }).where(eq(letters.id, letterId));

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// LINKED ENTITIES
// ============================================================================

router.put('/letters/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const parseResult = updateLinkedPersonSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await updateLinkedPerson(letterId, linkId, parseResult.data.canonicalName);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.put('/letters/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const parseResult = updateLinkedPlaceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await updateLinkedPlace(letterId, linkId, parseResult.data.canonicalName);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/linked-persons', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = addLinkedPersonSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { name, role } = parseResult.data;
    const result = await addLinkedPerson(letterId, name, role);
    if (!result) {
      res.status(404).json({ error: 'Letter or person not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/linked-places', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = addLinkedPlaceSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const { name: placeName, role: placeRole } = parseResult.data;
    const result = await addLinkedPlace(letterId, placeName, placeRole);
    if (!result) {
      res.status(404).json({ error: 'Letter or place not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.delete('/letters/:letterId/linked-persons/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const result = await removeLinkedPerson(letterId, linkId);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

router.delete('/letters/:letterId/linked-places/:linkId', async (req, res, next) => {
  try {
    const { letterId, linkId } = req.params;
    const result = await removeLinkedPlace(letterId, linkId);
    if (!result) {
      res.status(404).json({ error: 'Link not found' });
      return;
    }
    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after update' });
      return;
    }
    res.json(letterDTO);
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// DELETE
// ============================================================================

router.delete('/letters/:letterId', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const letter = await getLetterById(letterId);
    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    // Find all records in this letter group (same collection, date, sequence
    // but any type — L, T, C, E, P, etc.) so we delete the whole group
    const group = await db.select({ id: letters.id }).from(letters).where(
      and(
        eq(letters.collectionId, letter.collectionId),
        eq(letters.dateRaw, letter.dateRaw),
        eq(letters.typeSequence, letter.typeSequence),
      )
    );
    const groupIds = group.map(r => r.id);

    // Get all page records for file cleanup
    let totalFiles = 0;
    for (const id of groupIds) {
      const pages = await db.select({
        storagePath: letterPages.storagePath,
      }).from(letterPages).where(eq(letterPages.letterId, id));

      for (const page of pages) {
        const absPath = getAbsoluteStoragePath(page.storagePath);
        await unlink(absPath).catch(() => {
          // File may already be missing — that's fine
        });
        totalFiles++;
      }

      // Hard delete the letter record (cascades to pages, versions, persons, places)
      await db.delete(letters).where(eq(letters.id, id));
    }

    req.log.info({ letterId, groupSize: groupIds.length, filesDeleted: totalFiles }, 'Letter group deleted');
    res.json({ message: 'Letter deleted successfully', letterId, deletedCount: groupIds.length });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PAGE-LEVEL OPERATIONS
// ============================================================================

router.post('/letters/pages/:pageId/detect-lines', async (req, res, next) => {
  try {
    const { pageId } = req.params;

    // Look up the page
    const page = await db.query.letterPages.findFirst({
      where: eq(letterPages.id, pageId),
    });

    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    // SSE: stream progress events during detection
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const onProgress = (label: string) => {
      res.write(`data: ${JSON.stringify({ type: 'progress', label })}\n\n`);
    };

    const absolutePath = getAbsoluteStoragePath(page.storagePath);
    const result = await detectAndStorePageLines(pageId, absolutePath, undefined, onProgress);

    res.write(`data: ${JSON.stringify({
      type: 'result',
      lineSegments: result.lineSegments ?? (Array.isArray(page.lineSegments) ? page.lineSegments : []),
      ocrWordBoxes: result.ocrWordBoxes ?? (Array.isArray(page.ocrWordBoxes) ? page.ocrWordBoxes : null),
    })}\n\n`);

    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Detection failed' })}\n\n`);
      res.end();
    } else {
      next(error);
    }
  }
});


// ============================================================================
// AGGREGATE NOTES ACROSS ALL LETTERS
// ============================================================================

const notesQuerySchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/notes', async (req, res, next) => {
  try {
    const query = notesQuerySchema.parse(req.query);
    req.log.debug({ ...query }, 'Aggregate notes query');

    // Fetch all letters that have non-null aiNotes, joined with collection
    const rows = await db
      .select({
        id: letters.id,
        letterDate: letters.letterDate,
        sender: letters.sender,
        recipient: letters.recipient,
        aiNotes: letters.aiNotes,
        collectionCode: collections.collectionCode,
      })
      .from(letters)
      .innerJoin(collections, eq(letters.collectionId, collections.id))
      .where(sql`${letters.aiNotes} IS NOT NULL`);

    // Flatten notes from all letters, handling legacy string/non-array gracefully
    interface AggregatedNote {
      id: string;
      content: string;
      category: string;
      priority: string;
      status: string;
      resolves_when: string | null;
      resolved_at: string | null;
      resolved_by: string | null;
      source: string;
      letterId: string;
      letterDate: string | null;
      collectionCode: string;
      sender: string | null;
      recipient: string | null;
    }

    const allNotes: AggregatedNote[] = [];

    for (const row of rows) {
      const rawNotes = row.aiNotes;

      // Skip if not an array (legacy text format or malformed data)
      if (!Array.isArray(rawNotes)) continue;

      for (const note of rawNotes) {
        // Validate that note has expected shape
        if (!note || typeof note !== 'object' || !('id' in note) || !('content' in note)) continue;

        const n = note as Record<string, unknown>;
        allNotes.push({
          id: String(n.id ?? ''),
          content: String(n.content ?? ''),
          category: String(n.category ?? 'context'),
          priority: String(n.priority ?? 'medium'),
          status: String(n.status ?? 'open'),
          resolves_when: n.resolves_when != null ? String(n.resolves_when) : null,
          resolved_at: n.resolved_at != null ? String(n.resolved_at) : null,
          resolved_by: n.resolved_by != null ? String(n.resolved_by) : null,
          source: String(n.source ?? 'ai'),
          letterId: row.id,
          letterDate: row.letterDate,
          collectionCode: row.collectionCode,
          sender: row.sender,
          recipient: row.recipient,
        });
      }
    }

    // Compute status counts from the full (unfiltered) set
    const counts = {
      open: allNotes.filter(n => n.status === 'open').length,
      resolved: allNotes.filter(n => n.status === 'resolved').length,
      dismissed: allNotes.filter(n => n.status === 'dismissed').length,
    };

    // Apply filters
    let filtered = allNotes;

    if (query.status) {
      filtered = filtered.filter(n => n.status === query.status);
    }
    if (query.priority) {
      filtered = filtered.filter(n => n.priority === query.priority);
    }
    if (query.category) {
      filtered = filtered.filter(n => n.category === query.category);
    }
    if (query.search) {
      const lower = query.search.toLowerCase();
      filtered = filtered.filter(n => n.content.toLowerCase().includes(lower));
    }

    // Sort: open first (high priority at top), then resolved, then dismissed
    const STATUS_ORDER: Record<string, number> = { open: 0, resolved: 1, dismissed: 2 };
    const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

    filtered.sort((a, b) => {
      const statusDiff = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
      if (statusDiff !== 0) return statusDiff;
      return (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    });

    const total = filtered.length;
    const paginated = filtered.slice(query.offset, query.offset + query.limit);

    req.log.info({ total, returned: paginated.length }, 'Aggregate notes query completed');

    res.json({ notes: paginated, total, counts });
  } catch (error) {
    next(error);
  }
});

export default router;
