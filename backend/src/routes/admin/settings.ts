import { Router } from 'express';
import { z } from 'zod';
import { eq, and, or, isNull, gt, count, inArray, sql } from 'drizzle-orm';
import {
  db,
  siteSettings,
  adminInvites,
  adminUsers,
  letters,
  collections,
} from '../../db/index.js';
import { validateBody } from '../../middleware/validate.js';
import { hashPassword, verifyPassword } from '../../auth/jwt.js';
import { env, hasOpenAI } from '../../config/env.js';

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const updateSettingsSchema = z.record(z.string(), z.string());

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

// ============================================================================
// GET /settings — Return all site settings as { [key]: value }
// ============================================================================

router.get('/settings', async (req, res) => {
  try {
    const rows = await db.select().from(siteSettings);
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    res.json(result);
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch site settings');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// PUT /settings — Upsert site settings from { [key]: value } body
// ============================================================================

router.put('/settings', validateBody(updateSettingsSchema), async (req, res) => {
  const settings = req.body as Record<string, string>;

  try {
    const entries = Object.entries(settings);
    if (entries.length === 0) {
      res.status(400).json({ error: 'No settings provided' });
      return;
    }

    for (const [key, value] of entries) {
      await db
        .insert(siteSettings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: siteSettings.key,
          set: { value, updatedAt: new Date() },
        });
    }

    req.log?.info({ keys: entries.map(([k]) => k) }, 'Site settings updated');

    // Return the full settings map after update
    const rows = await db.select().from(siteSettings);
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    res.json(result);
  } catch (error) {
    req.log?.error({ error }, 'Failed to update site settings');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /settings/invites — List all invites with status
// ============================================================================

router.get('/settings/invites', async (req, res) => {
  try {
    const invites = await db
      .select({
        id: adminInvites.id,
        email: adminInvites.email,
        invitedBy: adminInvites.invitedBy,
        usedBy: adminInvites.usedBy,
        expiresAt: adminInvites.expiresAt,
        createdAt: adminInvites.createdAt,
      })
      .from(adminInvites)
      .orderBy(adminInvites.createdAt);

    const now = new Date();
    const result = invites.map((invite) => ({
      ...invite,
      status: invite.usedBy
        ? 'used'
        : new Date(invite.expiresAt) < now
          ? 'expired'
          : 'pending',
    }));

    res.json(result);
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch invites');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// DELETE /settings/invites/:id — Revoke (delete) a pending invite
// ============================================================================

router.delete('/settings/invites/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Only allow deleting pending (unused) invites
    const [invite] = await db
      .select()
      .from(adminInvites)
      .where(
        and(
          eq(adminInvites.id, id),
          isNull(adminInvites.usedBy),
        )
      )
      .limit(1);

    if (!invite) {
      res.status(404).json({ error: 'Pending invite not found' });
      return;
    }

    await db.delete(adminInvites).where(eq(adminInvites.id, id));

    req.log?.info({ inviteId: id }, 'Invite revoked');
    res.json({ success: true });
  } catch (error) {
    req.log?.error({ error }, 'Failed to revoke invite');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POST /settings/change-password — Change current user's password
// ============================================================================

router.post('/settings/change-password', validateBody(changePasswordSchema), async (req, res) => {
  const { oldPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;

  try {
    const [user] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, req.user!.userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const valid = await verifyPassword(oldPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db
      .update(adminUsers)
      .set({ passwordHash })
      .where(eq(adminUsers.id, user.id));

    req.log?.info({ userId: user.id }, 'Password changed');
    res.json({ success: true });
  } catch (error) {
    req.log?.error({ error }, 'Failed to change password');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /settings/system-info — Read-only system information
// ============================================================================

router.get('/settings/system-info', async (req, res) => {
  try {
    // Run all counts in parallel
    const [
      [{ value: letterCount }],
      [{ value: totalLetters }],
      [{ value: pendingQueue }],
      collectionRows,
    ] = await Promise.all([
      // Published letters
      db
        .select({ value: count() })
        .from(letters)
        .where(eq(letters.visibility, 'PUBLISHED')),
      // All letters
      db.select({ value: count() }).from(letters),
      // Pending or running jobs (transcription or metadata)
      db
        .select({ value: count() })
        .from(letters)
        .where(
          or(
            inArray(letters.transcriptionStatus, ['PENDING', 'RUNNING']),
            inArray(letters.metadataStatus, ['PENDING', 'RUNNING']),
          )
        ),
      // Collections that have at least one published letter
      db
        .select({ value: count() })
        .from(collections)
        .where(
          sql`EXISTS (
            SELECT 1 FROM letters
            WHERE letters.collection_id = collections.id
            AND letters.visibility = 'PUBLISHED'
          )`
        ),
    ]);

    res.json({
      openaiEnabled: hasOpenAI,
      corsOrigins: env.CORS_ORIGINS || 'http://localhost:5174',
      letterCount: Number(letterCount),
      totalLetters: Number(totalLetters),
      collectionCount: Number(collectionRows[0]?.value ?? 0),
      pendingQueue: Number(pendingQueue),
    });
  } catch (error) {
    req.log?.error({ error }, 'Failed to fetch system info');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
