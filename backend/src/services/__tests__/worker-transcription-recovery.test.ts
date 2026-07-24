import { describe, expect, it, vi } from 'vitest';
import {
  createLeaseRecoveryCoordinator,
  decideEmptyWorkerJob,
  projectQueuedRecoveryForWorker,
} from '../lease-recovery-coordinator.js';

describe('worker queue recovery coordination', () => {
  it('drains recovered work from every queued processing stage', () => {
    expect(projectQueuedRecoveryForWorker({
      transcription: { requeued: [], failed: [] },
      metadata: { requeued: [{ id: 'metadata-1' }], failed: [] },
      entityExtraction: {
        requeued: [{ id: 'entity-1' }],
        failed: [{ id: 'requested-entity-1' }],
      },
      extraContent: { requeued: [{ id: 'extra-1' }], failed: [] },
    })).toEqual({
      requeued: [
        { id: 'metadata-1' },
        { id: 'entity-1' },
        { id: 'extra-1' },
      ],
      failed: [{ id: 'requested-entity-1' }],
    });
  });

  it('waits for a queued lease, drains it after recovery, then exits', async () => {
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({ requeued: [], failed: [] })
      .mockResolvedValueOnce({ requeued: [{ id: 'letter-1' }], failed: [] })
      .mockResolvedValueOnce({ requeued: [], failed: [] });
    const getQueuedWorkState = vi
      .fn()
      .mockResolvedValueOnce('leased')
      .mockResolvedValueOnce('none');

    await expect(decideEmptyWorkerJob({ reconcile, getQueuedWorkState })).resolves.toBe('wait');
    await expect(decideEmptyWorkerJob({ reconcile, getQueuedWorkState })).resolves.toBe('drain');
    await expect(decideEmptyWorkerJob({ reconcile, getQueuedWorkState })).resolves.toBe('exit');

    expect(reconcile).toHaveBeenCalledTimes(3);
    expect(getQueuedWorkState).toHaveBeenCalledTimes(2);
  });

  it('does not stay alive for requested-only recovery', async () => {
    const reconcile = vi.fn().mockResolvedValue({
      requeued: [],
      failed: [{ id: 'requested-letter' }],
    });
    const getQueuedWorkState = vi.fn().mockResolvedValue('none');

    await expect(decideEmptyWorkerJob({ reconcile, getQueuedWorkState })).resolves.toBe('exit');
  });

  it('drains a queued row recovered by a competing reconciler', async () => {
    const reconcile = vi.fn().mockResolvedValue({ requeued: [], failed: [] });
    const getQueuedWorkState = vi.fn().mockResolvedValue('pending');

    await expect(decideEmptyWorkerJob({ reconcile, getQueuedWorkState })).resolves.toBe('drain');
  });

  it('serializes recovery and waits for an active call when stopped', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recover = vi.fn(async () => {
      await blocked;
      return { requeued: [], failed: [] };
    });
    const onError = vi.fn();
    const coordinator = createLeaseRecoveryCoordinator({
      intervalMs: 60_000,
      recover,
      onError,
    });

    const first = coordinator.reconcile();
    const second = coordinator.reconcile();
    let stopped = false;
    const stopping = coordinator.stopAndWait().then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(stopped).toBe(false);

    release();
    await expect(Promise.all([first, second, stopping])).resolves.toEqual([
      { requeued: [], failed: [] },
      { requeued: [], failed: [] },
      undefined,
    ]);
    expect(stopped).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('contains recovery errors and can retry on the next request', async () => {
    const failure = new Error('database unavailable');
    const recover = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ requeued: [], failed: [] });
    const onError = vi.fn();
    const coordinator = createLeaseRecoveryCoordinator({
      intervalMs: 60_000,
      recover,
      onError,
    });

    await expect(coordinator.reconcile()).resolves.toBeNull();
    await expect(coordinator.reconcile()).resolves.toEqual({ requeued: [], failed: [] });
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('runs one unref periodic loop and stops future reconciliation', async () => {
    vi.useFakeTimers();
    try {
      const recover = vi.fn().mockResolvedValue({
        transcription: { requeued: [], failed: [] },
        metadata: { requeued: [], failed: [] },
        entityExtraction: { requeued: [], failed: [] },
        extraContent: { requeued: [], failed: [] },
      });
      const coordinator = createLeaseRecoveryCoordinator({
        intervalMs: 60_000,
        recover,
        onError: vi.fn(),
      });

      coordinator.start();
      coordinator.start();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(recover).toHaveBeenCalledTimes(3);

      await coordinator.stopAndWait();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(recover).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
