import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  hasActiveWorkerExecutionLeaseMock,
  notifyApiErrorMock,
} = vi.hoisted(() => ({
  hasActiveWorkerExecutionLeaseMock: vi.fn(),
  notifyApiErrorMock: vi.fn(),
}));

vi.mock('../../config/env.js', () => ({
  env: {
    GOOGLE_CLOUD_PROJECT: 'test-project',
    GCLOUD_PROJECT: undefined,
    CLOUD_RUN_REGION: 'us-east1',
    CLOUD_RUN_WORKER_JOB_NAME: 'letter-archive-worker',
  },
}));

vi.mock('../worker-state.js', () => ({
  hasActiveWorkerExecutionLease: hasActiveWorkerExecutionLeaseMock,
}));

vi.mock('../notifications.js', () => ({
  notifyApiError: notifyApiErrorMock,
}));

import { triggerWorkerJob } from '../cloud-run-job.js';

describe('Cloud Run worker trigger', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.unstubAllGlobals();
  });

  it('skips a redundant launch only for a live database execution lease', async () => {
    hasActiveWorkerExecutionLeaseMock.mockResolvedValue(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(triggerWorkerJob('queued-work')).resolves.toBe(true);

    expect(hasActiveWorkerExecutionLeaseMock).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests a worker when the execution lease is absent or expired', async () => {
    hasActiveWorkerExecutionLeaseMock.mockResolvedValue(false);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ name: 'operation-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(triggerWorkerJob('queued-work')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://run.googleapis.com/v2/projects/test-project/locations/us-east1/jobs/letter-archive-worker:run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
        }),
      }),
    );
  });

  it('coalesces concurrent launch decisions inside one API process', async () => {
    let resolveLeaseRead!: (active: boolean) => void;
    hasActiveWorkerExecutionLeaseMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveLeaseRead = resolve;
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const first = triggerWorkerJob('first');
    const second = triggerWorkerJob('second');
    resolveLeaseRead(false);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(hasActiveWorkerExecutionLeaseMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('surfaces an authoritative lease-read failure instead of guessing idle', async () => {
    const failure = new Error('worker state unavailable');
    hasActiveWorkerExecutionLeaseMock.mockRejectedValue(failure);
    vi.stubGlobal('fetch', vi.fn());

    await expect(triggerWorkerJob('queued-work')).rejects.toBe(failure);

    expect(notifyApiErrorMock).toHaveBeenCalledWith({
      service: 'cloud-run',
      endpoint: 'worker_job_execute',
      error: failure,
    });
  });
});
