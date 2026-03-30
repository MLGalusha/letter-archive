import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { verifyToken, type JwtPayload } from '../auth/jwt.js';
import { adminUsers, db, type AdminUser } from '../db/index.js';

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      adminUser?: AdminUser;
    }
  }
}

/**
 * Middleware that requires a valid JWT Bearer token in the Authorization header.
 * On success, attaches the decoded user payload to `req.user`.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.log?.warn('Missing or malformed Authorization header');
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "
  const payload = verifyToken(token);

  if (!payload) {
    req.log?.warn('Invalid or expired JWT token');
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  try {
    const [adminUser] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, payload.userId))
      .limit(1);

    if (!adminUser) {
      req.log?.warn({ userId: payload.userId }, 'Authenticated admin user no longer exists');
      res.status(401).json({ error: 'Admin account no longer exists' });
      return;
    }

    req.user = payload;
    req.adminUser = adminUser;
    next();
  } catch (error) {
    req.log?.error({ error }, 'Failed to validate authenticated admin user');
    res.status(500).json({ error: 'Internal server error' });
  }
}
