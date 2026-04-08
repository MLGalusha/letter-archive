import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectFromMock,
  selectWhereMock,
  selectLimitMock,
  selectGroupByMock,
  deleteFromMock,
  deleteWhereMock,
  deleteReturningMock,
  notifyMock,
} = vi.hoisted(() => ({
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectLimitMock: vi.fn(),
  selectGroupByMock: vi.fn(),
  deleteFromMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  deleteReturningMock: vi.fn(),
  notifyMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  lt: vi.fn((field: unknown, value: unknown) => ({ kind: 'lt', field, value })),
  gte: vi.fn((field: unknown, value: unknown) => ({ kind: 'gte', field, value })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: Array.from(strings),
    values,
  })),
}));

vi.mock('../../db/index.js', () => {
  // Chain: db.select().from(...).where(...).limit(...)
  // Also: db.select().from(...).where(...).groupBy(...)
  // Also: db.select().from(...).where(...)  (direct await — resolves as list)
  const dbSelect = vi.fn(() => ({ from: selectFromMock }));
  selectFromMock.mockImplementation(() => ({
    where: selectWhereMock,
  }));
  selectWhereMock.mockImplementation(() => ({
    limit: selectLimitMock,
    groupBy: selectGroupByMock,
    // Awaiting the where() result directly (worker silent check) → empty by default
    then: (resolve: (v: unknown) => unknown) => resolve([]),
  }));

  const dbDelete = vi.fn(() => ({ where: deleteWhereMock }));
  deleteFromMock.mockImplementation(() => ({ where: deleteWhereMock }));
  deleteWhereMock.mockImplementation(() => ({ returning: deleteReturningMock }));

  return {
    db: {
      select: dbSelect,
      delete: dbDelete,
    },
    letters: {
      id: 'letters.id',
      transcriptionStatus: 'letters.transcription_status',
      metadataStatus: 'letters.metadata_status',
      entityExtractionStatus: 'letters.entity_extraction_status',
      updatedAt: 'letters.updated_at',
      deadLetter: 'letters.dead_letter',
    },
    adminNotifications: {
      id: 'admin_notifications.id',
      type: 'admin_notifications.type',
      createdAt: 'admin_notifications.created_at',
      expiresAt: 'admin_notifications.expires_at',
      status: 'admin_notifications.status',
    },
  };
});

vi.mock('../notifications.js', () => ({
  notify: notifyMock,
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import {
  checkStuckJobs,
  checkFailureRate,
  checkWorkerSilent,
  runRetentionSweep,
  runSweeperCycle,
} from '../notification-sweeper.js';

beforeEach(() => {
  vi.clearAllMocks();
  // Default empty results for all chains
  selectLimitMock.mockResolvedValue([]);
  selectGroupByMock.mockResolvedValue([]);
  selectWhereMock.mockImplementation(() => ({
    limit: selectLimitMock,
    groupBy: selectGroupByMock,
    then: (resolve: (v: unknown) => unknown) => resolve([]),
  }));
  deleteReturningMock.mockResolvedValue([]);
  notifyMock.mockResolvedValue({ id: 'n-1' });
});

describe('checkStuckJobs', () => {
  it('does nothing when no stuck jobs exist', async () => {
    selectLimitMock.mockResolvedValueOnce([]);
    await checkStuckJobs();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('fires a sweeper_stuck_jobs notification when stuck jobs exist', async () => {
    selectLimitMock.mockResolvedValueOnce([
      { id: 'letter-1', updatedAt: new Date('2025-01-01') },
      { id: 'letter-2', updatedAt: new Date('2025-01-01') },
    ]);
    await checkStuckJobs();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.type).toBe('sweeper_stuck_jobs');
    expect(arg.dedupeKey).toBe('sweeper_stuck_jobs');
    expect(arg.metadata.count).toBe(2);
    expect(arg.metadata.ids).toEqual(['letter-1', 'letter-2']);
  });
});

describe('checkFailureRate', () => {
  it('is a no-op when the sample size is below the minimum', async () => {
    selectGroupByMock.mockResolvedValueOnce([
      { type: 'transcription_failed', total: 2 },
      { type: 'transcription_success', total: 2 },
    ]);
    await checkFailureRate();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('is a no-op when the failure rate is below the threshold', async () => {
    selectGroupByMock.mockResolvedValueOnce([
      { type: 'transcription_failed', total: 1 },
      { type: 'transcription_success', total: 9 },
    ]);
    await checkFailureRate();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('fires a notification when rate ≥ 30% with enough samples', async () => {
    selectGroupByMock.mockResolvedValueOnce([
      { type: 'transcription_failed', total: 6 },
      { type: 'metadata_failed', total: 2 },
      { type: 'transcription_success', total: 4 },
      { type: 'metadata_success', total: 3 },
    ]);
    await checkFailureRate();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.type).toBe('sweeper_high_failure_rate');
    expect(arg.metadata.failed).toBe(8);
    expect(arg.metadata.succeeded).toBe(7);
    expect(arg.metadata.total).toBe(15);
  });
});

describe('checkWorkerSilent', () => {
  it('is a no-op when there are no pending jobs', async () => {
    // First .where() (pending count) → [{ value: 0 }]
    selectWhereMock.mockImplementationOnce(() => ({
      then: (resolve: (v: unknown) => unknown) => resolve([{ value: 0 }]),
    }));
    await checkWorkerSilent();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('is a no-op when pending jobs exist but a letter was touched recently', async () => {
    selectWhereMock
      .mockImplementationOnce(() => ({
        then: (resolve: (v: unknown) => unknown) => resolve([{ value: 3 }]),
      }))
      .mockImplementationOnce(() => ({
        then: (resolve: (v: unknown) => unknown) => resolve([{ value: 1 }]),
      }));
    await checkWorkerSilent();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('fires a critical notification when pending jobs + no recent updates', async () => {
    selectWhereMock
      .mockImplementationOnce(() => ({
        then: (resolve: (v: unknown) => unknown) => resolve([{ value: 5 }]),
      }))
      .mockImplementationOnce(() => ({
        then: (resolve: (v: unknown) => unknown) => resolve([{ value: 0 }]),
      }));
    await checkWorkerSilent();
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.type).toBe('system_worker_error');
    expect(arg.severity).toBe('critical');
    expect(arg.metadata.pendingCount).toBe(5);
  });
});

describe('runRetentionSweep', () => {
  it('returns 0 when nothing expires', async () => {
    deleteReturningMock.mockResolvedValueOnce([]);
    const count = await runRetentionSweep();
    expect(count).toBe(0);
  });

  it('returns the deleted row count', async () => {
    deleteReturningMock.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const count = await runRetentionSweep();
    expect(count).toBe(3);
  });
});

describe('runSweeperCycle', () => {
  it('runs every check even when an earlier one throws', async () => {
    // Make stuck_jobs throw by rejecting the limit call
    selectLimitMock.mockRejectedValueOnce(new Error('boom'));
    // Everything else resolves empty
    deleteReturningMock.mockResolvedValue([]);

    await runSweeperCycle();

    // Retention still ran → delete chain was invoked
    expect(deleteReturningMock).toHaveBeenCalled();
  });
});
