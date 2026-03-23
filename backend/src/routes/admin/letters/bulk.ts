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

const router = Router();

router.post('/transcribe', async (req, res, next) => {
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

router.post('/extract-metadata', async (req, res, next) => {
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

router.post('/clear-transcriptions', async (req, res, next) => {
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

router.patch('/update-fields', async (req, res, next) => {
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

router.post('/clear-metadata', async (req, res, next) => {
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

export default router;
