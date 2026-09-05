import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, collections, contentPages, letters, siteSettings } from '../db/index.js';
import { pickFeaturedLetter } from '../services/pick-featured-letter.js';
import { resolveRepresentativeLetterId } from '../services/letters.js';
import { resolveFeaturedSetting } from '../services/featured-setting.js';
import { publicFieldSql } from '../services/public-read-model.js';
import { publicCatalogueLetterTypeSql } from '../services/public-catalogue-unit.js';

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
          imageUrl: sql<string | null>`(
            SELECT '/images/' || preview.id::text ||
              CASE WHEN preview.checksum_sha256 IS NOT NULL
                THEN '?v=' || LEFT(preview.checksum_sha256, 8) ELSE '' END
            FROM letter_pages preview
            WHERE preview.letter_id = ${letters.id}
            ORDER BY preview.page_number ASC
            LIMIT 1
          )`,
          hook: sql`CASE
            WHEN ${letters.metadataPublished} THEN ${letters.hook}
            WHEN ${letters.type} = 'P'
              AND ${letters.photoDescriptionStatus} = 'VERIFIED'
              AND NOT EXISTS (
              SELECT 1
              FROM letters featured_peer
              WHERE featured_peer.collection_id = ${letters.collectionId}
                AND featured_peer.date_raw = ${letters.dateRaw}
                AND featured_peer.type_sequence = ${letters.typeSequence}
                AND featured_peer.visibility = 'PUBLISHED'
                AND featured_peer.type <> 'P'
            ) THEN ${letters.photoDescription}
            ELSE NULL
          END`,
          summary: publicFieldSql(letters.metadataPublished, letters.summary),
          letterDate: letters.letterDate,
          dateRaw: letters.dateRaw,
          sender: publicFieldSql(letters.metadataPublished, letters.sender),
          recipient: publicFieldSql(letters.metadataPublished, letters.recipient),
          collectionId: letters.collectionId,
          collectionCode: collections.collectionCode,
          collectionTitle: collections.title,
          type: letters.type,
        })
        .from(letters)
        .leftJoin(collections, eq(letters.collectionId, collections.id))
        .where(and(
          eq(letters.id, letterId),
          eq(letters.visibility, 'PUBLISHED'),
          publicCatalogueLetterTypeSql(letters.type),
        ))
        .limit(1);
      return letter ?? null;
    };

    // 1. Check for manual override
    const manual = await resolveFeaturedSetting('featured_letter_id', fetchLetterDetails);
    if (manual) {
      res.json({ ...manual.letter, imageType: manual.letter.type, source: 'manual' as const });
      return;
    }

    // 2. Check for persisted auto-pick
    const persistedAuto = await resolveFeaturedSetting(
      'auto_featured_letter_id',
      fetchLetterDetails,
    );
    if (persistedAuto) {
      res.json({
        ...persistedAuto.letter,
        imageType: persistedAuto.letter.type,
        source: 'auto' as const,
      });
      return;
    }

    // 3. Auto-select and persist
    const auto = await pickFeaturedLetter();
    if (auto) {
      const resolvedId = await resolveRepresentativeLetterId(auto.id, { publishedOnly: true });
      if (!resolvedId) {
        res.json(null);
        return;
      }

      const resolvedLetter = await fetchLetterDetails(resolvedId);
      if (!resolvedLetter?.id) {
        res.json(null);
        return;
      }

      await db
        .insert(siteSettings)
        .values({ key: 'auto_featured_letter_id', value: resolvedId })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value: resolvedId, updatedAt: new Date() },
        });
      res.json({ ...resolvedLetter, imageType: resolvedLetter.type, source: 'auto' as const });
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
      .select({
        slug: contentPages.slug,
        title: contentPages.title,
        contentJson: contentPages.contentJson,
        updatedAt: contentPages.updatedAt,
      })
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
