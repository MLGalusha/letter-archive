import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  selectLimitMock,
  selectWhereMock,
  updateReturningMock,
  updateSetMock,
  updateWhereMock,
} = vi.hoisted(() => ({
  selectLimitMock: vi.fn(),
  selectWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
}));

vi.mock('../../db/index.js', () => {
  updateWhereMock.mockReturnValue({ returning: updateReturningMock });
  updateSetMock.mockReturnValue({ where: updateWhereMock });
  selectWhereMock.mockReturnValue({ limit: selectLimitMock });

  return {
    db: {
      update: vi.fn(() => ({ set: updateSetMock })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: selectWhereMock })),
      })),
    },
    workerState: {
      id: 'worker_state.id',
      lastTickAt: 'worker_state.last_tick_at',
      isPolling: 'worker_state.is_polling',
      lastError: 'worker_state.last_error',
      currentBatchSize: 'worker_state.current_batch_size',
      executionToken: 'worker_state.execution_token',
      executionLeaseExpiresAt: 'worker_state.execution_lease_expires_at',
      updatedAt: 'worker_state.updated_at',
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn() }),
}));

import {
  acquireWorkerExecutionLease,
  getWorkerState,
  hasActiveWorkerExecutionLease,
  publishWorkerState,
  releaseWorkerExecutionLease,
  renewWorkerExecutionLease,
} from '../worker-state.js';

describe('worker state database boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    selectWhereMock.mockReturnValue({ limit: selectLimitMock });
  });

  it('reports one atomic acquisition winner and initializes its report', async () => {
    updateReturningMock
      .mockResolvedValueOnce([{ id: 'singleton' }])
      .mockResolvedValueOnce([]);

    const acquired = await acquireWorkerExecutionLease();
    await expect(acquireWorkerExecutionLease()).resolves.toBeNull();

    expect(acquired?.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        executionToken: acquired?.token,
        isPolling: true,
        lastError: null,
        currentBatchSize: 0,
      }),
    );
  });

  it('maps conditional renew, publish, and exact-token release to booleans', async () => {
    updateReturningMock
      .mockResolvedValueOnce([{ id: 'singleton' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'singleton' }]);

    await expect(renewWorkerExecutionLease('execution-a')).resolves.toBe(true);
    await expect(publishWorkerState('execution-a', {
      lastError: 'failed',
      currentBatchSize: 2,
    })).resolves.toBe(false);
    await expect(releaseWorkerExecutionLease('execution-a')).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        isPolling: true,
        lastError: 'failed',
        currentBatchSize: 2,
      }),
    );
    expect(updateSetMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        executionToken: null,
        executionLeaseExpiresAt: null,
        isPolling: false,
        currentBatchSize: 0,
      }),
    );
  });

  it('reports active ownership only when the database-clock query finds a row', async () => {
    selectLimitMock
      .mockResolvedValueOnce([{ id: 'singleton' }])
      .mockResolvedValueOnce([]);

    await expect(hasActiveWorkerExecutionLease()).resolves.toBe(true);
    await expect(hasActiveWorkerExecutionLease()).resolves.toBe(false);
  });

  it('returns the public snapshot without ownership metadata', async () => {
    selectLimitMock.mockResolvedValue([{
      lastTickAt: new Date('2026-07-23T12:00:00.000Z'),
      isPolling: true,
      lastError: null,
      currentBatchSize: 3,
      updatedAt: new Date('2026-07-23T12:00:01.000Z'),
    }]);

    await expect(getWorkerState()).resolves.toEqual({
      lastTickAt: '2026-07-23T12:00:00.000Z',
      isPolling: true,
      lastError: null,
      currentBatchSize: 3,
      updatedAt: '2026-07-23T12:00:01.000Z',
    });
  });
});
