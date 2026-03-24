import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, collections, contentPages, letters, siteSettings } from '../db/index.js';

const router = Router();

// ============================================================================
// GET /content/featured-letter — Get public featured letter
// ============================================================================

router.get('/content/featured-letter', async (req, res) => {
  try {
    const [setting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'featured_letter_id'))
      .limit(1);

    if (!setting?.value) {
      res.json(null);
      return;
    }

    const [letter] = await db
      .select({
        id: letters.id,
        hook: letters.hook,
        summary: letters.summary,
        letterDate: letters.letterDate,
        sender: letters.sender,
        recipient: letters.recipient,
        collectionId: letters.collectionId,
        collectionCode: collections.collectionCode,
        collectionTitle: collections.title,
      })
      .from(letters)
      .leftJoin(collections, eq(letters.collectionId, collections.id))
      .where(eq(letters.id, setting.value))
      .limit(1);

    if (!letter || !letter.id) {
      res.json(null);
      return;
    }

    res.json(letter);
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch featured letter');
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
