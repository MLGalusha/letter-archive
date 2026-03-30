import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, collections, contentPages, letters, siteSettings } from '../db/index.js';
import { pickFeaturedLetter } from '../services/pick-featured-letter.js';

const router = Router();

// ============================================================================
// GET /content/featured-letter — Get public featured letter
// ============================================================================

router.get('/content/featured-letter', async (req, res) => {
  try {
    // Helper: fetch full letter details for the featured letter response
    const fetchLetterDetails = async (letterId: string) => {
      const [letter] = await db
        .select({
          id: letters.id,
          hook: letters.hook,
          summary: letters.summary,
          letterDate: letters.letterDate,
          dateRaw: letters.dateRaw,
          sender: letters.sender,
          recipient: letters.recipient,
          visibility: letters.visibility,
          collectionId: letters.collectionId,
          collectionCode: collections.collectionCode,
          collectionTitle: collections.title,
          type: letters.type,
        })
        .from(letters)
        .leftJoin(collections, eq(letters.collectionId, collections.id))
        .where(eq(letters.id, letterId))
        .limit(1);
      return letter ?? null;
    };

    // 1. Check for manual override
    const [manualSetting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'featured_letter_id'))
      .limit(1);

    if (manualSetting?.value) {
      const letter = await fetchLetterDetails(manualSetting.value);
      if (letter?.id && letter.visibility === 'PUBLISHED') {
        res.json({ ...letter, imageType: letter.type, source: 'manual' as const });
        return;
      }
      // Manual pick is stale (unpublished/deleted) — clear it
      await db.delete(siteSettings).where(eq(siteSettings.key, 'featured_letter_id'));
    }

    // 2. Check for persisted auto-pick
    const [autoSetting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'auto_featured_letter_id'))
      .limit(1);

    if (autoSetting?.value) {
      const letter = await fetchLetterDetails(autoSetting.value);
      if (letter?.id && letter.visibility === 'PUBLISHED') {
        res.json({ ...letter, imageType: letter.type, source: 'auto' as const });
        return;
      }
      // Auto pick is stale — clear it so we re-pick below
      await db.delete(siteSettings).where(eq(siteSettings.key, 'auto_featured_letter_id'));
    }

    // 3. Auto-select and persist
    const auto = await pickFeaturedLetter();
    if (auto) {
      await db
        .insert(siteSettings)
        .values({ key: 'auto_featured_letter_id', value: auto.id })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value: auto.id, updatedAt: new Date() },
        });
      res.json({ ...auto, source: 'auto' as const });
      return;
    }

    res.json(null);
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
