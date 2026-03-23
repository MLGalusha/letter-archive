import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { eq, count, and, isNull, gt } from 'drizzle-orm';
import { db, adminUsers, adminInvites } from '../db/index.js';
import { hashPassword, verifyPassword, generateToken } from '../auth/jwt.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { createNotification } from '../services/notifications.js';

const router = Router();

// ============================================================================
// Schemas
// ============================================================================

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const inviteSchema = z.object({
  email: z.string().email().optional(),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// ============================================================================
// POST /auth/login
// ============================================================================

router.post('/auth/login', validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  try {
    const [user] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    if (!user) {
      // Check if any admin users exist at all
      const [{ value: adminCount }] = await db.select({ value: count() }).from(adminUsers);
      if (adminCount === 0) {
        req.log?.info('Login attempt but no admin users exist yet');
        res.status(401).json({ error: 'No admin account exists. Please set up an admin account first.', code: 'NO_ADMIN_EXISTS' });
        return;
      }

      req.log?.warn({ email }, 'Login failed: user not found');
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      req.log?.warn({ email }, 'Login failed: invalid password');
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateToken(user.id, user.email);
    req.log?.info({ userId: user.id, email: user.email }, 'Admin login successful');

    res.json({ token, email: user.email });
  } catch (error) {
    req.log?.error({ error }, 'Login error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POST /auth/setup — One-time admin account creation
// ============================================================================

router.post('/auth/setup', validateBody(setupSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof setupSchema>;

  try {
    // Only allow setup if no admin users exist
    const [{ value: adminCount }] = await db.select({ value: count() }).from(adminUsers);
    if (adminCount > 0) {
      req.log?.warn({ email }, 'Setup attempted but admin user already exists');
      res.status(403).json({ error: 'Admin account already exists. Setup is disabled.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(adminUsers)
      .values({ email, passwordHash })
      .returning();

    const token = generateToken(user.id, user.email);
    req.log?.info({ userId: user.id, email: user.email }, 'Admin account created via setup');

    res.status(201).json({ token, email: user.email });
  } catch (error) {
    req.log?.error({ error }, 'Setup error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /auth/status — Check if any admin accounts exist (public, no auth)
// ============================================================================

router.get('/auth/status', async (req, res) => {
  try {
    const [{ value: adminCount }] = await db.select({ value: count() }).from(adminUsers);
    res.json({ hasAdmin: adminCount > 0 });
  } catch (error) {
    req.log?.error({ error }, 'Auth status check error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POST /auth/invite — Create an invite link (requires auth)
// ============================================================================

router.post('/auth/invite', requireAuth, validateBody(inviteSchema), async (req, res) => {
  const { email } = req.body as z.infer<typeof inviteSchema>;

  try {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invite] = await db
      .insert(adminInvites)
      .values({
        token,
        email: email || null,
        invitedBy: req.user!.userId,
        expiresAt,
      })
      .returning();

    req.log?.info({ inviteId: invite.id, email, invitedBy: req.user!.email }, 'Admin invite created');

    res.status(201).json({
      token: invite.token,
      expiresAt: invite.expiresAt,
      email: invite.email,
    });
  } catch (error) {
    req.log?.error({ error }, 'Invite creation error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// GET /auth/invite/:token — Validate an invite token (public, no auth)
// ============================================================================

router.get('/auth/invite/:token', async (req, res) => {
  try {
    const [invite] = await db
      .select()
      .from(adminInvites)
      .where(
        and(
          eq(adminInvites.token, req.params.token),
          isNull(adminInvites.usedBy),
          gt(adminInvites.expiresAt, new Date()),
        )
      )
      .limit(1);

    if (!invite) {
      res.status(404).json({ error: 'Invite not found, already used, or expired' });
      return;
    }

    res.json({ valid: true, email: invite.email });
  } catch (error) {
    req.log?.error({ error }, 'Invite validation error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// POST /auth/accept-invite — Accept invite and create admin account (public)
// ============================================================================

router.post('/auth/accept-invite', validateBody(acceptInviteSchema), async (req, res) => {
  const { token, email, password } = req.body as z.infer<typeof acceptInviteSchema>;

  try {
    // Find valid, unused, non-expired invite
    const [invite] = await db
      .select()
      .from(adminInvites)
      .where(
        and(
          eq(adminInvites.token, token),
          isNull(adminInvites.usedBy),
          gt(adminInvites.expiresAt, new Date()),
        )
      )
      .limit(1);

    if (!invite) {
      res.status(400).json({ error: 'Invite not found, already used, or expired' });
      return;
    }

    // If invite was scoped to a specific email, enforce it
    if (invite.email && invite.email !== email) {
      res.status(400).json({ error: 'Email does not match the invite' });
      return;
    }

    // Check if email already taken
    const [existing] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    // Create the admin user
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(adminUsers)
      .values({ email, passwordHash })
      .returning();

    // Mark invite as used
    await db
      .update(adminInvites)
      .set({ usedBy: user.id })
      .where(eq(adminInvites.id, invite.id));

    const authToken = generateToken(user.id, user.email);
    req.log?.info({ userId: user.id, email, inviteId: invite.id }, 'Admin account created via invite');

    // Notify existing admins about the new member
    createNotification({
      type: 'admin',
      title: 'New admin joined',
      message: `${email} accepted an invite`,
    });

    res.status(201).json({ token: authToken, email: user.email });
  } catch (error) {
    req.log?.error({ error }, 'Accept invite error');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
