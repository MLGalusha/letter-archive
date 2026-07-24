import { Router } from 'express';
import { z } from 'zod';
import {
  bulkClearMetadata,
  bulkClearTranscriptions,
  bulkExtractMetadata,
  bulkTranscribe,
  bulkUpdateFields,
} from '../../../services/letter-operations.js';
import {
  applyBulkPublicationAction,
  PUBLICATION_ACTIONS,
} from '../../../services/letter/publication-mutations.js';
import {
  bulkSourceRequestSchema,
  bulkSourcesSchema,
  bulkUpdateFieldsSchema,
} from './shared.js';
import { getUserId, parseOrThrow } from './helpers.js';
import { sourceRevisionChanged } from '../../../services/letter/source-revision.js';

const publicationActionSchema = z.enum(PUBLICATION_ACTIONS);

const bulkContentVisibilitySchema = z.object({
  sources: bulkSourcesSchema,
  action: publicationActionSchema,
});

const router = Router();

const bulkTranscribeSchema = bulkSourceRequestSchema.extend({
  overwrite: z.boolean().optional().default(false),
});

function rejectLegacyLetterIds(body: unknown, action: string): void {
  if (
    body
    && typeof body === 'object'
    && !Object.hasOwn(body, 'sources')
    && Array.isArray((body as { letterIds?: unknown }).letterIds)
  ) {
    throw sourceRevisionChanged(
      `Letter source versions are missing; reload the dashboard before ${action}`,
    );
  }
}

router.post('/transcribe', async (req, res, next) => {
  try {
    rejectLegacyLetterIds(req.body, 'starting transcription');
    const { sources, overwrite } = parseOrThrow(
      bulkTranscribeSchema,
      req.body,
      'Invalid request',
    );
    const result = await bulkTranscribe(sources, overwrite);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/extract-metadata', async (req, res, next) => {
  try {
    rejectLegacyLetterIds(req.body, 'starting metadata extraction');
    const { sources } = parseOrThrow(
      bulkSourceRequestSchema,
      req.body,
      'Invalid request',
    );
    const result = await bulkExtractMetadata(sources);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/clear-transcriptions', async (req, res, next) => {
  try {
    rejectLegacyLetterIds(req.body, 'clearing transcriptions');
    const { sources } = parseOrThrow(
      bulkSourceRequestSchema,
      req.body,
      'Invalid request',
    );
    const result = await bulkClearTranscriptions(sources);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/update-fields', async (req, res, next) => {
  try {
    if (
      Array.isArray(req.body?.updates)
      && req.body.updates.some((update: unknown) => (
        typeof update === 'object'
        && update !== null
        && !Object.hasOwn(update, 'primarySourceRevision')
      ))
    ) {
      throw sourceRevisionChanged(
        'Letter source versions are missing; reload the dashboard before saving names',
      );
    }
    const { updates } = parseOrThrow(bulkUpdateFieldsSchema, req.body, 'Invalid request');
    const result = await bulkUpdateFields(updates);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/clear-metadata', async (req, res, next) => {
  try {
    rejectLegacyLetterIds(req.body, 'clearing metadata');
    const { sources } = parseOrThrow(
      bulkSourceRequestSchema,
      req.body,
      'Invalid request',
    );
    const result = await bulkClearMetadata(sources);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.patch('/content-visibility', async (req, res, next) => {
  try {
    if (!req.body?.sources && Array.isArray(req.body?.letterIds)) {
      throw sourceRevisionChanged(
        'Letter source versions are missing; reload the dashboard before publishing',
      );
    }
    const { sources, action } = parseOrThrow(
      bulkContentVisibilitySchema, req.body, 'Invalid request',
    );
    res.json(await applyBulkPublicationAction(
      sources,
      action,
      getUserId(req),
    ));
  } catch (error) {
    next(error);
  }
});

export default router;
