import { Router } from 'express';
import { z } from 'zod';
import { eq, and, desc, count, sql, ilike } from 'drizzle-orm';
import { db, adminNotifications } from '../../db/index.js';
import { validateQuery } from '../../middleware/validate.js';

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const listQuerySchema = z.object({
  type: z.string().optional(),
  read: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ============================================================================
// GET /notifications — List notifications with filters
// ============================================================================

router.get('/notifications', validateQuery(listQuerySchema), async (req, res) => {
  try {
    const { type, read, search, limit, offset } = req.query as unknown as z.infer<typeof listQuerySchema>;

    const conditions: ReturnType<typeof eq>[] = [];

    if (type) {
      conditions.push(eq(adminNotifications.type, type));
    }
    if (read !== undefined) {
      conditions.push(eq(adminNotifications.read, read));
    }
    if (search && search.trim()) {
      const escaped = search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
      const term = `%${escaped}%`;
      conditions.push(
        sql`(${ilike(adminNotifications.title, term)} OR ${ilike(adminNotifications.message, term)})`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [notifications, [{ value: total }], [{ value: unreadCount }]] = await Promise.all([
      db
        .select()
        .from(adminNotifications)
        .where(whereClause)
        .orderBy(desc(adminNotifications.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ value: count() })
        .from(adminNotifications)
        .where(whereClause),
      db
        .select({ value: count() })
        .from(adminNotifications)
        .where(eq(adminNotifications.read, false)),
    ]);

    res.json({
      notifications,
      total: Number(total),
      unreadCount: Number(unreadCount),
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to list notifications');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /notifications/unread-count — Fast unread badge count
// ============================================================================

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const [{ value }] = await db
      .select({ value: count() })
      .from(adminNotifications)
      .where(eq(adminNotifications.read, false));

    res.json({ count: Number(value) });
  } catch (error) {
    req.log?.error({ error }, 'Failed to get unread count');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PATCH /notifications/:id/read — Mark single notification as read
// ============================================================================

router.patch('/notifications/:id/read', async (req, res) => {
  const { id } = req.params;

  try {
    const [updated] = await db
      .update(adminNotifications)
      .set({ read: true })
      .where(eq(adminNotifications.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    req.log?.error({ error }, 'Failed to mark notification as read');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POST /notifications/read-all — Mark all notifications as read
// ============================================================================

router.post('/notifications/read-all', async (req, res) => {
  try {
    await db
      .update(adminNotifications)
      .set({ read: true })
      .where(eq(adminNotifications.read, false));

    res.json({ success: true });
  } catch (error) {
    req.log?.error({ error }, 'Failed to mark all notifications as read');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// DELETE /notifications/:id — Delete a single notification
// ============================================================================

router.delete('/notifications/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [deleted] = await db
      .delete(adminNotifications)
      .where(eq(adminNotifications.id, id))
      .returning();

    if (!deleted) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    req.log?.error({ error }, 'Failed to delete notification');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
