import { Router } from 'express';
import { db, siteSettings } from '../db/index.js';
import healthRouter from './health.js';
import lettersRouter from './letters.js';
import imagesRouter from './images.js';
import collectionsRouter from './collections.js';
import sitemapRouter from './sitemap.js';
import adminRouter from './admin/index.js';
import authRouter from './auth.js';
import blogRouter from './updates.js';
import contentPagesRouter from './content-pages.js';

const router = Router();

router.use(healthRouter);
router.use(sitemapRouter);
router.use(lettersRouter);
router.use(imagesRouter);
router.use(collectionsRouter);
router.use(authRouter);
router.use(blogRouter);
router.use(contentPagesRouter);
router.use('/admin', adminRouter);

// Public site settings (non-sensitive keys only)
const PUBLIC_SETTINGS_KEYS = [
  'site_title',
  'site_description',
  'donate_onetime_url',
  'donate_monthly_url',
  'contact_general_email',
  'contact_contribute_email',
  'contact_research_email',
  'contact_volunteer_email',
  'featured_letter_id',
];

router.get('/settings/public', async (_req, res) => {
  try {
    const rows = await db.select().from(siteSettings);
    const map: Record<string, string> = {};
    for (const row of rows) {
      if (PUBLIC_SETTINGS_KEYS.includes(row.key)) {
        map[row.key] = row.value;
      }
    }
    res.json(map);
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
