import { Router } from 'express';
import uploadsRouter from './uploads.js';
import lettersRouter from './letters.js';
import collectionsRouter from './collections.js';
import entitiesRouter from './entities.js';
import relationshipsRouter from './relationships.js';

const router = Router();

router.use(uploadsRouter);
router.use(lettersRouter);
router.use('/collections', collectionsRouter);
router.use('/entities', entitiesRouter);
router.use('/relationships', relationshipsRouter);

export default router;
