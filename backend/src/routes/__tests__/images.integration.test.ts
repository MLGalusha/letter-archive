import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  eqMock,
  findFirstMock,
  getAbsoluteStoragePathMock,
  statMock,
  createReadStreamMock,
} = vi.hoisted(() => ({
  eqMock: vi.fn(),
  findFirstMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn(),
  statMock: vi.fn(),
  createReadStreamMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    query: {
      letterPages: {
        findFirst: findFirstMock,
      },
    },
  },
  letterPages: {
    id: 'letterPages.id',
  },
}));

vi.mock('../../services/storage.js', () => ({
  getAbsoluteStoragePath: getAbsoluteStoragePathMock,
}));

vi.mock('node:fs/promises', () => ({
  stat: statMock,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: createReadStreamMock,
  };
});

import imagesRouter from '../images.js';

function createMockStream(body = 'image-bytes') {
  const stream = new EventEmitter() as EventEmitter & {
    pipe: (destination: { end: (chunk?: string) => void }) => void;
  };

  stream.pipe = (destination) => {
    destination.end(body);
    queueMicrotask(() => {
      stream.emit('end');
    });
  };

  return stream;
}

describe('images route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    createReadStreamMock.mockImplementation(() => createMockStream());
  });

  it('streams the image file with cache and content-type headers', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-1',
      storagePath: 'collections/009/19470810/L01/009-19470810-L01-01.jpg',
      originalFilename: '009-19470810-L01-01.JPG',
      letter: { visibility: 'PUBLISHED' },
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/page-1.JPG');
    statMock.mockResolvedValue({ size: 4096 });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-1',
      path: '/images/page-1',
      headers: { accept: 'image/jpeg' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('image-bytes');
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(getAbsoluteStoragePathMock).toHaveBeenCalledWith(
      'collections/009/19470810/L01/009-19470810-L01-01.jpg',
    );
    expect(createReadStreamMock).toHaveBeenCalledWith('/abs/storage/page-1.JPG');
  });

  it('returns a request-correlated 404 when the page record does not exist', async () => {
    findFirstMock.mockResolvedValue(undefined);

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/missing-page',
      path: '/images/missing-page',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Image not found',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
    expect(getAbsoluteStoragePathMock).not.toHaveBeenCalled();
  });

  it('returns a request-correlated 404 when the image file is missing on disk', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-2',
      storagePath: 'collections/009/19470810/L01/009-19470810-L01-02.png',
      originalFilename: '009-19470810-L01-02.png',
      letter: { visibility: 'PUBLISHED' },
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/page-2.png');
    statMock.mockRejectedValue(new Error('ENOENT'));

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-2',
      path: '/images/page-2',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Image file not found on disk',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
    expect(createReadStreamMock).not.toHaveBeenCalled();
  });

  it('falls back to octet-stream for unknown file extensions', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-3',
      storagePath: 'collections/009/19470810/L01/009-19470810-L01-03.bin',
      originalFilename: '009-19470810-L01-03.bin',
      letter: { visibility: 'PUBLISHED' },
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/page-3.bin');
    statMock.mockResolvedValue({ size: 1024 });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-3',
      path: '/images/page-3',
      headers: { accept: '*/*' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
  });
});
