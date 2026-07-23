import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  eqMock,
  andMock,
  sqlMock,
  findFirstMock,
  lettersFindFirstMock,
  adminUsersFindFirstMock,
  getAbsoluteStoragePathMock,
  statMock,
  createReadStreamMock,
  verifyImageSessionTokenMock,
  sharpMock,
} = vi.hoisted(() => ({
  eqMock: vi.fn(),
  andMock: vi.fn(),
  sqlMock: vi.fn(),
  findFirstMock: vi.fn(),
  lettersFindFirstMock: vi.fn(),
  adminUsersFindFirstMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn(),
  statMock: vi.fn(),
  createReadStreamMock: vi.fn(),
  verifyImageSessionTokenMock: vi.fn(),
  sharpMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  sql: sqlMock,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    query: {
      letterPages: {
        findFirst: findFirstMock,
      },
      letters: {
        findFirst: lettersFindFirstMock,
      },
      adminUsers: {
        findFirst: adminUsersFindFirstMock,
      },
    },
  },
  letterPages: {
    id: 'letterPages.id',
  },
  letters: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    typeSequence: 'letters.typeSequence',
    visibility: 'letters.visibility',
    type: 'letters.type',
  },
  adminUsers: {
    id: 'adminUsers.id',
  },
}));

vi.mock('../../services/storage.js', () => ({
  getAbsoluteStoragePath: getAbsoluteStoragePathMock,
}));

vi.mock('../../auth/jwt.js', () => ({
  verifyImageSessionToken: verifyImageSessionTokenMock,
}));

vi.mock('sharp', () => ({
  default: sharpMock,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: actual,
    stat: statMock,
  };
});

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

function catalogueLetter(
  overrides: Partial<{
    visibility: string;
    collectionId: string;
    dateRaw: string;
    typeSequence: string;
    type: string;
  }> = {},
) {
  return {
    visibility: 'PUBLISHED',
    collectionId: 'collection-9',
    dateRaw: '19470810',
    typeSequence: '01',
    type: 'L',
    ...overrides,
  };
}

describe('images route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    sqlMock.mockImplementation((strings, ...values) => ({ strings, values }));
    createReadStreamMock.mockImplementation(() => createMockStream());
    verifyImageSessionTokenMock.mockReturnValue(null);
    adminUsersFindFirstMock.mockResolvedValue({ id: 'admin-1' });
    sharpMock.mockImplementation((sourcePath: string) => {
      const pipeline = {
        rotate: vi.fn(),
        resize: vi.fn(),
        avif: vi.fn(),
        webp: vi.fn(),
        jpeg: vi.fn(),
        toBuffer: vi.fn().mockResolvedValue(
          Buffer.from(sourcePath.includes('replacement') ? 'replacement-bytes' : 'original-bytes'),
        ),
      };
      pipeline.rotate.mockReturnValue(pipeline);
      pipeline.resize.mockReturnValue(pipeline);
      pipeline.avif.mockReturnValue(pipeline);
      pipeline.webp.mockReturnValue(pipeline);
      pipeline.jpeg.mockReturnValue(pipeline);
      return pipeline;
    });
  });

  it('streams a public image with mandatory cache revalidation', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-1',
      storagePath: 'collections/009/19470810/L01/009-19470810-L01-01.jpg',
      originalFilename: '009-19470810-L01-01.JPG',
      letter: catalogueLetter(),
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
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(getAbsoluteStoragePathMock).toHaveBeenCalledWith(
      'collections/009/19470810/L01/009-19470810-L01-01.jpg',
    );
    expect(createReadStreamMock).toHaveBeenCalledWith('/abs/storage/page-1.JPG');
    expect(adminUsersFindFirstMock).not.toHaveBeenCalled();
  });

  it('does not allow a credential-bearing public image URL into a public cache', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-public-with-token',
      storagePath: 'collections/009/19470810/L01/page-public.jpg',
      originalFilename: 'page-public.jpg',
      letter: catalogueLetter(),
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/page-public.jpg');
    statMock.mockResolvedValue({ size: 4096 });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-public-with-token?token=reusable-admin-jwt',
      path: '/images/page-public-with-token',
      query: { token: 'reusable-admin-jwt' },
      headers: { accept: 'image/jpeg' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('reuses a public transform across junk query, header, and cookie credentials', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-public-auth-independent-cache',
      checksumSha256: 'public-checksum',
      storagePath: 'collections/009/19470810/L01/page-public-cache.jpg',
      originalFilename: 'page-public-cache.jpg',
      letter: catalogueLetter(),
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/page-public-cache.jpg');
    statMock.mockResolvedValue({ size: 4096, mtimeMs: 100 });

    const requests: Array<{
      url: string;
      query: Record<string, string>;
      headers: Record<string, string>;
    }> = [
      {
        url: '/images/page-public-auth-independent-cache?w=640',
        query: { w: '640' },
        headers: { accept: 'image/webp' },
      },
      {
        url: '/images/page-public-auth-independent-cache?w=640&token=junk',
        query: { w: '640', token: 'junk' },
        headers: { accept: 'image/webp' },
      },
      {
        url: '/images/page-public-auth-independent-cache?w=640',
        query: { w: '640' },
        headers: {
          accept: 'image/webp',
          authorization: 'Bearer junk',
        },
      },
      {
        url: '/images/page-public-auth-independent-cache?w=640',
        query: { w: '640' },
        headers: {
          accept: 'image/webp',
          cookie: 'letter_archive_image_session=junk',
        },
      },
    ];

    const responses = [];
    for (const request of requests) {
      responses.push(await invokeRouter(imagesRouter, {
        method: 'GET',
        path: '/images/page-public-auth-independent-cache',
        ...request,
      }));
    }

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200]);
    expect(responses.slice(1).map((response) => response.headers['cache-control'])).toEqual([
      'private, no-store',
      'private, no-store',
      'private, no-store',
    ]);
    expect(sharpMock).toHaveBeenCalledTimes(1);
    expect(verifyImageSessionTokenMock).not.toHaveBeenCalled();
    expect(adminUsersFindFirstMock).not.toHaveBeenCalled();
  });

  it('invalidates resized cache entries when a forced replacement keeps the page id', async () => {
    findFirstMock
      .mockResolvedValueOnce({
        id: 'page-replaced-cache',
        checksumSha256: 'checksum-original',
        storagePath: 'collections/009/original/page.jpg',
        originalFilename: 'page.jpg',
        letter: catalogueLetter(),
      })
      .mockResolvedValueOnce({
        id: 'page-replaced-cache',
        checksumSha256: 'checksum-replacement',
        storagePath: 'collections/009/replacement/page.jpg',
        originalFilename: 'page.jpg',
        letter: catalogueLetter(),
      });
    getAbsoluteStoragePathMock
      .mockReturnValueOnce('/abs/storage/original/page.jpg')
      .mockReturnValueOnce('/abs/storage/replacement/page.jpg');
    statMock
      .mockResolvedValueOnce({ size: 4096, mtimeMs: 100 })
      .mockResolvedValueOnce({ size: 5120, mtimeMs: 200 });

    const original = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-replaced-cache?w=640',
      path: '/images/page-replaced-cache',
      query: { w: '640' },
      headers: { accept: 'image/webp' },
    });
    const replacement = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-replaced-cache?w=640',
      path: '/images/page-replaced-cache',
      query: { w: '640' },
      headers: { accept: 'image/webp' },
    });

    expect(original.body).toEqual(Buffer.from('original-bytes'));
    expect(replacement.body).toEqual(Buffer.from('replacement-bytes'));
    expect(sharpMock).toHaveBeenCalledTimes(2);
  });

  it('serves a supplementary image only when its group has a published catalogue root', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-cover',
      storagePath: 'collections/009/19470810/C01/cover.jpg',
      originalFilename: 'cover.jpg',
      letter: catalogueLetter({ type: 'C' }),
    });
    lettersFindFirstMock.mockResolvedValue({ id: 'letter-root' });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/cover.jpg');
    statMock.mockResolvedValue({ size: 1024 });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-cover',
      path: '/images/page-cover',
      headers: { accept: 'image/jpeg' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
    expect(lettersFindFirstMock).toHaveBeenCalledOnce();
  });

  it('does not serve an orphan supplementary image publicly', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-orphan-cover',
      storagePath: 'collections/009/19470810/C01/orphan.jpg',
      originalFilename: 'orphan.jpg',
      letter: catalogueLetter({ type: 'C' }),
    });
    lettersFindFirstMock.mockResolvedValue(undefined);

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-orphan-cover',
      path: '/images/page-orphan-cover',
      headers: { accept: 'image/jpeg' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Image not found',
      requestId: expect.any(String),
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(getAbsoluteStoragePathMock).not.toHaveBeenCalled();
  });

  it('lets an admin inspect an orphan supplementary image without making it cacheable', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-orphan-cover',
      storagePath: 'collections/009/19470810/C01/orphan.jpg',
      originalFilename: 'orphan.jpg',
      letter: catalogueLetter({ type: 'C' }),
    });
    lettersFindFirstMock.mockResolvedValue(undefined);
    verifyImageSessionTokenMock.mockReturnValue({
      userId: 'admin-1',
      email: 'admin@example.test',
      purpose: 'image-session',
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/orphan.jpg');
    statMock.mockResolvedValue({ size: 1024 });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-orphan-cover',
      path: '/images/page-orphan-cover',
      headers: { cookie: 'letter_archive_image_session=valid-image-session' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(verifyImageSessionTokenMock).toHaveBeenCalledWith('valid-image-session');
  });

  it('marks an authorized hidden image private and non-cacheable', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-hidden',
      storagePath: 'collections/009/hidden/page-hidden.jpg',
      originalFilename: 'page-hidden.jpg',
      letter: catalogueLetter({ visibility: 'HIDDEN' }),
    });
    verifyImageSessionTokenMock.mockReturnValue({
      userId: 'admin-1',
      email: 'admin@example.test',
      purpose: 'image-session',
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/page-hidden.jpg');
    statMock.mockResolvedValue({ size: 2048 });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-hidden',
      path: '/images/page-hidden',
      headers: {
        accept: 'image/jpeg',
        cookie: 'letter_archive_image_session=valid-image-session',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(verifyImageSessionTokenMock).toHaveBeenCalledWith('valid-image-session');
    expect(adminUsersFindFirstMock).toHaveBeenCalledWith({
      where: {
        op: 'eq',
        left: 'adminUsers.id',
        right: 'admin-1',
      },
      columns: { id: true },
    });
  });

  it('revokes hidden-image access when the token owner is no longer an admin', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-hidden-revoked',
      storagePath: 'collections/009/hidden/page-hidden-revoked.jpg',
      originalFilename: 'page-hidden-revoked.jpg',
      letter: catalogueLetter({ visibility: 'HIDDEN' }),
    });
    verifyImageSessionTokenMock.mockReturnValue({
      userId: 'deleted-admin',
      email: 'deleted@example.test',
      purpose: 'image-session',
    });
    adminUsersFindFirstMock.mockResolvedValue(undefined);

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-hidden-revoked',
      path: '/images/page-hidden-revoked',
      headers: {
        cookie: 'letter_archive_image_session=valid-but-revoked-session',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(adminUsersFindFirstMock).toHaveBeenCalledOnce();
    expect(getAbsoluteStoragePathMock).not.toHaveBeenCalled();
  });

  it('does not retain resized hidden images in the shared in-memory cache', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-hidden-resized',
      checksumSha256: 'hidden-checksum',
      storagePath: 'collections/009/hidden/page-hidden-resized.jpg',
      originalFilename: 'page-hidden-resized.jpg',
      letter: catalogueLetter({ visibility: 'HIDDEN' }),
    });
    verifyImageSessionTokenMock.mockReturnValue({
      userId: 'admin-1',
      email: 'admin@example.test',
      purpose: 'image-session',
    });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/page-hidden-resized.jpg');
    statMock.mockResolvedValue({ size: 2048, mtimeMs: 100 });

    const request = {
      method: 'GET',
      url: '/images/page-hidden-resized?w=640',
      path: '/images/page-hidden-resized',
      query: { w: '640' },
      headers: {
        accept: 'image/webp',
        cookie: 'letter_archive_image_session=valid-image-session',
      },
    };

    await invokeRouter(imagesRouter, request);
    await invokeRouter(imagesRouter, request);

    expect(sharpMock).toHaveBeenCalledTimes(2);
  });

  it('does not accept case-varied query credentials for a hidden image', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-hidden',
      storagePath: 'collections/009/hidden/page-hidden.jpg',
      originalFilename: 'page-hidden.jpg',
      letter: catalogueLetter({ visibility: 'HIDDEN' }),
    });
    verifyImageSessionTokenMock.mockReturnValue({
      userId: 'admin-1',
      email: 'admin@example.test',
      purpose: 'image-session',
    });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-hidden?ToKeN=reusable-admin-jwt',
      path: '/images/page-hidden',
      query: { ToKeN: 'reusable-admin-jwt' },
      headers: {
        accept: 'image/jpeg',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Image not found',
      requestId: expect.any(String),
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(verifyImageSessionTokenMock).not.toHaveBeenCalled();
    expect(getAbsoluteStoragePathMock).not.toHaveBeenCalled();
  });

  it('does not accept an API bearer for a hidden image', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-hidden',
      storagePath: 'collections/009/hidden/page-hidden.jpg',
      originalFilename: 'page-hidden.jpg',
      letter: catalogueLetter({ visibility: 'HIDDEN' }),
    });
    verifyImageSessionTokenMock.mockReturnValue({
      userId: 'admin-1',
      email: 'admin@example.test',
      purpose: 'image-session',
    });

    const response = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-hidden',
      path: '/images/page-hidden',
      headers: {
        accept: 'image/jpeg',
        authorization: 'Bearer valid-admin-api-token',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(verifyImageSessionTokenMock).not.toHaveBeenCalled();
    expect(getAbsoluteStoragePathMock).not.toHaveBeenCalled();
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
    expect(response.headers['cache-control']).toBe('private, no-store');
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
      letter: catalogueLetter(),
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
    expect(response.headers['cache-control']).toBe('private, no-store');
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
      letter: catalogueLetter(),
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
