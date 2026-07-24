import { Router } from 'express';
import {
  cancelActiveJob,
  clearQueue,
  getQueueStatus,
  queueJobTypeSchema,
  removeFromQueue,
  retryJob,
  wakeBackgroundWorkerForQueuedProcessing,
} from '../../../services/processing-queue.js';
import { requireString } from './helpers.js';

const router = Router();

router.get('/queue', async (_req, res, next) => {
  try {
    res.json(await getQueueStatus());
  } catch (error) {
    next(error);
  }
});

router.post('/wake', async (_req, res, next) => {
  try {
    res.json(await wakeBackgroundWorkerForQueuedProcessing());
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
