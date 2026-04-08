import { Router, type Request } from 'express';
import { z } from 'zod';
import { eq, and, desc, count, sql, ilike, inArray, gte, lte, or } from 'drizzle-orm';
import { db, adminNotifications, letters, collections } from '../../db/index.js';
import { validateQuery, validateBody } from '../../middleware/validate.js';
import { issueStreamToken } from './notifications-stream.js';

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const csvList = (s: string | undefined): string[] | undefined =>
  s ? s.split(',').map(t => t.trim()).filter(Boolean) : undefined;

const SEVERITIES = ['info', 'warn', 'error', 'critical'] as const;
const STATUSES = ['open', 'acknowledged', 'resolved', 'archived'] as const;
const SOURCE_TYPES = ['letter', 'collection', 'job', 'admin', 'system'] as const;
const GROUP_BY = ['date', 'type', 'source', 'severity'] as const;

const listQuerySchema = z.object({
  type: z.string().optional().transform(csvList),
  severity: z.string().optional().transform(csvList),
  status: z.string().optional().transform(csvList),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceId: z.string().optional(),
  read: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  groupBy: z.enum(GROUP_BY).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

// ============================================================================
// Helpers
// ============================================================================

function buildConditions(q: z.infer<typeof listQuerySchema>) {
  const conditions = [];

  if (q.type && q.type.length > 0) {
    conditions.push(inArray(adminNotifications.type, q.type));
  }
  if (q.severity && q.severity.length > 0) {
    const valid = q.severity.filter((s): s is typeof SEVERITIES[number] =>
      (SEVERITIES as readonly string[]).includes(s),
    );
    if (valid.length > 0) {
      conditions.push(inArray(adminNotifications.severity, valid));
    }
  }
  if (q.status && q.status.length > 0) {
    const valid = q.status.filter((s): s is typeof STATUSES[number] =>
      (STATUSES as readonly string[]).includes(s),
    );
    if (valid.length > 0) {
      conditions.push(inArray(adminNotifications.status, valid));
    }
  }
  if (q.sourceType) {
    conditions.push(eq(adminNotifications.sourceType, q.sourceType));
  }
  if (q.sourceId) {
    conditions.push(eq(adminNotifications.sourceId, q.sourceId));
  }
  if (q.read !== undefined) {
    conditions.push(eq(adminNotifications.read, q.read));
  }
  if (q.from) {
    conditions.push(gte(adminNotifications.createdAt, new Date(q.from)));
  }
  if (q.to) {
    conditions.push(lte(adminNotifications.createdAt, new Date(q.to)));
  }
  if (q.search && q.search.trim()) {
    const escaped = q.search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
    const term = `%${escaped}%`;
    conditions.push(
      sql`(${ilike(adminNotifications.title, term)} OR ${ilike(adminNotifications.message, term)} OR ${ilike(adminNotifications.sourceId, term)})`,
    );
  }

  return conditions;
}

function actorEmailFromReq(req: Request): string | null {
  return req.user?.email ?? null;
}

// ============================================================================
// Source enrichment
//
// Notifications store sourceType + sourceId (e.g. letter UUIDs). Raw UUIDs are
// useless to humans, so for letter-typed rows we look up the letter's date +
// collection code and decorate each row with a `sourceLabel` like:
//   "014 · 1864-03-15"
// Frontend renders that instead of `letter: ba169fc0-...`.
// ============================================================================

interface EnrichableRow {
  id: string;
  sourceType: string | null;
  sourceId: string | null;
  [key: string]: unknown;
}

/**
 * Builds the human-readable source label for a letter notification.
 * Exported for unit testing.
 */
export function formatLetterLabel(
  collectionCode: string | null,
  letterDate: string | null,
  dateRaw: string | null,
): string {
  const parts: string[] = [];
  if (collectionCode) parts.push(collectionCode);
  // Prefer parsed letterDate (ISO), fall back to dateRaw (filename token)
  const date = letterDate ?? dateRaw;
  if (date) parts.push(date);
  return parts.length > 0 ? parts.join(' · ') : '';
}

async function enrichWithSourceLabels<T extends EnrichableRow>(rows: T[]): Promise<T[]> {
  const letterIds = Array.from(
    new Set(
      rows
        .filter((r) => r.sourceType === 'letter' && r.sourceId)
        .map((r) => r.sourceId as string),
    ),
  );
  if (letterIds.length === 0) return rows;

  const letterRows = await db
    .select({
      id: letters.id,
      letterDate: letters.letterDate,
      dateRaw: letters.dateRaw,
      collectionCode: collections.collectionCode,
    })
    .from(letters)
    .leftJoin(collections, eq(letters.collectionId, collections.id))
    .where(inArray(letters.id, letterIds));

  const labels = new Map<string, string>();
  for (const l of letterRows) {
    labels.set(l.id, formatLetterLabel(l.collectionCode, l.letterDate, l.dateRaw));
  }

  return rows.map((r) =>
    r.sourceType === 'letter' && r.sourceId && labels.has(r.sourceId)
      ? { ...r, sourceLabel: labels.get(r.sourceId) }
      : r,
  );
}

// ============================================================================
// GET /notifications — List with filters
// ============================================================================

router.get('/notifications', validateQuery(listQuerySchema), async (req, res) => {
  try {
    const q = req.query as unknown as z.infer<typeof listQuerySchema>;
    const conditions = buildConditions(q);
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [notifications, [{ value: total }], [{ value: unreadCount }]] = await Promise.all([
      db
        .select()
        .from(adminNotifications)
        .where(whereClause)
        .orderBy(
          // Higher severity first within the same window, then most recent
          sql`CASE ${adminNotifications.severity}
                WHEN 'critical' THEN 0
                WHEN 'error' THEN 1
                WHEN 'warn' THEN 2
                WHEN 'info' THEN 3
                ELSE 4
              END`,
          desc(adminNotifications.createdAt),
        )
        .limit(q.limit)
        .offset(q.offset),
      db.select({ value: count() }).from(adminNotifications).where(whereClause),
      db
        .select({ value: count() })
        .from(adminNotifications)
        .where(eq(adminNotifications.read, false)),
    ]);

    const enriched = await enrichWithSourceLabels(notifications as EnrichableRow[]);

    res.json({
      notifications: enriched,
      total: Number(total),
      unreadCount: Number(unreadCount),
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to list notifications');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /notifications/counts — Counts for filter chips
// ============================================================================

router.get('/notifications/counts', async (req, res) => {
  try {
    const [bySeverity, byStatus, unreadRow, totalRow] = await Promise.all([
      db
        .select({
          severity: adminNotifications.severity,
          value: count(),
        })
        .from(adminNotifications)
        .where(eq(adminNotifications.status, 'open'))
        .groupBy(adminNotifications.severity),
      db
        .select({
          status: adminNotifications.status,
          value: count(),
        })
        .from(adminNotifications)
        .groupBy(adminNotifications.status),
      db
        .select({ value: count() })
        .from(adminNotifications)
        .where(eq(adminNotifications.read, false)),
      db.select({ value: count() }).from(adminNotifications),
    ]);

    const severity: Record<string, number> = { info: 0, warn: 0, error: 0, critical: 0 };
    for (const row of bySeverity) {
      severity[row.severity] = Number(row.value);
    }

    const status: Record<string, number> = {
      open: 0,
      acknowledged: 0,
      resolved: 0,
      archived: 0,
    };
    for (const row of byStatus) {
      status[row.status] = Number(row.value);
    }

    res.json({
      total: Number(totalRow[0]?.value ?? 0),
      unread: Number(unreadRow[0]?.value ?? 0),
      bySeverity: severity,
      byStatus: status,
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to get notification counts');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /notifications/unread-count — Fast unread badge count + max severity
// ============================================================================

router.get('/notifications/unread-count', async (req, res) => {
  try {
    const [totalRow, severityRows] = await Promise.all([
      db
        .select({ value: count() })
        .from(adminNotifications)
        .where(eq(adminNotifications.read, false)),
      db
        .select({ severity: adminNotifications.severity, value: count() })
        .from(adminNotifications)
        .where(eq(adminNotifications.read, false))
        .groupBy(adminNotifications.severity),
    ]);

    const bySeverity: Record<string, number> = { info: 0, warn: 0, error: 0, critical: 0 };
    for (const row of severityRows) {
      bySeverity[row.severity] = Number(row.value);
    }

    // Highest severity wins for the bell color
    const maxSeverity = bySeverity.critical > 0
      ? 'critical'
      : bySeverity.error > 0
        ? 'error'
        : bySeverity.warn > 0
          ? 'warn'
          : bySeverity.info > 0
            ? 'info'
            : null;

    res.json({
      count: Number(totalRow[0]?.value ?? 0),
      bySeverity,
      maxSeverity,
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to get unread count');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /notifications/recent — Bell hover preview (5 most recent unread)
// ============================================================================

router.get('/notifications/recent', async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(adminNotifications)
      .where(eq(adminNotifications.read, false))
      .orderBy(
        sql`CASE ${adminNotifications.severity}
              WHEN 'critical' THEN 0
              WHEN 'error' THEN 1
              WHEN 'warn' THEN 2
              WHEN 'info' THEN 3
              ELSE 4
            END`,
        desc(adminNotifications.createdAt),
      )
      .limit(5);

    const enriched = await enrichWithSourceLabels(rows as EnrichableRow[]);
    res.json({ notifications: enriched });
  } catch (error) {
    req.log?.error({ error }, 'Failed to get recent notifications');
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
// POST /notifications/:id/resolve — Single resolve
// ============================================================================

router.post('/notifications/:id/resolve', async (req, res) => {
  const { id } = req.params;
  const actor = actorEmailFromReq(req);

  try {
    const [updated] = await db
      .update(adminNotifications)
      .set({
        status: 'resolved',
        read: true,
        resolvedAt: new Date(),
        resolvedBy: actor,
      })
      .where(eq(adminNotifications.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    req.log?.error({ error }, 'Failed to resolve notification');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POST /notifications/:id/archive — Single archive
// ============================================================================

router.post('/notifications/:id/archive', async (req, res) => {
  const { id } = req.params;

  try {
    const [updated] = await db
      .update(adminNotifications)
      .set({ status: 'archived', read: true })
      .where(eq(adminNotifications.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    res.json(updated);
  } catch (error) {
    req.log?.error({ error }, 'Failed to archive notification');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// Bulk action routes
// ============================================================================

router.post('/notifications/bulk-read', validateBody(idsBodySchema), async (req, res) => {
  try {
    const { ids } = req.body as z.infer<typeof idsBodySchema>;
    await db
      .update(adminNotifications)
      .set({ read: true })
      .where(inArray(adminNotifications.id, ids));
    res.json({ success: true, count: ids.length });
  } catch (error) {
    req.log?.error({ error }, 'Failed to bulk-mark notifications read');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/notifications/bulk-resolve', validateBody(idsBodySchema), async (req, res) => {
  try {
    const { ids } = req.body as z.infer<typeof idsBodySchema>;
    const actor = actorEmailFromReq(req);
    await db
      .update(adminNotifications)
      .set({
        status: 'resolved',
        read: true,
        resolvedAt: new Date(),
        resolvedBy: actor,
      })
      .where(inArray(adminNotifications.id, ids));
    res.json({ success: true, count: ids.length });
  } catch (error) {
    req.log?.error({ error }, 'Failed to bulk-resolve notifications');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/notifications/bulk-archive', validateBody(idsBodySchema), async (req, res) => {
  try {
    const { ids } = req.body as z.infer<typeof idsBodySchema>;
    await db
      .update(adminNotifications)
      .set({ status: 'archived', read: true })
      .where(inArray(adminNotifications.id, ids));
    res.json({ success: true, count: ids.length });
  } catch (error) {
    req.log?.error({ error }, 'Failed to bulk-archive notifications');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/notifications/bulk-delete', validateBody(idsBodySchema), async (req, res) => {
  try {
    const { ids } = req.body as z.infer<typeof idsBodySchema>;
    await db.delete(adminNotifications).where(inArray(adminNotifications.id, ids));
    res.json({ success: true, count: ids.length });
  } catch (error) {
    req.log?.error({ error }, 'Failed to bulk-delete notifications');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POST /notifications/stream-token — Issue a short-lived SSE stream token
// ============================================================================

router.post('/notifications/stream-token', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const { token, expiresAt } = issueStreamToken(req.user.userId, req.user.email);
  res.json({ token, expiresAt });
});

// ============================================================================
// POST /notifications/cleanup — Manual retention sweep
// ============================================================================

router.post('/notifications/cleanup', async (req, res) => {
  try {
    const result = await db
      .delete(adminNotifications)
      .where(
        and(
          sql`${adminNotifications.expiresAt} IS NOT NULL`,
          sql`${adminNotifications.expiresAt} < now()`,
          // Never delete archived notifications via the auto-cleanup
          or(
            eq(adminNotifications.status, 'open'),
            eq(adminNotifications.status, 'acknowledged'),
            eq(adminNotifications.status, 'resolved'),
          ),
        ),
      )
      .returning({ id: adminNotifications.id });

    res.json({ success: true, deleted: result.length });
  } catch (error) {
    req.log?.error({ error }, 'Failed to clean up notifications');
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
