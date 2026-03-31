import { Router } from 'express';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { db, letters } from '../../../db/index.js';
import {
  bulkClearMetadata,
  bulkClearTranscriptions,
  bulkExtractMetadata,
  bulkTranscribe,
  bulkUpdateFields,
} from '../../../services/letter-operations.js';
import {
  bulkLetterIdsSchema,
  bulkMetadataSchema,
  bulkUpdateFieldsSchema,
} from './shared.js';
import { parseOrThrow } from './helpers.js';

const bulkContentVisibilitySchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
  transcriptPublished: z.boolean().optional(),
  metadataPublished: z.boolean().optional(),
}).refine(
  (data) => data.transcriptPublished !== undefined || data.metadataPublished !== undefined,
  { message: 'At least one of transcriptPublished or metadataPublished must be provided' },
);

const router = Router();

router.post('/transcribe', async (req, res, next) => {
  try {
    const { letterIds } = parseOrThrow(bulkLetterIdsSchema, req.body, 'Invalid request');
    const result = await bulkTranscribe(letterIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/extract-metadata', async (req, res, next) => {
  try {
    const { letterIds, skipConfirmationCheck } = parseOrThrow(bulkMetadataSchema, req.body, 'Invalid request');
    const result = await bulkExtractMetadata(letterIds, skipConfirmationCheck);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/clear-transcriptions', async (req, res, next) => {
  try {
    const { letterIds } = parseOrThrow(bulkLetterIdsSchema, req.body, 'Invalid request');
    const result = await bulkClearTranscriptions(letterIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/update-fields', async (req, res, next) => {
  try {
    const { updates } = parseOrThrow(bulkUpdateFieldsSchema, req.body, 'Invalid request');
    const result = await bulkUpdateFields(updates);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/clear-metadata', async (req, res, next) => {
  try {
    const { letterIds } = parseOrThrow(bulkLetterIdsSchema, req.body, 'Invalid request');
    const result = await bulkClearMetadata(letterIds);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/content-visibility', async (req, res, next) => {
  try {
    const { letterIds, transcriptPublished, metadataPublished } = parseOrThrow(
      bulkContentVisibilitySchema, req.body, 'Invalid request',
    );
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (transcriptPublished !== undefined) updates.transcriptPublished = transcriptPublished;
    if (metadataPublished !== undefined) updates.metadataPublished = metadataPublished;

    await db.update(letters).set(updates).where(inArray(letters.id, letterIds));
    res.json({ updated: letterIds.length });
  } catch (error) {
    next(error);
  }
});

export default router;
