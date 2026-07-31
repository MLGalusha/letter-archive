import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import uploadsRouter from './uploads.js';
import lettersRouter from './letters.js';
import collectionsRouter from './collections.js';
import entitiesRouter from './entities.js';
import relationshipsRouter from './relationships.js';
import settingsRouter from './settings.js';
import notificationsRouter from './notifications.js';
import usageRouter from './usage.js';
import contentRouter from './content.js';
import blogImagesRouter from './blog-images.js';
import layoutBenchmarkRouter from './layout-benchmark.js';
import layoutProcessingRouter from './layout-processing.js';
import transcriptAlignmentRouter from './transcript-alignment.js';
import productionTranscriptAlignmentRouter from './production-transcript-alignment.js';

const router = Router();

// All admin routes require authentication
router.use(requireAuth);

router.use(uploadsRouter);
router.use(lettersRouter);
router.use('/collections', collectionsRouter);
router.use('/entities', entitiesRouter);
router.use('/relationships', relationshipsRouter);
router.use(settingsRouter);
router.use(notificationsRouter);
router.use(usageRouter);
router.use(contentRouter);
router.use(blogImagesRouter);
router.use('/letters', productionTranscriptAlignmentRouter);
router.use('/layout-benchmark/alignment', transcriptAlignmentRouter);
router.use('/layout-benchmark', layoutBenchmarkRouter);
router.use('/layout-processing', layoutProcessingRouter);

export default router;
