import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectFromMock,
  selectWhereMock,
  selectLimitMock,
  insertValuesMock,
  insertReturningMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
} = vi.hoisted(() => ({
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectLimitMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ kind: 'gte', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  const dbSelect = vi.fn(() => ({ from: selectFromMock }));
  selectFromMock.mockImplementation(() => ({ where: selectWhereMock }));
  selectWhereMock.mockImplementation(() => ({ limit: selectLimitMock }));

  const dbInsert = vi.fn(() => ({ values: insertValuesMock }));
  insertValuesMock.mockImplementation(() => ({ returning: insertReturningMock }));

  const dbUpdate = vi.fn(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));
  updateWhereMock.mockImplementation(() => ({ returning: updateReturningMock }));

  return {
    db: {
      select: dbSelect,
      insert: dbInsert,
      update: dbUpdate,
    },
    adminNotifications: {
      id: 'admin_notifications.id',
      dedupeKey: 'admin_notifications.dedupe_key',
      dedupeCount: 'admin_notifications.dedupe_count',
      lastOccurredAt: 'admin_notifications.last_occurred_at',
      status: 'admin_notifications.status',
      severity: 'admin_notifications.severity',
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { notify, notifyApiError, registerNotificationBroadcaster } from '../notifications.js';

describe('notify()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimitMock.mockResolvedValue([]); // no existing dedupe match by default
    insertReturningMock.mockResolvedValue([{ id: 'notif-1', severity: 'info' }]);
    updateReturningMock.mockResolvedValue([{ id: 'notif-1', severity: 'info' }]);
    registerNotificationBroadcaster(null);
  });

  it('inserts a fresh notification with the default severity for the type', async () => {
    const result = await notify({ type: 'transcription_failed', title: 'Boom' });

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const values = insertValuesMock.mock.calls[0][0];
    expect(values.type).toBe('transcription_failed');
    expect(values.severity).toBe('error'); // default for transcription_failed
    expect(values.status).toBe('open');
    expect(values.dedupeCount).toBe(1);
    expect(values.expiresAt).toBeInstanceOf(Date); // 180-day error expiry
    expect(result).toEqual({ id: 'notif-1', severity: 'info' });
  });

  it('respects an explicit severity override', async () => {
    await notify({ type: 'upload_success', severity: 'warn', title: 'Heads up' });
    const values = insertValuesMock.mock.calls[0][0];
    expect(values.severity).toBe('warn');
  });

  it('omits expiresAt for critical notifications by default', async () => {
    await notify({ type: 'system_worker_error', title: 'Worker dead' });
    const values = insertValuesMock.mock.calls[0][0];
    expect(values.severity).toBe('critical');
    expect(values.expiresAt).toBeNull();
  });

  it('honors expiresInDays: null override', async () => {
    await notify({ type: 'upload_success', title: 'Hi', expiresInDays: null });
    const values = insertValuesMock.mock.calls[0][0];
    expect(values.expiresAt).toBeNull();
  });

  it('dedupes by key when an open match exists in the window', async () => {
    selectLimitMock.mockResolvedValue([
      {
        id: 'existing-1',
        severity: 'warn',
        message: 'old',
        metadata: { previous: true },
      },
    ]);

    await notify({
      type: 'transcription_failed',
      title: 'Retry',
      message: 'new',
      metadata: { fresh: true },
      dedupeKey: 'transcription_failed:letter-1',
    });

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.message).toBe('new');
    expect(setArg.metadata).toEqual({ fresh: true });
    expect(setArg.read).toBe(false);
    // dedupe_count is bumped via sql template
    expect(setArg.dedupeCount).toMatchObject({ kind: 'sql' });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'eq',
      field: 'admin_notifications.id',
      value: 'existing-1',
    });
  });

  it('escalates severity in dedupe path when the new severity is higher', async () => {
    selectLimitMock.mockResolvedValue([
      { id: 'existing-1', severity: 'warn', message: null, metadata: null },
    ]);

    await notify({
      type: 'api_error',
      severity: 'critical',
      title: 'Quota',
      dedupeKey: 'api:openai',
    });

    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.severity).toBe('critical');
  });

  it('does NOT downgrade severity in dedupe path when the new severity is lower', async () => {
    selectLimitMock.mockResolvedValue([
      { id: 'existing-1', severity: 'critical', message: null, metadata: null },
    ]);

    await notify({
      type: 'api_error',
      severity: 'info',
      title: 'Recovered',
      dedupeKey: 'api:openai',
    });

    const setArg = updateSetMock.mock.calls[0][0];
    expect(setArg.severity).toBe('critical');
  });

  it('inserts a new row when no dedupe match is found in the window', async () => {
    selectLimitMock.mockResolvedValue([]); // no match

    await notify({
      type: 'transcription_failed',
      title: 'Boom',
      dedupeKey: 'transcription_failed:letter-99',
    });

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('returns null and swallows errors so callers never break', async () => {
    insertReturningMock.mockRejectedValueOnce(new Error('db down'));
    const result = await notify({ type: 'upload_success', title: 'Hi' });
    expect(result).toBeNull();
  });

  it('invokes the registered broadcaster on successful insert', async () => {
    const broadcaster = vi.fn();
    registerNotificationBroadcaster(broadcaster);

    await notify({ type: 'upload_success', title: 'Hi' });

    expect(broadcaster).toHaveBeenCalledTimes(1);
    expect(broadcaster).toHaveBeenCalledWith({ id: 'notif-1', severity: 'info' });
  });
});

describe('notifyApiError()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimitMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([{ id: 'notif-2' }]);
  });

  it('classifies a 429 as api_quota with critical severity', async () => {
    notifyApiError({
      service: 'openai',
      endpoint: 'transcription',
      error: Object.assign(new Error('Too many requests'), { status: 429 }),
    });
    // Allow the void notify() to flush
    await new Promise((r) => setImmediate(r));

    expect(insertValuesMock).toHaveBeenCalledTimes(1);
    const values = insertValuesMock.mock.calls[0][0];
    expect(values.type).toBe('api_quota');
    expect(values.severity).toBe('critical');
    expect(values.dedupeKey).toBe('api_quota:openai:transcription');
  });

  it('classifies a generic error as api_error with error severity', async () => {
    notifyApiError({
      service: 'openai',
      endpoint: 'metadata',
      error: new Error('Internal error'),
    });
    await new Promise((r) => setImmediate(r));

    const values = insertValuesMock.mock.calls[0][0];
    expect(values.type).toBe('api_error');
    expect(values.severity).toBe('error');
    expect(values.dedupeKey).toBe('api_error:openai:metadata');
  });

  it('matches "rate limit" in the error message even without a 429 status', async () => {
    notifyApiError({
      service: 'openai',
      endpoint: 'transcription',
      error: new Error('You exceeded the rate-limit for this org'),
    });
    await new Promise((r) => setImmediate(r));

    const values = insertValuesMock.mock.calls[0][0];
    expect(values.type).toBe('api_quota');
  });

  it('routes letterId to sourceType=letter', async () => {
    notifyApiError({
      service: 'openai',
      endpoint: 'transcription',
      error: new Error('boom'),
      letterId: 'letter-42',
    });
    await new Promise((r) => setImmediate(r));

    const values = insertValuesMock.mock.calls[0][0];
    expect(values.sourceType).toBe('letter');
    expect(values.sourceId).toBe('letter-42');
  });
});
