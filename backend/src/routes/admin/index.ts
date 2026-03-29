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

export default router;
