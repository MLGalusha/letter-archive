import { describe, expect, it, vi } from 'vitest';
import { ImageTransformScheduler, ImageTransformAbortedError, ImageTransformOverloadError } from '../image-transform-scheduler.js';

const variant = { buffer: Buffer.from('same bytes'), contentType: 'image/avif' };
function deferred() {
  let resolve!: (value: typeof variant) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<typeof variant>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('image transform scheduler', () => {
  it('bounds active work and queued jobs, then starts queued work in FIFO order', async () => {
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 2, maxWaiters: 4 });
    const first = deferred();
    const order: number[] = [];
    const one = scheduler.schedule(() => { order.push(1); return first.promise; });
    const two = scheduler.schedule(async () => { order.push(2); return variant; });
    const three = scheduler.schedule(async () => { order.push(3); return variant; });
    expect(scheduler.state).toEqual({ active: 1, queued: 2, waiters: 3 });
    await expect(scheduler.schedule(async () => variant)).rejects.toBeInstanceOf(ImageTransformOverloadError);
    expect(order).toEqual([1]);
    first.resolve(variant);
    const results = await Promise.all([one, two, three]);
    expect(order).toEqual([1, 2, 3]);
    expect(results.every((result) => result.buffer === variant.buffer)).toBe(true);
    expect(scheduler.state).toEqual({ active: 0, queued: 0, waiters: 0 });
  });

  it('shares a variant while bounding duplicate callers, without canceling its other caller', async () => {
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 0, maxWaiters: 2 });
    const job = deferred();
    const work = vi.fn(() => job.promise);
    const controller = new AbortController();
    const one = scheduler.schedule(work, { key: 'page:version:480:avif', signal: controller.signal });
    const aborted = expect(one).rejects.toBeInstanceOf(ImageTransformAbortedError);
    const two = scheduler.schedule(work, { key: 'page:version:480:avif' });
    await expect(scheduler.schedule(work, { key: 'page:version:480:avif' })).rejects.toBeInstanceOf(ImageTransformOverloadError);
    controller.abort();
    await aborted;
    expect(scheduler.state).toEqual({ active: 1, queued: 0, waiters: 1 });
    job.resolve(variant);
    expect(await two).toMatchObject({ ...variant, shared: true, queueMs: 0 });
    expect(work).toHaveBeenCalledTimes(1);
    expect(scheduler.state).toEqual({ active: 0, queued: 0, waiters: 0 });
  });

  it('removes an abandoned queued job and its key before native work starts', async () => {
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 1, maxWaiters: 3 });
    const active = deferred();
    const first = scheduler.schedule(() => active.promise);
    const controller = new AbortController();
    const skippedWork = vi.fn(async () => variant);
    const queued = scheduler.schedule(skippedWork, { key: 'abandoned', signal: controller.signal });
    const rejection = expect(queued).rejects.toBeInstanceOf(ImageTransformAbortedError);
    controller.abort();
    await rejection;
    expect(scheduler.state).toEqual({ active: 1, queued: 0, waiters: 1 });
    const replacementWork = vi.fn(async () => variant);
    const replacement = scheduler.schedule(replacementWork, { key: 'abandoned' });
    active.resolve(variant);
    await Promise.all([first, replacement]);
    expect(skippedWork).not.toHaveBeenCalled();
    expect(replacementWork).toHaveBeenCalledOnce();
  });

  it('keeps queued shared work until its last caller leaves and detaches listeners', async () => {
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 1, maxWaiters: 3 });
    const active = deferred();
    const first = scheduler.schedule(() => active.promise);
    const a = new AbortController();
    const b = new AbortController();
    const removed = vi.spyOn(b.signal, 'removeEventListener');
    const work = vi.fn(async () => variant);
    const second = scheduler.schedule(work, { key: 'shared', signal: a.signal });
    const third = scheduler.schedule(work, { key: 'shared', signal: b.signal });
    const rejections = [expect(second).rejects.toBeInstanceOf(ImageTransformAbortedError), expect(third).rejects.toBeInstanceOf(ImageTransformAbortedError)];
    a.abort();
    expect(scheduler.state.queued).toBe(1);
    b.abort();
    expect(scheduler.state.queued).toBe(0);
    active.resolve(variant);
    await Promise.all([first, ...rejections]);
    expect(work).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledOnce();
  });

  it('releases a failed shared job, rejects all callers, and drains later work', async () => {
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 1, maxWaiters: 3 });
    const active = deferred();
    const error = new Error('encoder failed');
    const first = scheduler.schedule(() => active.promise, { key: 'failed' });
    const second = scheduler.schedule(() => active.promise, { key: 'failed' });
    const failures = [expect(first).rejects.toBe(error), expect(second).rejects.toBe(error)];
    const later = scheduler.schedule(async () => variant);
    active.reject(error);
    await Promise.all([...failures, later]);
    await expect(scheduler.schedule(async () => variant, { key: 'failed' })).resolves.toMatchObject(variant);
    expect(scheduler.state).toEqual({ active: 0, queued: 0, waiters: 0 });
  });

  it('rejects pre-aborted callers without admission and releases synchronous failures', async () => {
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 0, maxWaiters: 1 });
    const controller = new AbortController(); controller.abort();
    const work = vi.fn(async () => variant);
    await expect(scheduler.schedule(work, { signal: controller.signal })).rejects.toBeInstanceOf(ImageTransformAbortedError);
    expect(work).not.toHaveBeenCalled();
    await expect(scheduler.schedule(() => { throw new Error('sync failure'); })).rejects.toThrow('sync failure');
    await expect(scheduler.schedule(work)).resolves.toMatchObject(variant);
    expect(scheduler.state).toEqual({ active: 0, queued: 0, waiters: 0 });
  });

  it('keeps an abandoned native job in the active limit until it really finishes', async () => {
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 0, maxWaiters: 1 });
    const active = deferred();
    const controller = new AbortController();
    const pending = scheduler.schedule(() => active.promise, { signal: controller.signal });
    const rejection = expect(pending).rejects.toBeInstanceOf(ImageTransformAbortedError);
    controller.abort(); await rejection;
    expect(scheduler.state).toEqual({ active: 1, queued: 0, waiters: 0 });
    await expect(scheduler.schedule(async () => variant)).rejects.toBeInstanceOf(ImageTransformOverloadError);
    active.resolve(variant);
    await vi.waitFor(() => expect(scheduler.state.active).toBe(0));
    await expect(scheduler.schedule(async () => variant)).resolves.toMatchObject(variant);
  });
});
