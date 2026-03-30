import { Router } from 'express';
import { z } from 'zod';
import { eq, desc, and, sql } from 'drizzle-orm';
import { pickFeaturedLetter } from '../../services/pick-featured-letter.js';
import {
  db,
  updatePosts,
  contentPages,
  siteSettings,
  letters,
  collections,
} from '../../db/index.js';
import { validateBody } from '../../middleware/validate.js';
import { slugify } from '../../utils/slugify.js';

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const imageAssetSchema = z.union([
  z.string().url(),
  z.string().regex(/^\/[\w./-]+$/),
  z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+$/),
]);

const createBlogPostSchema = z.object({
  slug: z.string().optional(),
  title: z.string().min(1),
  excerpt: z.string().optional(),
  bodyMarkdown: z.string().default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  category: z.string().trim().min(1).max(60).optional().nullable(),
  authorDisplayName: z.string().optional().nullable(),
  authorRole: z.string().optional().nullable(),
  heroImageUrl: imageAssetSchema.optional().nullable(),
  heroImageAlt: z.string().optional().nullable(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  ctaLabel: z.string().optional().nullable(),
  ctaUrl: z.string().optional().nullable(),
  publishedAt: z.string().datetime().optional().nullable(),
});

const updateBlogPostSchema = z.object({
  slug: z.string().optional(),
  title: z.string().min(1).optional(),
  excerpt: z.string().optional().nullable(),
  bodyMarkdown: z.string().optional(),
  status: z.enum(['draft', 'published']).optional(),
  category: z.string().trim().min(1).max(60).optional().nullable(),
  authorDisplayName: z.string().optional().nullable(),
  authorRole: z.string().optional().nullable(),
  heroImageUrl: imageAssetSchema.optional().nullable(),
  heroImageAlt: z.string().optional().nullable(),
  seoTitle: z.string().optional().nullable(),
  seoDescription: z.string().optional().nullable(),
  ctaLabel: z.string().optional().nullable(),
  ctaUrl: z.string().optional().nullable(),
  publishedAt: z.string().datetime().optional().nullable(),
});

const updatePageSchema = z.object({
  title: z.string().min(1),
  contentJson: z.record(z.unknown()),
});

const featuredLetterSchema = z.object({
  letterId: z.string().uuid(),
});

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================================
// BLOG POSTS CRUD
// ============================================================================

// GET /content/blog — List all blog posts (all statuses)
router.get('/content/blog', async (req, res) => {
  try {
    const query = paginationSchema.parse(req.query);

    const [posts, [{ count: total }]] = await Promise.all([
      db
        .select()
        .from(updatePosts)
        .orderBy(desc(updatePosts.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(updatePosts),
    ]);

    res.json({ posts, total });
  } catch (error) {
    req.log?.error({ error }, 'Failed to list blog posts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /content/blog — Create new blog post
router.post('/content/blog', validateBody(createBlogPostSchema), async (req, res) => {
  try {
    const data = req.body as z.infer<typeof createBlogPostSchema>;

    const slug = data.slug || slugify(data.title);

    // Check slug uniqueness
    const existing = await db
      .select({ id: updatePosts.id })
      .from(updatePosts)
      .where(eq(updatePosts.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: 'A post with this slug already exists' });
      return;
    }

    const [post] = await db
      .insert(updatePosts)
      .values({
        slug,
        title: data.title,
        excerpt: data.excerpt,
        bodyMarkdown: data.bodyMarkdown,
        status: data.status,
        category: data.category ?? null,
        authorDisplayName: data.authorDisplayName ?? null,
        authorRole: data.authorRole ?? null,
        heroImageUrl: data.heroImageUrl ?? null,
        heroImageAlt: data.heroImageAlt ?? null,
        seoTitle: data.seoTitle ?? null,
        seoDescription: data.seoDescription ?? null,
        ctaLabel: data.ctaLabel ?? null,
        ctaUrl: data.ctaUrl ?? null,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : null,
      })
      .returning();

    req.log?.info({ postId: post.id, slug }, 'Blog post created');
    res.status(201).json(post);
  } catch (error) {
    req.log?.error({ error }, 'Failed to create blog post');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /content/blog/:id — Get single blog post by ID
router.get('/content/blog/:id', async (req, res) => {
  try {
    const id = req.params.id as string;

    const [post] = await db
      .select()
      .from(updatePosts)
      .where(eq(updatePosts.id, id))
      .limit(1);

    if (!post) {
      res.status(404).json({ error: 'Blog post not found' });
      return;
    }

    res.json(post);
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch blog post');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /content/blog/:id — Update blog post fields
router.put('/content/blog/:id', validateBody(updateBlogPostSchema), async (req, res) => {
  try {
    const id = req.params.id as string;
    const data = req.body as z.infer<typeof updateBlogPostSchema>;

    // Check post exists
    const [existing] = await db
      .select()
      .from(updatePosts)
      .where(eq(updatePosts.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Blog post not found' });
      return;
    }

    // If slug is being changed, check uniqueness
    if (data.slug && data.slug !== existing.slug) {
      const [slugConflict] = await db
        .select({ id: updatePosts.id })
        .from(updatePosts)
        .where(eq(updatePosts.slug, data.slug))
        .limit(1);

      if (slugConflict) {
        res.status(409).json({ error: 'A post with this slug already exists' });
        return;
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.slug !== undefined) updates.slug = data.slug;
    if (data.title !== undefined) updates.title = data.title;
    if (data.excerpt !== undefined) updates.excerpt = data.excerpt;
    if (data.bodyMarkdown !== undefined) updates.bodyMarkdown = data.bodyMarkdown;
    if (data.status !== undefined) updates.status = data.status;
    if (data.category !== undefined) updates.category = data.category;
    if (data.authorDisplayName !== undefined) updates.authorDisplayName = data.authorDisplayName;
    if (data.authorRole !== undefined) updates.authorRole = data.authorRole;
    if (data.heroImageUrl !== undefined) updates.heroImageUrl = data.heroImageUrl;
    if (data.heroImageAlt !== undefined) updates.heroImageAlt = data.heroImageAlt;
    if (data.seoTitle !== undefined) updates.seoTitle = data.seoTitle;
    if (data.seoDescription !== undefined) updates.seoDescription = data.seoDescription;
    if (data.ctaLabel !== undefined) updates.ctaLabel = data.ctaLabel;
    if (data.ctaUrl !== undefined) updates.ctaUrl = data.ctaUrl;
    if (data.publishedAt !== undefined) updates.publishedAt = data.publishedAt ? new Date(data.publishedAt) : null;

    const [updated] = await db
      .update(updatePosts)
      .set(updates)
      .where(eq(updatePosts.id, id))
      .returning();

    req.log?.info({ postId: id }, 'Blog post updated');
    res.json(updated);
  } catch (error) {
    req.log?.error({ error }, 'Failed to update blog post');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /content/blog/:id/publish — Publish a blog post
router.post('/content/blog/:id/publish', async (req, res) => {
  try {
    const id = req.params.id as string;

    const [existing] = await db
      .select()
      .from(updatePosts)
      .where(eq(updatePosts.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Blog post not found' });
      return;
    }

    if (!existing.bodyMarkdown.trim()) {
      res.status(400).json({ error: 'Add some body content before publishing.' });
      return;
    }

    const updates: Record<string, unknown> = {
      status: 'published',
      updatedAt: new Date(),
    };

    // Only set publishedAt if not already set
    if (!existing.publishedAt) {
      updates.publishedAt = new Date();
    }

    const [updated] = await db
      .update(updatePosts)
      .set(updates)
      .where(eq(updatePosts.id, id))
      .returning();

    req.log?.info({ postId: id }, 'Blog post published');
    res.json(updated);
  } catch (error) {
    req.log?.error({ error }, 'Failed to publish blog post');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /content/blog/:id/unpublish — Unpublish a blog post
router.post('/content/blog/:id/unpublish', async (req, res) => {
  try {
    const id = req.params.id as string;

    const [existing] = await db
      .select()
      .from(updatePosts)
      .where(eq(updatePosts.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Blog post not found' });
      return;
    }

    const [updated] = await db
      .update(updatePosts)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(updatePosts.id, id))
      .returning();

    req.log?.info({ postId: id }, 'Blog post unpublished');
    res.json(updated);
  } catch (error) {
    req.log?.error({ error }, 'Failed to unpublish blog post');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /content/blog/:id — Delete blog post (only drafts)
router.delete('/content/blog/:id', async (req, res) => {
  try {
    const id = req.params.id as string;

    const [existing] = await db
      .select()
      .from(updatePosts)
      .where(eq(updatePosts.id, id))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: 'Blog post not found' });
      return;
    }

    if (existing.status !== 'draft') {
      res.status(400).json({ error: 'Only draft posts can be deleted' });
      return;
    }

    await db.delete(updatePosts).where(eq(updatePosts.id, id));

    req.log?.info({ postId: id }, 'Blog post deleted');
    res.json({ success: true });
  } catch (error) {
    req.log?.error({ error }, 'Failed to delete blog post');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PAGES CRUD
// ============================================================================

// GET /content/pages — List all content pages
router.get('/content/pages', async (req, res) => {
  try {
    const pages = await db.select().from(contentPages);
    res.json(pages);
  } catch (error) {
    req.log?.error({ error }, 'Failed to list content pages');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /content/pages/:slug — Get single page by slug
router.get('/content/pages/:slug', async (req, res) => {
  try {
    const slug = req.params.slug as string;

    const [page] = await db
      .select()
      .from(contentPages)
      .where(eq(contentPages.slug, slug))
      .limit(1);

    if (!page) {
      res.status(404).json({ error: 'Content page not found' });
      return;
    }

    res.json(page);
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch content page');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /content/pages/:slug — Upsert page content
router.put('/content/pages/:slug', validateBody(updatePageSchema), async (req, res) => {
  try {
    const slug = req.params.slug as string;
    const data = req.body as z.infer<typeof updatePageSchema>;

    const [page] = await db
      .insert(contentPages)
      .values({
        slug,
        title: data.title,
        contentJson: data.contentJson,
        updatedAt: new Date(),
        updatedBy: req.user?.userId ?? null,
      })
      .onConflictDoUpdate({
        target: contentPages.slug,
        set: {
          title: data.title,
          contentJson: data.contentJson,
          updatedAt: new Date(),
          updatedBy: req.user?.userId ?? null,
        },
      })
      .returning();

    req.log?.info({ slug }, 'Content page upserted');
    res.json(page);
  } catch (error) {
    req.log?.error({ error }, 'Failed to upsert content page');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// FEATURED LETTER
// ============================================================================

// PUT /content/featured-letter — Set featured letter
router.put('/content/featured-letter', validateBody(featuredLetterSchema), async (req, res) => {
  try {
    const { letterId } = req.body as z.infer<typeof featuredLetterSchema>;

    // Validate letter exists and is published
    const [letter] = await db
      .select({
        id: letters.id,
        visibility: letters.visibility,
      })
      .from(letters)
      .where(eq(letters.id, letterId))
      .limit(1);

    if (!letter) {
      res.status(404).json({ error: 'Letter not found' });
      return;
    }

    if (letter.visibility !== 'PUBLISHED') {
      res.status(400).json({ error: 'Only published letters can be featured' });
      return;
    }

    // Upsert into site_settings
    await db
      .insert(siteSettings)
      .values({ key: 'featured_letter_id', value: letterId })
      .onConflictDoUpdate({
        target: siteSettings.key,
        set: { value: letterId, updatedAt: new Date() },
      });

    req.log?.info({ letterId }, 'Featured letter set');
    res.json({ success: true, letterId });
  } catch (error) {
    req.log?.error({ error }, 'Failed to set featured letter');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /content/featured-letter — Get current featured letter with full info
router.get('/content/featured-letter', async (req, res) => {
  try {
    // Helper: fetch full letter details including imageUrl
    const fetchLetterDetails = async (letterId: string) => {
      const rows = await db.execute(sql`
        SELECT
          l.id,
          l.hook,
          l.summary,
          l.letter_date AS "letterDate",
          l.date_raw AS "dateRaw",
          l.sender,
          l.recipient,
          l.visibility,
          l.type AS "imageType",
          c.collection_code AS "collectionCode",
          c.title AS "collectionTitle",
          CASE WHEN EXISTS (SELECT 1 FROM letter_pages lp WHERE lp.letter_id = l.id)
            THEN '/images/' || (
              SELECT lp2.id ||
                CASE WHEN lp2.checksum_sha256 IS NOT NULL
                  THEN '?v=' || LEFT(lp2.checksum_sha256, 8)
                  ELSE ''
                END
              FROM letter_pages lp2
              WHERE lp2.letter_id = l.id
              ORDER BY lp2.page_number
              LIMIT 1
            )
            ELSE NULL
          END AS "imageUrl"
        FROM letters l
        LEFT JOIN collections c ON c.id = l.collection_id
        WHERE l.id = ${letterId}
        LIMIT 1
      `);
      return (rows as unknown as any[])[0] ?? null;
    };

    // 1. Check manual override
    const [manualSetting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'featured_letter_id'))
      .limit(1);

    if (manualSetting?.value) {
      const letter = await fetchLetterDetails(manualSetting.value);
      if (letter?.id && letter.visibility === 'PUBLISHED') {
        res.json({ letter_id: manualSetting.value, letter, source: 'manual' });
        return;
      }
      // Stale — clear it
      await db.delete(siteSettings).where(eq(siteSettings.key, 'featured_letter_id'));
    }

    // 2. Check persisted auto-pick
    const [autoSetting] = await db
      .select()
      .from(siteSettings)
      .where(eq(siteSettings.key, 'auto_featured_letter_id'))
      .limit(1);

    if (autoSetting?.value) {
      const letter = await fetchLetterDetails(autoSetting.value);
      if (letter?.id && letter.visibility === 'PUBLISHED') {
        res.json({ letter_id: autoSetting.value, letter, source: 'auto' });
        return;
      }
      // Stale — clear it
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
      res.json({ letter_id: auto.id, letter: auto, source: 'auto' });
      return;
    }

    res.json({ letter_id: null, letter: null, source: 'none' });
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch featured letter');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /content/featured-letter — Clear manual override (reverts to auto)
router.delete('/content/featured-letter', async (req, res) => {
  try {
    // Clear both manual and auto so a fresh auto-pick happens on next request
    await db.delete(siteSettings).where(eq(siteSettings.key, 'featured_letter_id'));
    await db.delete(siteSettings).where(eq(siteSettings.key, 'auto_featured_letter_id'));
    req.log?.info('Featured letter override cleared');
    res.json({ success: true });
  } catch (error) {
    req.log?.error({ error }, 'Failed to clear featured letter');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
