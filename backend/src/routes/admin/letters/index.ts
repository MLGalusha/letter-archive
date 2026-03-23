import { Router } from 'express';
import bulkRouter from './bulk.js';
import contentRouter from './content.js';
import entitiesRouter from './entities.js';
import listRouter from './list.js';
import processingRouter from './processing.js';
import verificationRouter from './verification.js';

const router = Router();

router.use('/', listRouter);
router.use('/processing', processingRouter);
router.use('/letters/bulk', bulkRouter);
router.use('/letters', contentRouter);
router.use('/letters', entitiesRouter);
router.use('/letters', verificationRouter);

export default router;
