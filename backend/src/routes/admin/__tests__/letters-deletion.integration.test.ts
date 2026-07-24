import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';
import { sourceRevisionChanged } from '../../../services/letter/source-revision.js';

const { deleteCorrespondenceGroupMock } = vi.hoisted(() => ({
  deleteCorrespondenceGroupMock: vi.fn(),
}));

vi.mock('../../../services/letter/correspondence-deletion.js', () => ({
  deleteCorrespondenceGroup: deleteCorrespondenceGroupMock,
}));

import contentRouter from '../letters/content.js';

describe('admin correspondence deletion route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates the complete group boundary and reports the committed row count', async () => {
    deleteCorrespondenceGroupMock.mockResolvedValue({
      letterId: 'letter-1',
      deletedCount: 3,
      storageObjectCount: 4,
      removedStorageObjectCount: 3,
      orphanedStoragePaths: ['storage/orphan.jpg'],
      collectionProfileInvalidated: true,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'DELETE',
      url: '/letter-1',
      path: '/letter-1',
      body: { primarySourceRevision: 12 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Letter deleted successfully',
      letterId: 'letter-1',
      deletedCount: 3,
    });
    expect(deleteCorrespondenceGroupMock).toHaveBeenCalledWith('letter-1', 12);
  });

  it('rejects deletion when the caller did not observe a source revision', async () => {
    const response = await invokeRouter(contentRouter, {
      method: 'DELETE',
      url: '/letter-1',
      path: '/letter-1',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: 'SOURCE_REVISION_CHANGED',
      error: expect.stringContaining('source version is missing'),
    });
    expect(deleteCorrespondenceGroupMock).not.toHaveBeenCalled();
  });

  it('preserves the shared source-conflict contract from the locked service', async () => {
    deleteCorrespondenceGroupMock.mockRejectedValueOnce(sourceRevisionChanged(
      'Correspondence source changed; reload and confirm deletion again',
    ));

    const response = await invokeRouter(contentRouter, {
      method: 'DELETE',
      url: '/letter-1',
      path: '/letter-1',
      body: { primarySourceRevision: 12 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: 'SOURCE_REVISION_CHANGED',
      error: expect.stringContaining('Correspondence source changed'),
    });
  });

  it('returns not found when the transaction cannot lock the requested member', async () => {
    deleteCorrespondenceGroupMock.mockResolvedValue(null);

    const response = await invokeRouter(contentRouter, {
      method: 'DELETE',
      url: '/missing-letter',
      path: '/missing-letter',
      body: { primarySourceRevision: 12 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: 'Letter not found' });
  });
});
