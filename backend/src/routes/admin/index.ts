import { Router } from 'express';
import uploadsRouter from './uploads.js';
import lettersRouter from './letters.js';

const router = Router();

router.use(uploadsRouter);
router.use(lettersRouter);

export default router;
