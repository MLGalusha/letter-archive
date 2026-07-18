import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { db, letters } from '../../../db/index.js';
import {
  bulkClearMetadata,
  bulkClearTranscriptions,
  bulkExtractMetadata,
  bulkTranscribe,
  bulkUpdateFields,
} from '../../../services/letter-operations.js';
import {
  metadataPublicationConditions,
  transcriptPublicationConditions,
} from '../../../services/letter/publication.js';
import {
  bulkLetterIdsSchema,
  bulkMetadataSchema,
  bulkUpdateFieldsSchema,
} from './shared.js';
import { parseOrThrow } from './helpers.js';

const bulkContentVisibilitySchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
  visibility: z.enum(['PUBLISHED', 'HIDDEN']).optional(),
  transcriptPublished: z.boolean().optional(),
  metadataPublished: z.boolean().optional(),
}).refine(
  (data) => data.transcriptPublished !== undefined || data.metadataPublished !== undefined || data.visibility !== undefined,
  { message: 'At least one of visibility, transcriptPublished, or metadataPublished must be provided' },
);

const router = Router();

const bulkTranscribeSchema = z.object({
  letterIds: z.array(z.string().uuid()).min(1),
  overwrite: z.boolean().optional().default(false),
});

router.post('/transcribe', async (req, res, next) => {
  try {
    const { letterIds, overwrite } = parseOrThrow(bulkTranscribeSchema, req.body, 'Invalid request');
    const result = await bulkTranscribe(letterIds, overwrite);
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
    const { letterIds, visibility, transcriptPublished, metadataPublished } = parseOrThrow(
      bulkContentVisibilitySchema, req.body, 'Invalid request',
    );
    const updatedLetterIds = new Set<string>();
    const updateMatchingLetters = async (
      updates: {
        visibility?: 'PUBLISHED' | 'HIDDEN';
        transcriptPublished?: boolean;
        metadataPublished?: boolean;
      },
      eligibility: SQL[] = [],
    ) => {
      const selectedLetters = inArray(letters.id, letterIds);
      const condition = eligibility.length > 0
        ? and(selectedLetters, ...eligibility)
        : selectedLetters;
      const updated = await db
        .update(letters)
        .set({ ...updates, updatedAt: new Date() })
        .where(condition)
        .returning({ id: letters.id });

      for (const { id } of updated) updatedLetterIds.add(id);
    };

    if (visibility !== undefined) {
      await updateMatchingLetters({ visibility });
    }
    if (transcriptPublished !== undefined) {
      await updateMatchingLetters(
        { transcriptPublished },
        transcriptPublished ? transcriptPublicationConditions() : [],
      );
    }
    if (metadataPublished !== undefined) {
      await updateMatchingLetters(
        { metadataPublished },
        metadataPublished
          ? metadataPublicationConditions()
          : [],
      );
    }

    res.json({ updated: updatedLetterIds.size });
  } catch (error) {
    next(error);
  }
});

export default router;
