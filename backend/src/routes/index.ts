import { Router } from 'express';
import healthRouter from './health.js';
import lettersRouter from './letters.js';
import imagesRouter from './images.js';
import collectionsRouter from './collections.js';
import personsRouter from './persons.js';
import placesRouter from './places.js';
import relationshipsRouter from './relationships.js';
import adminRouter from './admin/index.js';

const router = Router();

router.use(healthRouter);
router.use(lettersRouter);
router.use(imagesRouter);
router.use(collectionsRouter);
router.use(personsRouter);
router.use(placesRouter);
router.use(relationshipsRouter);
router.use('/admin', adminRouter);

export default router;
