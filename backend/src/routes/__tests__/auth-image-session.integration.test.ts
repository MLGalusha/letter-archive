import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  selectMock,
  verifyPasswordMock,
  generateTokenMock,
  verifyTokenMock,
  generateImageSessionTokenMock,
} = vi.hoisted(() => ({
  selectMock: vi.fn(),
  verifyPasswordMock: vi.fn(),
  generateTokenMock: vi.fn(),
  verifyTokenMock: vi.fn(),
  generateImageSessionTokenMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
  count: vi.fn(() => 'count'),
  and: vi.fn((...conditions) => conditions),
  isNull: vi.fn((value) => ({ isNull: value })),
  gt: vi.fn((left, right) => ({ left, right })),
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: selectMock,
  },
  adminUsers: {
    id: 'adminUsers.id',
    email: 'adminUsers.email',
  },
  adminInvites: {},
}));

vi.mock('../../auth/jwt.js', () => ({
  hashPassword: vi.fn(),
  verifyPassword: verifyPasswordMock,
  generateToken: generateTokenMock,
  verifyToken: verifyTokenMock,
  generateImageSessionToken: generateImageSessionTokenMock,
}));

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = {
      userId: 'admin-1',
      email: 'admin@example.test',
      exp: 2_000_000_000,
    };
    next();
  },
}));

vi.mock('../../middleware/rate-limit.js', () => ({
  authRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../services/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../../services/admin-invites.js', () => ({
  ADMIN_INVITE_TTL_MS: 86_400_000,
  cleanupStaleAdminInvites: vi.fn(),
  createAdminInviteExpiryDate: vi.fn(),
  staleAdminInvitesWhereClause: vi.fn(),
}));

vi.mock('../../services/admin-ownership.js', () => ({
  isOwnerAdminEmail: vi.fn(() => false),
}));

import authRouter from '../auth.js';

describe('auth image-session integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPasswordMock.mockResolvedValue(true);
    generateTokenMock.mockReturnValue('reusable-api-bearer');
    verifyTokenMock.mockReturnValue({
      userId: 'admin-1',
      email: 'admin@example.test',
      exp: 2_000_000_000,
    });
    generateImageSessionTokenMock.mockReturnValue('purpose-bound-image-token');
    selectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{
            id: 'admin-1',
            email: 'admin@example.test',
            passwordHash: 'password-hash',
          }]),
        }),
      }),
    });
  });

  it('issues the image cookie alongside a successful API login', async () => {
    const response = await invokeRouter(authRouter, {
      method: 'POST',
      url: '/auth/login',
      path: '/auth/login',
      body: {
        email: 'admin@example.test',
        password: 'valid-password',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      token: 'reusable-api-bearer',
      email: 'admin@example.test',
    });
    expect(generateImageSessionTokenMock).toHaveBeenCalledWith(
      'admin-1',
      'admin@example.test',
      2_000_000_000,
    );
    expect(response.headers['set-cookie']).toContain(
      'letter_archive_image_session=purpose-bound-image-token',
    );
    expect(response.headers['set-cookie']).not.toContain('reusable-api-bearer');
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('lets an existing bearer establish the image cookie without returning it', async () => {
    const response = await invokeRouter(authRouter, {
      method: 'POST',
      url: '/auth/image-session',
      path: '/auth/image-session',
      headers: { authorization: 'Bearer reusable-api-bearer' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain(
      'letter_archive_image_session=purpose-bound-image-token',
    );
    expect(response.body).toBeUndefined();
  });

  it('expires the HttpOnly image cookie on logout', async () => {
    const response = await invokeRouter(authRouter, {
      method: 'DELETE',
      url: '/auth/image-session',
      path: '/auth/image-session',
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['set-cookie']).toContain(
      'letter_archive_image_session=',
    );
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
    expect(response.headers['set-cookie']).toContain('Path=/images');
  });
});
