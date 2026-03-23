import { Router } from 'express';
import { z } from 'zod';
import { eq, and, lte, desc, sql } from 'drizzle-orm';
import { db, updatePosts } from '../db/index.js';

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const listBlogPostsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.string().optional(),
});

// ============================================================================
// GET /blog — List published blog posts
// ============================================================================

router.get('/blog', async (req, res) => {
  try {
    const query = listBlogPostsSchema.parse(req.query);

    const conditions = [
      eq(updatePosts.status, 'published'),
      lte(updatePosts.publishedAt, new Date()),
    ];

    if (query.category) {
      conditions.push(eq(updatePosts.category, query.category));
    }

    const where = and(...conditions);

    const [posts, [{ count: total }]] = await Promise.all([
      db
        .select()
        .from(updatePosts)
        .where(where)
        .orderBy(desc(updatePosts.publishedAt))
        .limit(query.limit)
        .offset(query.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(updatePosts)
        .where(where),
    ]);

    res.json({ posts, total });
  } catch (error) {
    req.log?.error({ error }, 'Failed to list blog posts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /blog/:slug — Get single published blog post by slug
// ============================================================================

router.get('/blog/:slug', async (req, res) => {
  try {
    const slug = req.params.slug as string;

    const [post] = await db
      .select()
      .from(updatePosts)
      .where(
        and(
          eq(updatePosts.slug, slug),
          eq(updatePosts.status, 'published'),
        )
      )
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

export default router;
