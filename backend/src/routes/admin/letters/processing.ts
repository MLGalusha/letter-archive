import { Router } from 'express';
import {
  cancelActiveJob,
  clearProcessingQueueSnapshotSchema,
  clearQueue,
  getQueueStatus,
  processingJobActionSchema,
  removeFromQueue,
  retryJob,
  wakeBackgroundWorkerForQueuedProcessing,
} from '../../../services/processing-queue.js';

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
    const {
      letterId,
      type,
      primarySourceRevision,
      jobStateToken,
    } = processingJobActionSchema.parse(req.body);
    const result = await cancelActiveJob(letterId, type, {
      primarySourceRevision,
      jobStateToken,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/queue/remove', async (req, res, next) => {
  try {
    const {
      letterId,
      type,
      primarySourceRevision,
      jobStateToken,
    } = processingJobActionSchema.parse(req.body);
    const result = await removeFromQueue(letterId, type, {
      primarySourceRevision,
      jobStateToken,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/queue/clear', async (req, res, next) => {
  try {
    const { type, items } = clearProcessingQueueSnapshotSchema.parse(req.body);
    const result = await clearQueue(type, items);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/queue/retry', async (req, res, next) => {
  try {
    const {
      letterId,
      type,
      primarySourceRevision,
      jobStateToken,
    } = processingJobActionSchema.parse(req.body);
    const result = await retryJob(letterId, type, {
      primarySourceRevision,
      jobStateToken,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
