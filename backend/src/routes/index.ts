import { Router } from 'express';
import healthRouter from './health.js';
import lettersRouter from './letters.js';
import imagesRouter from './images.js';
import adminRouter from './admin/index.js';

const router = Router();

router.use(healthRouter);
router.use(lettersRouter);
router.use(imagesRouter);
router.use('/admin', adminRouter);

export default router;
