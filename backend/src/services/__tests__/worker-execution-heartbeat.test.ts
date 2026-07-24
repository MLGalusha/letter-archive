import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerExecutionHeartbeat } from '../worker-execution-heartbeat.js';

const LEASE_MS = 120_000;
const INTERVAL_MS = 30_000;

describe('worker execution heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renews immediately and on an independent interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const renew = vi.fn().mockResolvedValue(true);
    const heartbeat = createWorkerExecutionHeartbeat({
      renew,
      onRenewalError: vi.fn(),
      leaseDurationMs: LEASE_MS,
      initialConfirmationStartedAtMs: Date.now(),
      intervalMs: INTERVAL_MS,
      now: () => Date.now(),
    });

    await vi.waitFor(() => expect(renew).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(renew).toHaveBeenCalledTimes(3);
    expect(heartbeat.hasOwnership()).toBe(true);
    await heartbeat.stopAndWait();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never overlaps slow renewal requests', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let finishRenewal!: (renewed: boolean) => void;
    const renew = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRenewal = resolve;
        }),
    );
    const heartbeat = createWorkerExecutionHeartbeat({
      renew,
      onRenewalError: vi.fn(),
      leaseDurationMs: LEASE_MS,
      initialConfirmationStartedAtMs: Date.now(),
      intervalMs: INTERVAL_MS,
      now: () => Date.now(),
    });

    await Promise.resolve();
    expect(renew).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(renew).toHaveBeenCalledOnce();

    finishRenewal(true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(2);

    finishRenewal(true);
    await heartbeat.stopAndWait();
  });

  it('retries transient errors only inside the confirmed lease window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const failure = new Error('database temporarily unavailable');
    const renew = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(true);
    const onRenewalError = vi.fn();
    const heartbeat = createWorkerExecutionHeartbeat({
      renew,
      onRenewalError,
      leaseDurationMs: LEASE_MS,
      initialConfirmationStartedAtMs: Date.now(),
      intervalMs: INTERVAL_MS,
      now: () => Date.now(),
    });

    await vi.waitFor(() => expect(onRenewalError).toHaveBeenCalledWith(failure));
    expect(heartbeat.hasOwnership()).toBe(true);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(heartbeat.hasOwnership()).toBe(true);
    await heartbeat.stopAndWait();
  });

  it('loses ownership once when renewal is rejected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onOwnershipLost = vi.fn();
    const heartbeat = createWorkerExecutionHeartbeat({
      renew: vi.fn().mockResolvedValue(false),
      onRenewalError: vi.fn(),
      onOwnershipLost,
      leaseDurationMs: LEASE_MS,
      initialConfirmationStartedAtMs: Date.now(),
      intervalMs: INTERVAL_MS,
      now: () => Date.now(),
    });

    await vi.waitFor(() => expect(heartbeat.hasOwnership()).toBe(false));
    expect(onOwnershipLost).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(onOwnershipLost).toHaveBeenCalledOnce();
    await heartbeat.stopAndWait();
  });

  it('treats a hung renewal as lost when its confirmed window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let finishRenewal!: (renewed: boolean) => void;
    const renew = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRenewal = resolve;
        }),
    );
    const onOwnershipLost = vi.fn();
    const heartbeat = createWorkerExecutionHeartbeat({
      renew,
      onRenewalError: vi.fn(),
      onOwnershipLost,
      leaseDurationMs: LEASE_MS,
      initialConfirmationStartedAtMs: Date.now(),
      intervalMs: INTERVAL_MS,
      now: () => Date.now(),
    });

    await vi.advanceTimersByTimeAsync(LEASE_MS);

    expect(heartbeat.hasOwnership()).toBe(false);
    expect(onOwnershipLost).toHaveBeenCalledOnce();
    finishRenewal(true);
    await heartbeat.stopAndWait();
    expect(heartbeat.hasOwnership()).toBe(false);
  });

  it('waits for an accepted renewal before stopping', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let finishRenewal!: (renewed: boolean) => void;
    const renew = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRenewal = resolve;
        }),
    );
    const heartbeat = createWorkerExecutionHeartbeat({
      renew,
      onRenewalError: vi.fn(),
      leaseDurationMs: LEASE_MS,
      initialConfirmationStartedAtMs: Date.now(),
      intervalMs: INTERVAL_MS,
      now: () => Date.now(),
    });

    let stopped = false;
    const stopping = heartbeat.stopAndWait().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishRenewal(true);
    await stopping;
    expect(stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds shutdown when an accepted renewal never settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const onOwnershipLost = vi.fn();
    const heartbeat = createWorkerExecutionHeartbeat({
      renew: vi.fn(() => new Promise<boolean>(() => {})),
      onRenewalError: vi.fn(),
      onOwnershipLost,
      leaseDurationMs: LEASE_MS,
      initialConfirmationStartedAtMs: Date.now(),
      intervalMs: INTERVAL_MS,
      stopWaitMs: 1_000,
      now: () => Date.now(),
    });

    await Promise.resolve();
    let stopped = false;
    const stopping = heartbeat.stopAndWait().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(stopped).toBe(true);
    expect(heartbeat.hasOwnership()).toBe(false);
    expect(onOwnershipLost).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
