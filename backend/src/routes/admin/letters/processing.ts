import { Router } from 'express';
import {
  abortProcessing,
  cancelActiveJob,
  clearQueue,
  getEntityResolutionStatus,
  getProcessingStatus,
  getQueueStatus,
  pauseProcessing,
  processingFilterSchema,
  queueJobTypeSchema,
  removeFromQueue,
  resumeProcessing,
  retryJob,
  startEntityExtractionProcessing,
  startEntityResolutionProcessing,
  startMetadataProcessing,
  startTranscriptionProcessing,
} from '../../../services/processing-queue.js';
import { BadRequestError } from '../../../utils/response-helpers.js';
import { requireString } from './helpers.js';
import { entityResolutionBodySchema } from './shared.js';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getProcessingStatus());
});

router.get('/queue', async (_req, res, next) => {
  try {
    res.json(await getQueueStatus());
  } catch (error) {
    next(error);
  }
});

router.post('/start-transcription', async (req, res, next) => {
  try {
    const options = processingFilterSchema.parse(req.body || {});
    const result = await startTranscriptionProcessing(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/start-metadata', async (req, res, next) => {
  try {
    const options = processingFilterSchema.parse(req.body || {});
    const result = await startMetadataProcessing(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/start-entities', async (req, res, next) => {
  try {
    const options = processingFilterSchema.parse(req.body || {});
    const result = await startEntityExtractionProcessing(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/start-entity-resolution', async (req, res, next) => {
  try {
    const { collectionCode } = entityResolutionBodySchema.parse(req.body || {});
    const result = await startEntityResolutionProcessing(collectionCode);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/entity-resolution-status', (_req, res) => {
  res.json(getEntityResolutionStatus());
});

router.post('/pause', (_req, res, next) => {
  try {
    res.json(pauseProcessing());
  } catch (error) {
    next(new BadRequestError((error as Error).message));
  }
});

router.post('/resume', (_req, res, next) => {
  try {
    res.json(resumeProcessing());
  } catch (error) {
    next(new BadRequestError((error as Error).message));
  }
});

router.post('/abort', async (req, res, next) => {
  try {
    const result = await abortProcessing();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/cancel', async (req, res, next) => {
  try {
    const letterId = requireString(req.body?.letterId, 'letterId required');
    const jobType = queueJobTypeSchema.parse(req.body?.type);
    const result = await cancelActiveJob(letterId, jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/queue/remove', async (req, res, next) => {
  try {
    const letterId = requireString(req.body?.letterId, 'letterId required');
    const jobType = queueJobTypeSchema.parse(req.body?.type);
    const result = await removeFromQueue(letterId, jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/queue/clear', async (req, res, next) => {
  try {
    const jobType = queueJobTypeSchema.parse(req.body?.type);
    const result = await clearQueue(jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/queue/retry', async (req, res, next) => {
  try {
    const letterId = requireString(req.body?.letterId, 'letterId required');
    const jobType = queueJobTypeSchema.parse(req.body?.type);
    const result = await retryJob(letterId, jobType);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
