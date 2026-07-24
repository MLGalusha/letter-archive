import { describe, expect, it, vi } from 'vitest';

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    warn: loggerWarnMock,
  }),
}));

import {
  WORKER_EXECUTION_LEASE_MS,
  createWorkerStatePublisher,
  type WorkerStateUpdate,
} from '../worker-state.js';

describe('worker state publisher', () => {
  it('uses a two-minute execution lease', () => {
    expect(WORKER_EXECUTION_LEASE_MS).toBe(120_000);
  });

  it('settles accepted reports before one terminal release and rejects later reports', async () => {
    let finishReport!: () => void;
    const reportBlocked = new Promise<void>((resolve) => {
      finishReport = resolve;
    });
    const writes: string[] = [];
    const writeBestEffort = vi.fn(async (
      token: string,
      update: WorkerStateUpdate,
    ) => {
      writes.push(`report-start:${token}:${update.currentBatchSize}`);
      await reportBlocked;
      writes.push(`report-end:${token}:${update.currentBatchSize}`);
      return true;
    });
    const writeRelease = vi.fn(async (
      token: string,
      update: WorkerStateUpdate,
    ) => {
      writes.push(`release:${token}:${update.currentBatchSize}`);
      return true;
    });
    const publisher = createWorkerStatePublisher('execution-a', {
      writeBestEffort,
      writeRelease,
    });

    publisher.publish({ currentBatchSize: 3 });
    await vi.waitFor(() => expect(writeBestEffort).toHaveBeenCalledTimes(1));

    const releasing = publisher.release({ currentBatchSize: 0 });
    const repeatedRelease = publisher.release({ currentBatchSize: 9 });
    publisher.publish({ currentBatchSize: 4 });
    expect(writeRelease).not.toHaveBeenCalled();

    finishReport();
    await expect(Promise.all([releasing, repeatedRelease])).resolves.toEqual([
      true,
      true,
    ]);

    expect(writes).toEqual([
      'report-start:execution-a:3',
      'report-end:execution-a:3',
      'release:execution-a:0',
    ]);
    expect(releasing).toBe(repeatedRelease);
    expect(writeBestEffort).toHaveBeenCalledOnce();
    expect(writeRelease).toHaveBeenCalledOnce();
  });

  it('contains report failures without poisoning the required release', async () => {
    const failure = new Error('worker state unavailable');
    const writeBestEffort = vi.fn(async () => {
      throw failure;
    });
    const writeRelease = vi.fn(async () => true);
    const publisher = createWorkerStatePublisher('execution-a', {
      writeBestEffort,
      writeRelease,
    });

    publisher.publish({ lastError: 'processing failed' });
    await expect(publisher.release()).resolves.toBe(true);

    expect(writeBestEffort).toHaveBeenCalledOnce();
    expect(writeRelease).toHaveBeenCalledOnce();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { err: failure },
      'Failed to publish worker state',
    );
  });

  it('surfaces and memoizes a required release failure', async () => {
    const failure = new Error('worker state unavailable');
    const writeRelease = vi.fn(async () => {
      throw failure;
    });
    const publisher = createWorkerStatePublisher('execution-a', {
      writeBestEffort: vi.fn(async () => true),
      writeRelease,
    });

    const first = publisher.release();
    const second = publisher.release();
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    publisher.publish({ currentBatchSize: 1 });
    await Promise.resolve();

    expect(first).toBe(second);
    expect(writeRelease).toHaveBeenCalledOnce();
  });

  it('does not let a hung best-effort report block required release', async () => {
    vi.useFakeTimers();
    try {
      const writeBestEffort = vi.fn(
        () => new Promise<boolean>(() => {}),
      );
      const writeRelease = vi.fn(async () => true);
      const publisher = createWorkerStatePublisher('execution-a', {
        writeBestEffort,
        writeRelease,
        reportWaitMs: 1_000,
      });

      publisher.publish({ currentBatchSize: 3 });
      const releasing = publisher.release({ currentBatchSize: 0 });
      await vi.advanceTimersByTimeAsync(0);
      expect(writeBestEffort).toHaveBeenCalledOnce();
      expect(writeRelease).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(releasing).resolves.toBe(true);

      expect(writeRelease).toHaveBeenCalledOnce();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        { reportWaitMs: 1_000 },
        'Timed out publishing worker state; suppressing later reports',
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
