import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { lazyRouter } from '../../middleware/lazy-router.js';

const router = Router();

// Public startup must not evaluate upload, transcription and editor routes.
// Authenticate before loading them, preserving the same boundary on every request.
router.use(requireAuth);
router.use(lazyRouter(() => import('./routes.js')));

export default router;
