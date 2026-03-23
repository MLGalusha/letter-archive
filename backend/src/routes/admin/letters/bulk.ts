import { Router } from 'express';
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

export default router;
