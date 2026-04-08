import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  selectFromMock,
  selectWhereMock,
  selectGroupByMock,
  selectOrderByMock,
  selectLimitMock,
  selectOffsetMock,
  insertValuesMock,
  insertReturningMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  deleteWhereMock,
  deleteReturningMock,
} = vi.hoisted(() => ({
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectGroupByMock: vi.fn(),
  selectOrderByMock: vi.fn(),
  selectLimitMock: vi.fn(),
  selectOffsetMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  deleteReturningMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  desc: vi.fn((field: unknown) => ({ kind: 'desc', field })),
  count: vi.fn(() => ({ kind: 'count' })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ kind: 'inArray', field, values })),
  ilike: vi.fn((field: unknown, value: unknown) => ({ kind: 'ilike', field, value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ kind: 'gte', field, value })),
  lte: vi.fn((field: unknown, value: unknown) => ({ kind: 'lte', field, value })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: 'sql',
      strings: Array.from(strings),
      values,
    })),
    {
      raw: vi.fn((s: string) => ({ kind: 'sql.raw', value: s })),
    },
  ),
}));

vi.mock('../../../db/index.js', () => {
  // Each select() chain has to support: from(), where()/groupBy(), orderBy(), limit(), offset()
  // We make every link return a thenable-friendly object so awaiting at any depth works.
  const makeChain = () => {
    const chain = {
      where: selectWhereMock,
      groupBy: selectGroupByMock,
      orderBy: selectOrderByMock,
      limit: selectLimitMock,
      offset: selectOffsetMock,
      then: (resolve: (v: unknown) => unknown) => resolve([]),
    };
    return chain;
  };

  selectFromMock.mockImplementation(() => makeChain());
  selectWhereMock.mockImplementation(() => makeChain());
  selectGroupByMock.mockImplementation(() => makeChain());
  selectOrderByMock.mockImplementation(() => makeChain());
  selectLimitMock.mockImplementation(() => makeChain());
  selectOffsetMock.mockImplementation(() => makeChain());

  const dbSelect = vi.fn(() => ({ from: selectFromMock }));

  const dbInsert = vi.fn(() => ({ values: insertValuesMock }));
  insertValuesMock.mockImplementation(() => ({ returning: insertReturningMock }));

  const dbUpdate = vi.fn(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));

  const dbDelete = vi.fn(() => ({ where: deleteWhereMock }));
  deleteWhereMock.mockImplementation(() => ({ returning: deleteReturningMock }));

  return {
    db: {
      select: dbSelect,
      insert: dbInsert,
      update: dbUpdate,
      delete: dbDelete,
    },
    adminNotifications: {
      id: 'admin_notifications.id',
      type: 'admin_notifications.type',
      severity: 'admin_notifications.severity',
      status: 'admin_notifications.status',
      sourceType: 'admin_notifications.source_type',
      sourceId: 'admin_notifications.source_id',
      title: 'admin_notifications.title',
      message: 'admin_notifications.message',
      read: 'admin_notifications.read',
      createdAt: 'admin_notifications.created_at',
      expiresAt: 'admin_notifications.expires_at',
      dedupeKey: 'admin_notifications.dedupe_key',
    },
  };
});

import notificationsRouter from '../notifications.js';

describe('admin notifications routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /notifications/bulk-read', () => {
    it('rejects when ids is missing', async () => {
      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/bulk-read',
        path: '/notifications/bulk-read',
        body: {},
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects when ids is empty', async () => {
      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/bulk-read',
        path: '/notifications/bulk-read',
        body: { ids: [] },
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects non-uuid ids', async () => {
      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/bulk-read',
        path: '/notifications/bulk-read',
        body: { ids: ['not-a-uuid'] },
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('marks the provided ids as read', async () => {
      updateWhereMock.mockResolvedValueOnce(undefined);

      const ids = [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ];
      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/bulk-read',
        path: '/notifications/bulk-read',
        body: { ids },
        headers: { 'content-type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ success: true, count: 2 });
      expect(updateSetMock).toHaveBeenCalledWith({ read: true });
    });
  });

  describe('POST /notifications/bulk-resolve', () => {
    it('stamps resolved status, read=true, and resolvedAt', async () => {
      updateWhereMock.mockResolvedValueOnce(undefined);

      const ids = ['11111111-1111-1111-1111-111111111111'];
      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/bulk-resolve',
        path: '/notifications/bulk-resolve',
        body: { ids },
        headers: { 'content-type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ success: true, count: 1 });
      const setArg = updateSetMock.mock.calls[0][0];
      expect(setArg.status).toBe('resolved');
      expect(setArg.read).toBe(true);
      expect(setArg.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('POST /notifications/bulk-archive', () => {
    it('sets status=archived and read=true', async () => {
      updateWhereMock.mockResolvedValueOnce(undefined);

      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/bulk-archive',
        path: '/notifications/bulk-archive',
        body: { ids: ['11111111-1111-1111-1111-111111111111'] },
        headers: { 'content-type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      const setArg = updateSetMock.mock.calls[0][0];
      expect(setArg.status).toBe('archived');
      expect(setArg.read).toBe(true);
    });
  });

  describe('POST /notifications/bulk-delete', () => {
    it('deletes by id list', async () => {
      deleteWhereMock.mockResolvedValueOnce(undefined);

      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/bulk-delete',
        path: '/notifications/bulk-delete',
        body: { ids: ['11111111-1111-1111-1111-111111111111'] },
        headers: { 'content-type': 'application/json' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ success: true, count: 1 });
      expect(deleteWhereMock).toHaveBeenCalledWith({
        kind: 'inArray',
        field: 'admin_notifications.id',
        values: ['11111111-1111-1111-1111-111111111111'],
      });
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    it('returns 404 when no row is updated', async () => {
      updateReturningMock.mockResolvedValueOnce([]);

      const response = await invokeRouter(notificationsRouter, {
        method: 'PATCH',
        url: '/notifications/11111111-1111-1111-1111-111111111111/read',
        path: '/notifications/11111111-1111-1111-1111-111111111111/read',
        headers: {},
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns the updated row on success', async () => {
      const row = { id: 'abc', read: true };
      updateReturningMock.mockResolvedValueOnce([row]);

      const response = await invokeRouter(notificationsRouter, {
        method: 'PATCH',
        url: '/notifications/11111111-1111-1111-1111-111111111111/read',
        path: '/notifications/11111111-1111-1111-1111-111111111111/read',
        headers: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual(row);
    });
  });

  describe('POST /notifications/:id/resolve', () => {
    it('marks a notification as resolved with timestamp', async () => {
      updateReturningMock.mockResolvedValueOnce([{ id: 'abc', status: 'resolved' }]);

      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/11111111-1111-1111-1111-111111111111/resolve',
        path: '/notifications/11111111-1111-1111-1111-111111111111/resolve',
        headers: {},
      });

      expect(response.statusCode).toBe(200);
      const setArg = updateSetMock.mock.calls[0][0];
      expect(setArg.status).toBe('resolved');
      expect(setArg.read).toBe(true);
      expect(setArg.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('POST /notifications/cleanup', () => {
    it('returns the deleted count', async () => {
      deleteReturningMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

      const response = await invokeRouter(notificationsRouter, {
        method: 'POST',
        url: '/notifications/cleanup',
        path: '/notifications/cleanup',
        headers: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ success: true, deleted: 3 });
    });
  });
});
