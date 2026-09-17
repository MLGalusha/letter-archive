import { performance } from 'node:perf_hooks';

export interface ImageVariant {
  buffer: Buffer;
  contentType: string;
}

export interface ScheduledImageVariant extends ImageVariant {
  queueMs: number;
  transformMs: number;
  shared: boolean;
}

export class ImageTransformOverloadError extends Error {
  constructor() { super('Image transform capacity is full'); }
}

export class ImageTransformAbortedError extends Error {
  constructor() { super('Image request was abandoned'); this.name = 'AbortError'; }
}

interface Waiter {
  joinedAt: number;
  shared: boolean;
  signal?: AbortSignal;
  onAbort: () => void;
  resolve: (value: ScheduledImageVariant) => void;
  reject: (error: unknown) => void;
}

interface Job {
  key?: string;
  work: () => Promise<ImageVariant>;
  waiters: Set<Waiter>;
  startedAt?: number;
}

/** Bounds native Sharp work and retained callers; queued jobs hold no image buffers. */
export class ImageTransformScheduler {
  private active = 0;
  private waiterCount = 0;
  private readonly queue: Job[] = [];
  private readonly sharedJobs = new Map<string, Job>();

  constructor(private readonly limits: { concurrency: number; maxQueued: number; maxWaiters: number }) {
    if (!Number.isInteger(limits.concurrency) || limits.concurrency < 1
      || !Number.isInteger(limits.maxQueued) || limits.maxQueued < 0
      || !Number.isInteger(limits.maxWaiters) || limits.maxWaiters < 1) {
      throw new Error('Invalid image scheduler limits');
    }
  }

  get state() {
    return { active: this.active, queued: this.queue.length, waiters: this.waiterCount };
  }

  schedule(work: () => Promise<ImageVariant>, options: { key?: string; signal?: AbortSignal } = {}): Promise<ScheduledImageVariant> {
    if (options.signal?.aborted) return Promise.reject(new ImageTransformAbortedError());
    const existing = options.key === undefined ? undefined : this.sharedJobs.get(options.key);
    if (this.waiterCount >= this.limits.maxWaiters
      || (!existing && this.active >= this.limits.concurrency && this.queue.length >= this.limits.maxQueued)) {
      return Promise.reject(new ImageTransformOverloadError());
    }
    const job = existing ?? { key: options.key, work, waiters: new Set<Waiter>() };
    const promise = new Promise<ScheduledImageVariant>((resolve, reject) => {
      const waiter: Waiter = {
        joinedAt: performance.now(), shared: Boolean(existing), signal: options.signal, resolve, reject,
        onAbort: () => {
          this.detach(job, waiter);
          reject(new ImageTransformAbortedError());
          if (job.startedAt === undefined && job.waiters.size === 0) {
            const index = this.queue.indexOf(job);
            if (index !== -1) this.queue.splice(index, 1);
            if (job.key !== undefined) this.sharedJobs.delete(job.key);
          }
        },
      };
      job.waiters.add(waiter);
      this.waiterCount++;
      options.signal?.addEventListener('abort', waiter.onAbort, { once: true });
    });
    if (!existing) {
      if (job.key !== undefined) this.sharedJobs.set(job.key, job);
      if (this.active < this.limits.concurrency) void this.run(job);
      else this.queue.push(job);
    }
    return promise;
  }

  private detach(job: Job, waiter: Waiter) {
    if (!job.waiters.delete(waiter)) return;
    this.waiterCount--;
    waiter.signal?.removeEventListener('abort', waiter.onAbort);
  }

  private async run(job: Job) {
    this.active++;
    job.startedAt = performance.now();
    try {
      const value = await job.work();
      const transformMs = performance.now() - job.startedAt;
      for (const waiter of job.waiters) {
        this.detach(job, waiter);
        waiter.resolve({ ...value, queueMs: Math.max(0, job.startedAt - waiter.joinedAt), transformMs, shared: waiter.shared });
      }
    } catch (error) {
      for (const waiter of job.waiters) {
        this.detach(job, waiter);
        waiter.reject(error);
      }
    } finally {
      if (job.key !== undefined) this.sharedJobs.delete(job.key);
      this.active--;
      const next = this.queue.shift();
      if (next) void this.run(next);
    }
  }
}
