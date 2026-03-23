import { Router } from 'express';
import { z } from 'zod';
import { eq, and, lte, desc, sql } from 'drizzle-orm';
import { db, updatePosts } from '../db/index.js';

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const listUpdatesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.string().optional(),
});

// ============================================================================
// GET /updates — List published updates
// ============================================================================

router.get('/updates', async (req, res) => {
  try {
    const query = listUpdatesSchema.parse(req.query);

    const conditions = [
      eq(updatePosts.status, 'published'),
      lte(updatePosts.publishedAt, new Date()),
    ];

    if (query.category) {
      conditions.push(eq(updatePosts.category, query.category));
    }

    const where = and(...conditions);

    const [updates, [{ count: total }]] = await Promise.all([
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

    res.json({ updates, total });
  } catch (error) {
    req.log?.error({ error }, 'Failed to list updates');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /updates/:slug — Get single published update by slug
// ============================================================================

router.get('/updates/:slug', async (req, res) => {
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
      res.status(404).json({ error: 'Update not found' });
      return;
    }

    res.json(post);
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch update');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
