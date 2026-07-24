import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiPostMock = vi.fn();

vi.mock('../../client', () => ({
  apiGet: vi.fn(),
  apiPost: (...args: unknown[]) => apiPostMock(...args),
}));

import {
  cancelProcessingJob,
  clearProcessingQueue,
  removeProcessingQueueItem,
  retryProcessingJob,
  type ProcessingQueueItem,
} from '../processing';

const queuedItem: ProcessingQueueItem = {
  letterId: 'letter-1',
  primarySourceRevision: 7,
  jobStateToken: 'v1.opaque-job-token',
  letterTitle: '19470810',
  collectionCode: '009',
  sender: 'Alice',
  recipient: 'Bob',
  queuedAt: null,
};

describe('admin processing queue API', () => {
  beforeEach(() => {
    apiPostMock.mockReset();
    apiPostMock.mockResolvedValue({ message: 'ok' });
  });

  it.each([
    {
      path: '/admin/processing/cancel',
      invoke: () => cancelProcessingJob('transcription', queuedItem),
    },
    {
      path: '/admin/processing/queue/remove',
      invoke: () => removeProcessingQueueItem('transcription', queuedItem),
    },
    {
      path: '/admin/processing/queue/retry',
      invoke: () => retryProcessingJob('transcription', queuedItem),
    },
  ])('sends the source and opaque job token to $path', async ({
    path,
    invoke,
  }) => {
    await invoke();

    expect(apiPostMock).toHaveBeenCalledWith(path, {
      type: 'transcription',
      letterId: 'letter-1',
      primarySourceRevision: 7,
      jobStateToken: 'v1.opaque-job-token',
    });
  });

  it('clears only the supplied displayed snapshots', async () => {
    await clearProcessingQueue('transcription', [queuedItem]);

    expect(apiPostMock).toHaveBeenCalledWith(
      '/admin/processing/queue/clear',
      {
        type: 'transcription',
        items: [{
          letterId: 'letter-1',
          primarySourceRevision: 7,
          jobStateToken: 'v1.opaque-job-token',
        }],
      },
    );
  });
});
