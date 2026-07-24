import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  dbSelectMock,
  ensureBackgroundWorkerForQueuedProcessingMock,
  findObservedPageSourcesByIdentityMock,
  unlinkMock,
  notifyMock,
  processUploadedFileMock,
  uploadedFiles,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  ensureBackgroundWorkerForQueuedProcessingMock: vi.fn(),
  findObservedPageSourcesByIdentityMock: vi.fn(),
  unlinkMock: vi.fn(),
  notifyMock: vi.fn(),
  processUploadedFileMock: vi.fn(),
  uploadedFiles: [{
    path: '/tmp/letter-archive-upload-test.jpg',
    originalname: '003-19320706-L01-01.jpg',
    mimetype: 'image/jpeg',
  }],
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  unlink: unlinkMock,
}));

vi.mock('multer', () => ({
  default: vi.fn(() => ({
    array: vi.fn(() => (
      req: { files?: typeof uploadedFiles },
      _res: unknown,
      next: () => void,
    ) => {
      req.files = uploadedFiles;
      next();
    }),
  })),
}));

vi.mock('../../../db/index.js', () => ({
  db: {
    select: dbSelectMock,
  },
  siteSettings: {
    key: 'siteSettings.key',
  },
}));

vi.mock('../../../services/upload.js', () => ({
  processUploadedFile: processUploadedFileMock,
}));

vi.mock('../../../services/processing-queue.js', () => ({
  ensureBackgroundWorkerForQueuedProcessing:
    ensureBackgroundWorkerForQueuedProcessingMock,
}));

vi.mock('../../../services/notifications.js', () => ({
  notify: notifyMock,
}));

vi.mock('../../../services/letter-pages.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/letter-pages.js')>();
  return {
    ...actual,
    findObservedPageSourcesByIdentity: findObservedPageSourcesByIdentityMock,
  };
});

import uploadsRouter from '../uploads.js';
import { sourceRevisionChanged } from '../../../services/letter/source-revision.js';

const sourceExpectation = {
  pageId: 'page-1',
  primarySourceRevision: 7,
  storagePath: 'storage/current.jpg',
  checksumSha256: 'checksum-current',
};

describe('admin uploads route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadedFiles.splice(0, uploadedFiles.length, {
      path: '/tmp/letter-archive-upload-test.jpg',
      originalname: '003-19320706-L01-01.jpg',
      mimetype: 'image/jpeg',
    });
    unlinkMock.mockResolvedValue(undefined);
    ensureBackgroundWorkerForQueuedProcessingMock.mockResolvedValue(true);
    processUploadedFileMock.mockResolvedValue({
      letter: { id: 'letter-1' },
      page: { id: 'page-1' },
      collection: { collectionCode: '003' },
      storagePath: '003/19320706/003-19320706-L01-01.jpg',
      primarySourceRevision: 8,
      alreadyExists: false,
      outcome: 'created',
      changed: true,
    });
    findObservedPageSourcesByIdentityMock.mockResolvedValue(new Map());
  });

  it('injects requestId into manual validation errors', async () => {
    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads/check-duplicates',
      path: '/uploads/check-duplicates',
      body: { filenames: 'bad-shape' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'filenames must be an array of strings',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('checks only valid filenames and returns false for invalid ones', async () => {
    findObservedPageSourcesByIdentityMock.mockResolvedValueOnce(new Map([[
      '003\u000019320706\u0000L\u00001\u00001',
      sourceExpectation,
    ]]));

    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads/check-duplicates',
      path: '/uploads/check-duplicates',
      body: {
        filenames: ['003-19320706-L01-01.jpg', 'not-valid.jpg'],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      duplicates: {
        '003-19320706-L01-01.jpg': true,
        'not-valid.jpg': false,
      },
      sourceExpectations: {
        '003-19320706-L01-01.jpg': sourceExpectation,
        'not-valid.jpg': null,
      },
    });
    expect(findObservedPageSourcesByIdentityMock).toHaveBeenCalledTimes(1);
  });

  it('propagates internal failures through the error handler with request id', async () => {
    findObservedPageSourcesByIdentityMock.mockRejectedValueOnce(
      new Error('database offline'),
    );

    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads/check-duplicates',
      path: '/uploads/check-duplicates',
      body: {
        filenames: ['003-19320706-L01-01.jpg'],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      error: 'Internal server error',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('wakes the worker for any durable upload work when automatic processing is enabled', async () => {
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ value: 'true' }],
        }),
      }),
    });

    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads',
      path: '/uploads',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: 1,
      failed: 0,
      results: [{
        filename: '003-19320706-L01-01.jpg',
        letterId: 'letter-1',
        pageId: 'page-1',
        collectionCode: '003',
        storagePath: '003/19320706/003-19320706-L01-01.jpg',
        primarySourceRevision: 8,
        alreadyExists: false,
        outcome: 'created',
        changed: true,
      }],
      summary: {
        accepted: 1,
        failed: 0,
        changed: 1,
        unchanged: 0,
        created: 1,
        replaced: 0,
        affectedLetters: 1,
      },
    });
    await vi.waitFor(() => {
      expect(ensureBackgroundWorkerForQueuedProcessingMock).toHaveBeenCalledWith('upload');
    });
  });

  it('does not notify, query settings, or wake for an unchanged-only batch', async () => {
    processUploadedFileMock.mockResolvedValueOnce({
      letter: { id: 'letter-1' },
      page: { id: 'page-1' },
      collection: { collectionCode: '003' },
      storagePath: '003/19320706/003-19320706-L01-01.jpg',
      primarySourceRevision: 8,
      alreadyExists: true,
      outcome: 'unchanged',
      changed: false,
    });

    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads',
      path: '/uploads',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });

    expect(response.body).toMatchObject({
      success: 1,
      summary: {
        changed: 0,
        unchanged: 1,
      },
    });
    expect(notifyMock).not.toHaveBeenCalled();
    expect(dbSelectMock).not.toHaveBeenCalled();
    expect(ensureBackgroundWorkerForQueuedProcessingMock).not.toHaveBeenCalled();
  });

  it('preserves the automatic-processing opt-out', async () => {
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: async () => [{ value: 'false' }],
        }),
      }),
    });

    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads',
      path: '/uploads',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(dbSelectMock).toHaveBeenCalledOnce();
    });
    expect(ensureBackgroundWorkerForQueuedProcessingMock).not.toHaveBeenCalled();
  });

  it('requires a duplicate-check expectation for force uploads', async () => {
    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads?force=true',
      path: '/uploads',
      query: { force: 'true' },
      body: {},
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('requires a duplicate-check source expectation'),
    });
    expect(processUploadedFileMock).not.toHaveBeenCalled();
  });

  it('rejects a multi-file force request and cleans every temporary file', async () => {
    uploadedFiles.push({
      path: '/tmp/letter-archive-upload-test-02.jpg',
      originalname: '003-19320706-L01-02.jpg',
      mimetype: 'image/jpeg',
    });

    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads?force=true',
      path: '/uploads',
      query: { force: 'true' },
      body: {},
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Force replacement accepts exactly one file per request',
    });
    expect(unlinkMock).toHaveBeenCalledTimes(2);
    expect(unlinkMock).toHaveBeenCalledWith(
      '/tmp/letter-archive-upload-test.jpg',
    );
    expect(unlinkMock).toHaveBeenCalledWith(
      '/tmp/letter-archive-upload-test-02.jpg',
    );
    expect(processUploadedFileMock).not.toHaveBeenCalled();
  });

  it('passes the exact per-file expectation into force replacement', async () => {
    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads?force=true',
      path: '/uploads',
      query: { force: 'true' },
      body: {
        sourceExpectations: JSON.stringify({
          '003-19320706-L01-01.jpg': sourceExpectation,
        }),
      },
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });

    expect(response.statusCode).toBe(200);
    expect(processUploadedFileMock).toHaveBeenCalledWith(
      '/tmp/letter-archive-upload-test.jpg',
      '003-19320706-L01-01.jpg',
      true,
      sourceExpectation,
    );
  });

  it('returns the shared source-conflict contract for a stale force confirmation', async () => {
    processUploadedFileMock.mockRejectedValueOnce(sourceRevisionChanged(
      'Page source changed after duplicate confirmation',
    ));

    const response = await invokeRouter(uploadsRouter, {
      method: 'POST',
      url: '/uploads?force=true',
      path: '/uploads',
      query: { force: 'true' },
      body: {
        sourceExpectations: JSON.stringify({
          '003-19320706-L01-01.jpg': sourceExpectation,
        }),
      },
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: 'SOURCE_REVISION_CHANGED',
      error: expect.stringContaining('source changed'),
    });
  });
});
