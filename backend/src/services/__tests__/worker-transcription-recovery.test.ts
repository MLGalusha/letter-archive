import { describe, expect, it, vi } from 'vitest';
import {
  createWorkerTranscriptionRecovery,
  decideEmptyWorkerJob,
} from '../worker-transcription-recovery.js';

describe('worker transcription recovery coordination', () => {
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
    const coordinator = createWorkerTranscriptionRecovery({
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
    const coordinator = createWorkerTranscriptionRecovery({
      intervalMs: 60_000,
      recover,
      onError,
    });

    await expect(coordinator.reconcile()).resolves.toBeNull();
    await expect(coordinator.reconcile()).resolves.toEqual({ requeued: [], failed: [] });
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
