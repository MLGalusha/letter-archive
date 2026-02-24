import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { db, letters, letterPages } from '../../db/index.js';
import { getLetterById, resetLetterForProcessing } from '../../services/letters.js';
import { getAbsoluteStoragePath } from '../../services/storage.js';
import { runMetadataExtractionV2, runEntityExtractionOnly } from '../../pipeline/metadataV2.js';

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
  resyncCheck,
  resyncLetterMetadata,
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

const resyncSchema = z.object({
  oldSender: z.string().nullable(),
  newSender: z.string().nullable(),
  oldRecipient: z.string().nullable(),
  newRecipient: z.string().nullable(),
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
// SINGLE LETTER OPERATIONS
// ============================================================================

router.get('/letters/:letterId', async (req, res, next) => {
  try {
    const letterDTO = await fetchLetterWithRelatedAndTransform(req.params.letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
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
      metadataStatus: 'PENDING',
      updatedAt: new Date(),
    }).where(eq(letters.id, letterId));

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
    const result = await getVersions(letterId, fieldType as 'transcript' | 'metadata');
    res.json(result);
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
    const result = await restoreVersion(letterId, parseInt(versionNumber, 10), fieldType as 'transcript' | 'metadata');
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
    res.json({ ...letterDTO, regeneration: result });
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
    res.json(letterDTO);
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
    res.json(letterDTO);
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
    const { extraContent } = req.body;
    if (extraContent === undefined) {
      res.status(400).json({ error: 'extraContent field required' });
      return;
    }
    const result = await updateExtraContent(letterId, extraContent);
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
    const result = await updateAiNotes(letterId, aiNotes ?? null);
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
// METADATA RESYNC
// ============================================================================

router.post('/letters/:letterId/resync-check', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = resyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await resyncCheck(letterId, parseResult.data);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/letters/:letterId/resync', async (req, res, next) => {
  try {
    const { letterId } = req.params;
    const parseResult = resyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'Invalid request body', details: parseResult.error.errors });
      return;
    }
    const result = await resyncLetterMetadata(letterId, parseResult.data);
    if (!result) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    const letterDTO = await fetchLetterWithRelatedAndTransform(letterId);
    if (!letterDTO) {
      res.status(404).json({ error: 'Letter not found after resync' });
      return;
    }
    res.json({ ...result, letter: letterDTO });
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

export default router;
