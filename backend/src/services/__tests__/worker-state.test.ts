import { describe, expect, it, vi } from 'vitest';
import { createWorkerStatePublisher, type WorkerStateUpdate } from '../worker-state.js';

describe('worker state publisher', () => {
  it('settles accepted heartbeats before the exit handoff and rejects later heartbeats', async () => {
    let releaseHeartbeat!: () => void;
    const heartbeatBlocked = new Promise<void>((resolve) => {
      releaseHeartbeat = resolve;
    });
    const writes: string[] = [];
    const writeBestEffort = vi.fn(async (partial: WorkerStateUpdate) => {
      writes.push(`heartbeat-start:${partial.isPolling}`);
      await heartbeatBlocked;
      writes.push(`heartbeat-end:${partial.isPolling}`);
    });
    const writeRequired = vi.fn(async (partial: WorkerStateUpdate) => {
      writes.push(`required:${partial.isPolling}`);
    });
    const publisher = createWorkerStatePublisher({ writeBestEffort, writeRequired });

    publisher.publishHeartbeat({ isPolling: true });
    await vi.waitFor(() => expect(writeBestEffort).toHaveBeenCalledTimes(1));

    const relinquishing = publisher.relinquish({ isPolling: false });
    const repeatedRelinquishing = publisher.relinquish({ isPolling: false });
    publisher.publishHeartbeat({ isPolling: true });
    expect(writeRequired).not.toHaveBeenCalled();

    releaseHeartbeat();
    await Promise.all([relinquishing, repeatedRelinquishing]);

    expect(writes).toEqual([
      'heartbeat-start:true',
      'heartbeat-end:true',
      'required:false',
    ]);
    expect(writeBestEffort).toHaveBeenCalledTimes(1);
    expect(writeRequired).toHaveBeenCalledTimes(1);
  });

  it('surfaces a required handoff failure and keeps heartbeats disabled', async () => {
    const failure = new Error('worker state unavailable');
    const writeBestEffort = vi.fn(async () => undefined);
    const writeRequired = vi.fn(async () => {
      throw failure;
    });
    const publisher = createWorkerStatePublisher({ writeBestEffort, writeRequired });

    await expect(publisher.relinquish({ isPolling: false })).rejects.toBe(failure);
    await expect(publisher.relinquish({ isPolling: false })).rejects.toBe(failure);
    publisher.publishHeartbeat({ isPolling: true });
    await Promise.resolve();

    expect(writeBestEffort).not.toHaveBeenCalled();
    expect(writeRequired).toHaveBeenCalledOnce();
  });

  it('allows heartbeats again after an abandoned exit decision resumes polling', async () => {
    const writes: boolean[] = [];
    const writeBestEffort = vi.fn(async (partial: WorkerStateUpdate) => {
      writes.push(partial.isPolling ?? false);
    });
    const writeRequired = vi.fn(async (partial: WorkerStateUpdate) => {
      writes.push(partial.isPolling ?? false);
    });
    const publisher = createWorkerStatePublisher({ writeBestEffort, writeRequired });

    await publisher.relinquish({ isPolling: false });
    await publisher.resume({ isPolling: true });
    publisher.publishHeartbeat({ isPolling: true });
    await vi.waitFor(() => expect(writeBestEffort).toHaveBeenCalledTimes(2));
    await publisher.relinquish({ isPolling: false });

    expect(writes).toEqual([false, true, true, false]);
    expect(writeRequired).toHaveBeenCalledTimes(2);
  });
});
