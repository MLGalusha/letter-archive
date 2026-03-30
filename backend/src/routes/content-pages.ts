import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db, collections, contentPages, letters, siteSettings } from '../db/index.js';
import { pickFeaturedLetter } from '../services/pick-featured-letter.js';
import { resolveRepresentativeLetterId } from '../services/letters.js';

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
      const resolvedId = await resolveRepresentativeLetterId(manualSetting.value, { publishedOnly: true });
      const letter = resolvedId ? await fetchLetterDetails(resolvedId) : null;
      if (letter?.id && letter.visibility === 'PUBLISHED') {
        const normalizedId = resolvedId ?? letter.id;
        if (normalizedId !== manualSetting.value) {
          await db
            .insert(siteSettings)
            .values({ key: 'featured_letter_id', value: normalizedId })
            .onConflictDoUpdate({
              target: siteSettings.key,
              set: { value: normalizedId, updatedAt: new Date() },
            });
        }
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
      const resolvedId = await resolveRepresentativeLetterId(autoSetting.value, { publishedOnly: true });
      const letter = resolvedId ? await fetchLetterDetails(resolvedId) : null;
      if (letter?.id && letter.visibility === 'PUBLISHED') {
        const normalizedId = resolvedId ?? letter.id;
        if (normalizedId !== autoSetting.value) {
          await db
            .insert(siteSettings)
            .values({ key: 'auto_featured_letter_id', value: normalizedId })
            .onConflictDoUpdate({
              target: siteSettings.key,
              set: { value: normalizedId, updatedAt: new Date() },
            });
        }
        res.json({ ...letter, imageType: letter.type, source: 'auto' as const });
        return;
      }
      // Auto pick is stale — clear it so we re-pick below
      await db.delete(siteSettings).where(eq(siteSettings.key, 'auto_featured_letter_id'));
    }

    // 3. Auto-select and persist
    const auto = await pickFeaturedLetter();
    if (auto) {
      const resolvedId = await resolveRepresentativeLetterId(auto.id, { publishedOnly: true }) ?? auto.id;
      await db
        .insert(siteSettings)
        .values({ key: 'auto_featured_letter_id', value: resolvedId })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value: resolvedId, updatedAt: new Date() },
        });
      const resolvedLetter = await fetchLetterDetails(resolvedId);
      if (resolvedLetter?.id) {
        res.json({ ...resolvedLetter, imageType: resolvedLetter.type, source: 'auto' as const });
        return;
      }
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
