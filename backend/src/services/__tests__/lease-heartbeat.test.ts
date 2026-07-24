import { describe, expect, it, vi } from 'vitest';

import { withLeaseHeartbeat } from '../letter/lease-heartbeat.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('shared stage lease heartbeat', () => {
  it('waits for the initial ownership check before starting producer work', async () => {
    const renewal = deferred<boolean>();
    const operation = vi.fn(async heartbeat => heartbeat.hasOwnership());

    const running = withLeaseHeartbeat(
      {
        renew: () => renewal.promise,
        onRenewalError: vi.fn(),
      },
      operation,
    );

    await Promise.resolve();
    expect(operation).not.toHaveBeenCalled();

    renewal.resolve(false);
    await expect(running).resolves.toBe(false);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('continues with unknown ownership after a transient initial renewal error', async () => {
    const onRenewalError = vi.fn();
    const operation = vi.fn(async heartbeat => heartbeat.hasOwnership());

    await expect(withLeaseHeartbeat(
      {
        renew: async () => {
          throw new Error('database unavailable');
        },
        onRenewalError,
      },
      operation,
    )).resolves.toBe(true);

    expect(onRenewalError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'database unavailable' }),
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
