import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, contentPages } from '../db/index.js';

const router = Router();

// ============================================================================
// GET /content/pages/:slug — Get public page content
// ============================================================================

router.get('/content/pages/:slug', async (req, res) => {
  try {
    const slug = req.params.slug as string;

    const [page] = await db
      .select()
      .from(contentPages)
      .where(eq(contentPages.slug, slug))
      .limit(1);

    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    res.json(page);
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch content page');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
