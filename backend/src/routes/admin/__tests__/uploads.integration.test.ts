import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const { fileExistsMock } = vi.hoisted(() => ({
  fileExistsMock: vi.fn(),
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
});
