import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  dbSelectMock,
  ensureBackgroundWorkerForQueuedProcessingMock,
  fileExistsMock,
  processUploadedFileMock,
  uploadedFiles,
} = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  ensureBackgroundWorkerForQueuedProcessingMock: vi.fn(),
  fileExistsMock: vi.fn(),
  processUploadedFileMock: vi.fn(),
  uploadedFiles: [{
    path: '/tmp/letter-archive-upload-test.jpg',
    originalname: '003-19320706-L01-01.jpg',
    mimetype: 'image/jpeg',
  }],
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
  notify: vi.fn(),
}));

vi.mock('../../../services/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/storage.js')>();
  return {
    ...actual,
    fileExists: fileExistsMock,
  };
});

import uploadsRouter from '../uploads.js';

describe('admin uploads route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureBackgroundWorkerForQueuedProcessingMock.mockResolvedValue(true);
    processUploadedFileMock.mockResolvedValue({
      letter: { id: 'letter-1' },
      page: { id: 'page-1' },
      collection: { collectionCode: '003' },
      storagePath: '003/19320706/003-19320706-L01-01.jpg',
      alreadyExists: false,
    });
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
    fileExistsMock.mockResolvedValueOnce(true);

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
    });
    expect(fileExistsMock).toHaveBeenCalledTimes(1);
  });

  it('propagates internal failures through the error handler with request id', async () => {
    fileExistsMock.mockRejectedValueOnce(new Error('disk offline'));

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
    expect(response.body).toMatchObject({ success: 1, failed: 0 });
    await vi.waitFor(() => {
      expect(ensureBackgroundWorkerForQueuedProcessingMock).toHaveBeenCalledWith('upload');
    });
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
});
