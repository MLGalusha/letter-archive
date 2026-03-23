import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import uploadsRouter from './uploads.js';
import lettersRouter from './letters.js';
import collectionsRouter from './collections.js';
import settingsRouter from './settings.js';
import notificationsRouter from './notifications.js';
import usageRouter from './usage.js';
import contentRouter from './content.js';

const router = Router();

// All admin routes require authentication
router.use(requireAuth);

router.use(uploadsRouter);
router.use(lettersRouter);
router.use('/collections', collectionsRouter);
router.use(settingsRouter);
router.use(notificationsRouter);
router.use(usageRouter);
router.use(contentRouter);

export default router;
