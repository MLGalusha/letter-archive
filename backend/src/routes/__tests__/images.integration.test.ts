import { EventEmitter } from 'node:events';
import http from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  previewReadMock,
  previewWriteMock,
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
  previewReadMock: vi.fn(),
  previewWriteMock: vi.fn(),
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

vi.mock('../../services/image-variant-store.js', () => ({
  ImageVariantStore: class {
    read = previewReadMock;
    write = previewWriteMock;
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

import imagesRouter, { createImagesRouter } from '../images.js';
import { ImageTransformScheduler } from '../../services/image-transform-scheduler.js';
import { requestLogger } from '../../middleware/request-logger.js';

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
    previewReadMock.mockReset().mockResolvedValue({ status: 'miss' });
    previewWriteMock.mockReset().mockResolvedValue('busy');
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
    const originalPage = {
      id: 'page-replaced-cache', checksumSha256: 'checksum-original',
      storagePath: 'collections/009/original/page.jpg', originalFilename: 'page.jpg', letter: catalogueLetter(),
    };
    const replacementPage = {
      ...originalPage, checksumSha256: 'checksum-replacement', storagePath: 'collections/009/replacement/page.jpg',
    };
    findFirstMock.mockResolvedValue(originalPage);
    getAbsoluteStoragePathMock
      .mockReturnValueOnce('/abs/storage/original/page.jpg')
      .mockReturnValueOnce('/abs/storage/replacement/page.jpg');
    statMock.mockResolvedValue({ size: 4096, mtimeMs: 100 });

    const original = await invokeRouter(imagesRouter, {
      method: 'GET',
      url: '/images/page-replaced-cache?w=640',
      path: '/images/page-replaced-cache',
      query: { w: '640' },
      headers: { accept: 'image/webp' },
    });
    findFirstMock.mockResolvedValue(replacementPage);
    statMock.mockResolvedValue({ size: 5120, mtimeMs: 200 });
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

  it('coalesces public misses but rechecks each caller after publication changes', async () => {
    const page = {
      id: 'page-shared-revocation', checksumSha256: 'same', storagePath: 'shared-revocation.jpg',
      originalFilename: 'shared-revocation.jpg', letter: catalogueLetter(),
    };
    findFirstMock.mockResolvedValue(page);
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/shared-revocation.jpg');
    statMock.mockResolvedValue({ size: 4096, mtimeMs: 100 });
    let complete!: (buffer: Buffer) => void;
    const pending = new Promise<Buffer>((resolve) => { complete = resolve; });
    const implementation = sharpMock.getMockImplementation()!;
    sharpMock.mockImplementation((path: string) => {
      const pipeline = implementation(path);
      pipeline.toBuffer.mockReturnValue(pending);
      return pipeline;
    });
    verifyImageSessionTokenMock.mockReturnValue({ userId: 'admin-1', purpose: 'image-session' });
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 1, maxWaiters: 4 });
    const router = createImagesRouter(scheduler);
    const request = { method: 'GET', url: '/images/page-shared-revocation', query: { w: '480' } };
    const anonymous = invokeRouter(router, request);
    const admin = invokeRouter(router, { ...request, headers: { cookie: 'letter_archive_image_session=valid-image-session' } });
    await vi.waitFor(() => expect(scheduler.state.waiters).toBe(2));
    findFirstMock.mockResolvedValue({ ...page, letter: catalogueLetter({ visibility: 'HIDDEN' }) });
    complete(Buffer.from('shared bytes'));
    const [anonymousResult, adminResult] = await Promise.all([anonymous, admin]);
    expect(anonymousResult.statusCode).toBe(404);
    expect(adminResult.statusCode).toBe(200);
    expect(adminResult.body).toEqual(Buffer.from('shared bytes'));
    expect([anonymousResult, adminResult].map((response) => response.headers['cache-control']))
      .toEqual(['private, no-store', 'private, no-store']);
    expect(sharpMock).toHaveBeenCalledOnce();
    expect(findFirstMock).toHaveBeenCalledTimes(4);
    // The newly hidden output must not enter the public cache.
    findFirstMock.mockResolvedValue(page);
    await invokeRouter(router, request);
    expect(sharpMock).toHaveBeenCalledTimes(2);
  });

  it('rejects excess work without caching overload and recovers when capacity frees', async () => {
    findFirstMock.mockImplementation(({ where }) => ({
      id: where.right, storagePath: `${where.right}.jpg`, originalFilename: 'image.jpg', letter: catalogueLetter(),
    }));
    getAbsoluteStoragePathMock.mockImplementation((path) => `/abs/storage/${path}`);
    statMock.mockResolvedValue({ size: 4096, mtimeMs: 100 });
    let complete!: (buffer: Buffer) => void;
    const pending = new Promise<Buffer>((resolve) => { complete = resolve; });
    const implementation = sharpMock.getMockImplementation()!;
    sharpMock.mockImplementation((path: string) => {
      const pipeline = implementation(path);
      if (path.includes('saturation-first')) pipeline.toBuffer.mockReturnValue(pending);
      return pipeline;
    });
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 1, maxWaiters: 3 });
    const router = createImagesRouter(scheduler);
    const request = (id: string) => invokeRouter(router, { method: 'GET', url: `/images/${id}`, query: { w: '480' } });
    const first = request('saturation-first');
    const second = request('saturation-second');
    await vi.waitFor(() => expect(scheduler.state).toEqual({ active: 1, queued: 1, waiters: 2 }));
    const rejected = await request('saturation-third');
    expect(rejected.statusCode).toBe(503);
    expect(rejected.headers['retry-after']).toBe('1');
    expect(rejected.headers['cache-control']).toBe('private, no-store');
    expect(sharpMock).toHaveBeenCalledOnce();
    complete(Buffer.from('first'));
    expect((await Promise.all([first, second])).map((response) => response.statusCode)).toEqual([200, 200]);
    expect((await request('saturation-third')).statusCode).toBe(200);
    expect(scheduler.state).toEqual({ active: 0, queued: 0, waiters: 0 });
  });

  it('checks current publication before reusing a completed public cache entry', async () => {
    const page = { id: 'cached-then-hidden', storagePath: 'cached-then-hidden.jpg', originalFilename: 'image.jpg', letter: catalogueLetter() };
    findFirstMock.mockResolvedValue(page);
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/cached-then-hidden.jpg');
    statMock.mockResolvedValue({ size: 4096 });
    const request = { method: 'GET', url: '/images/cached-then-hidden', query: { w: '480' } };
    expect((await invokeRouter(imagesRouter, request)).statusCode).toBe(200);
    findFirstMock.mockResolvedValue({ ...page, letter: catalogueLetter({ visibility: 'HIDDEN' }) });
    expect((await invokeRouter(imagesRouter, request)).statusCode).toBe(404);
    expect(sharpMock).toHaveBeenCalledOnce();
  });

  it('rechecks admin membership before returning a generated hidden variant', async () => {
    findFirstMock.mockResolvedValue({ id: 'admin-revoked-during-transform', storagePath: 'admin-revoked.jpg',
      originalFilename: 'image.jpg', letter: catalogueLetter({ visibility: 'HIDDEN' }) });
    verifyImageSessionTokenMock.mockReturnValue({ userId: 'admin-1', purpose: 'image-session' });
    adminUsersFindFirstMock.mockResolvedValueOnce({ id: 'admin-1' }).mockResolvedValueOnce(null);
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/admin-revoked.jpg');
    statMock.mockResolvedValue({ size: 4096 });
    const response = await invokeRouter(imagesRouter, { method: 'GET', url: '/images/admin-revoked-during-transform',
      query: { w: '480' }, headers: { cookie: 'letter_archive_image_session=valid-image-session' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(adminUsersFindFirstMock).toHaveBeenCalledTimes(2);
    expect(sharpMock).toHaveBeenCalledOnce();
  });

  it('does not deliver or cache a source replaced during queued/generated work', async () => {
    const page = { id: 'source-changed-during-transform', checksumSha256: 'old', storagePath: 'source-changed.jpg',
      originalFilename: 'image.jpg', letter: catalogueLetter() };
    findFirstMock.mockResolvedValueOnce(page).mockResolvedValue({ ...page, checksumSha256: 'new' });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/source-changed.jpg');
    statMock.mockResolvedValue({ size: 4096 });
    const request = { method: 'GET', url: '/images/source-changed-during-transform', query: { w: '480' } };
    const changed = await invokeRouter(imagesRouter, request);
    expect(changed.statusCode).toBe(503);
    expect(changed.headers['cache-control']).toBe('private, no-store');
    expect(changed.headers['retry-after']).toBe('1');
    expect((await invokeRouter(imagesRouter, request)).statusCode).toBe(200);
    expect(sharpMock).toHaveBeenCalledTimes(2);
  });

  it('rejects bytes when the file changes without a database version change', async () => {
    findFirstMock.mockResolvedValue({ id: 'file-changed-during-transform', checksumSha256: 'same', storagePath: 'file-changed.jpg',
      originalFilename: 'image.jpg', letter: catalogueLetter() });
    getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/file-changed.jpg');
    statMock.mockResolvedValueOnce({ size: 4096, mtimeMs: 100 }).mockResolvedValue({ size: 8192, mtimeMs: 200 });
    const request = { method: 'GET', url: '/images/file-changed-during-transform', query: { w: '480' } };
    const changed = await invokeRouter(imagesRouter, request);
    expect(changed.statusCode).toBe(503);
    expect(changed.headers['cache-control']).toBe('private, no-store');
    expect((await invokeRouter(imagesRouter, request)).statusCode).toBe(200);
    expect(sharpMock).toHaveBeenCalledTimes(2);
  });

  it('removes a disconnected queued HTTP caller before starting its transform', async () => {
    findFirstMock.mockImplementation(({ where }) => ({
      id: where.right, storagePath: `${where.right}.jpg`, originalFilename: 'image.jpg', letter: catalogueLetter(),
    }));
    getAbsoluteStoragePathMock.mockImplementation((path) => `/abs/storage/${path}`);
    statMock.mockResolvedValue({ size: 4096 });
    let complete!: (buffer: Buffer) => void;
    const pending = new Promise<Buffer>((resolve) => { complete = resolve; });
    const implementation = sharpMock.getMockImplementation()!;
    sharpMock.mockImplementation((path: string) => {
      const pipeline = implementation(path);
      pipeline.toBuffer.mockReturnValue(pending);
      return pipeline;
    });
    const scheduler = new ImageTransformScheduler({ concurrency: 1, maxQueued: 1, maxWaiters: 2 });
    const app = express(); app.use(requestLogger); app.use(createImagesRouter(scheduler));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local address');
    const request = (id: string) => http.get(`http://127.0.0.1:${address.port}/images/${id}?w=480`);
    const active = request('disconnect-active');
    const activeDone = new Promise<number>((resolve, reject) => {
      active.on('error', reject);
      active.on('response', (response) => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
    });
    let queued: http.ClientRequest | undefined;
    try {
      await vi.waitFor(() => expect(scheduler.state.active).toBe(1));
      queued = request('disconnect-queued');
      queued.on('error', () => {}); // Expected socket abort, not a server failure.
      await vi.waitFor(() => expect(scheduler.state.queued).toBe(1));
      queued.destroy();
      await vi.waitFor(() => expect(scheduler.state).toEqual({ active: 1, queued: 0, waiters: 1 }));
      complete(Buffer.from('active result'));
      expect(await activeDone).toBe(200);
      expect(sharpMock).toHaveBeenCalledOnce();
      expect(scheduler.state).toEqual({ active: 0, queued: 0, waiters: 0 });
    } finally {
      queued?.destroy(); complete(Buffer.from('cleanup')); active.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

  describe('conditional resized images over real HTTP', () => {
    let server: http.Server;
    let page: { id: string; checksumSha256: string; storagePath: string; originalFilename: string; letter: ReturnType<typeof catalogueLetter> };
    let sourceStats: { size: number; mtimeMs: number };
    let sequence = 0;
    const scheduler = new ImageTransformScheduler({ concurrency: 2, maxQueued: 32, maxWaiters: 64 });

    beforeEach(async () => {
      page = { id: `conditional-${sequence++}`, checksumSha256: 'source-version-1',
        storagePath: 'collections/009/conditional.jpg', originalFilename: 'conditional.jpg', letter: catalogueLetter() };
      sourceStats = { size: 4096, mtimeMs: 100 };
      findFirstMock.mockImplementation(async () => page);
      statMock.mockImplementation(async () => sourceStats);
      getAbsoluteStoragePathMock.mockReturnValue('/abs/storage/conditional.jpg');
      const app = express();
      app.use(requestLogger, createImagesRouter(scheduler));
      server = await new Promise<http.Server>(resolve => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
      });
    });

    afterEach(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    });

    function request(headers: http.OutgoingHttpHeaders = {}, query = 'w=480', method = 'GET') {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server is not listening');
      return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: address.port,
          path: `/images/${page.id}?${query}`, method, headers: { accept: 'image/webp', ...headers } }, res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
    }

    it('returns 304 without scheduling work in a fresh module with no resized cache', async () => {
      const initial = await request();
      expect(initial.status).toBe(200);
      expect(initial.headers.etag).toMatch(/^W\/"preview-[a-f0-9]{64}"$/);
      vi.resetModules();
      const { createImagesRouter: freshRouter } = await import('../images.js');
      const freshScheduler = new ImageTransformScheduler({ concurrency: 2, maxQueued: 32, maxWaiters: 64 });
      const schedule = vi.spyOn(freshScheduler, 'schedule');
      const app = express();
      app.use(requestLogger, freshRouter(freshScheduler));
      server.removeAllListeners('request');
      server.on('request', app);
      sharpMock.mockClear();
      previewReadMock.mockClear();
      previewWriteMock.mockClear();
      const result = await request({ 'if-none-match': initial.headers.etag });
      expect(result.status).toBe(304);
      expect(result.body).toBe('');
      expect(result.headers.etag).toBe(initial.headers.etag);
      expect(result.headers.vary).toBe('Accept');
      expect(result.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
      expect(schedule).not.toHaveBeenCalled();
      expect(sharpMock).not.toHaveBeenCalled();
      const mixed = await request({
        'if-none-match': initial.headers.etag,
        'if-modified-since': 'Wed, 01 Jan 2020 00:00:00 GMT',
      });
      expect(mixed.status).toBe(304);
      expect(schedule).not.toHaveBeenCalled();
      expect(sharpMock).not.toHaveBeenCalled();
      expect(previewReadMock).not.toHaveBeenCalled();
      expect(previewWriteMock).not.toHaveBeenCalled();
    });

    it('handles weak, strong, list, wildcard and HEAD validators', async () => {
      const { headers } = await request();
      const tag = headers.etag!;
      const schedule = vi.spyOn(scheduler, 'schedule');
      schedule.mockClear();
      for (const validator of [tag, tag.slice(2), `"stale", ${tag}`, '*']) {
        const result = await request({ 'if-none-match': validator });
        expect(result.status).toBe(304);
        expect(result.body).toBe('');
      }
      expect((await request({ 'if-none-match': tag }, 'w=480', 'HEAD')).status).toBe(304);
      expect(schedule).not.toHaveBeenCalled();
    });

    it('sends the representation for stale tags and explicit no-cache requests', async () => {
      const initial = await request();
      expect((await request({ 'if-none-match': '"stale"' })).status).toBe(200);
      const result = await request({ 'if-none-match': initial.headers.etag, 'cache-control': 'no-cache' });
      expect(result.status).toBe(200);
      expect(result.body).toBe('original-bytes');
    });

    it('invalidates the validator for source identity and file stat changes', async () => {
      let previous = (await request()).headers.etag!;
      for (const change of [
        () => { page.checksumSha256 = 'source-version-2'; },
        () => { page.storagePath = 'collections/009/replacement.jpg'; },
        () => { sourceStats = { ...sourceStats, size: 8192 }; },
        () => { sourceStats = { ...sourceStats, mtimeMs: 200 }; },
      ]) {
        change();
        const result = await request({ 'if-none-match': previous });
        expect(result.status).toBe(200);
        expect(result.headers.etag).not.toBe(previous);
        previous = result.headers.etag!;
      }
    });

    it('distinguishes sizes and negotiated formats but ignores caller version hints', async () => {
      const initial = await request({}, 'w=480&v=old');
      expect((await request({ 'if-none-match': initial.headers.etag }, 'w=480&v=new')).status).toBe(304);
      const wider = await request({ 'if-none-match': initial.headers.etag }, 'w=800');
      const avif = await request({ 'if-none-match': initial.headers.etag, accept: 'image/avif,image/webp' });
      const jpeg = await request({ 'if-none-match': initial.headers.etag, accept: 'image/jpeg' });
      expect([wider.status, avif.status, jpeg.status]).toEqual([200, 200, 200]);
      expect(new Set([initial.headers.etag, wider.headers.etag, avif.headers.etag, jpeg.headers.etag]).size).toBe(4);
      expect(avif.headers['content-type']).toBe('image/avif');
      expect(jpeg.headers['content-type']).toBe('image/jpeg');
    });

    it('never returns 304 for missing, unpublished or deleted sources', async () => {
      const initial = await request();
      const conditional = { 'if-none-match': initial.headers.etag };
      page.letter = catalogueLetter({ visibility: 'HIDDEN' });
      expect((await request(conditional)).status).toBe(404);
      page.letter = catalogueLetter();
      findFirstMock.mockResolvedValueOnce(undefined);
      expect((await request(conditional)).status).toBe(404);
      statMock.mockRejectedValueOnce(new Error('ENOENT'));
      const missingFile = await request(conditional);
      expect(missingFile.status).toBe(404);
      expect(missingFile.headers['cache-control']).toBe('private, no-store');
    });

    it('invalidates an old validator after an encoder library upgrade', async () => {
      const encoder = sharpMock as typeof sharpMock & { versions?: Record<string, string> };
      try {
        encoder.versions = { sharp: 'first-encoder', vips: 'first-vips' };
        const initial = await request();
        encoder.versions = { sharp: 'next-encoder', vips: 'next-vips' };
        const upgraded = await request({ 'if-none-match': initial.headers.etag });
        expect(upgraded.status).toBe(200);
        expect(upgraded.headers.etag).not.toBe(initial.headers.etag);
      } finally {
        delete encoder.versions;
      }
    });

    it('rechecks admin authorization before revalidating a private preview', async () => {
      page.letter = catalogueLetter({ visibility: 'HIDDEN' });
      verifyImageSessionTokenMock.mockReturnValue({ userId: 'admin-1', purpose: 'image-session' });
      const cookie = 'letter_archive_image_session=valid-image-session';
      const initial = await request({ cookie });
      const conditional = { cookie, 'if-none-match': initial.headers.etag };
      expect(initial.status).toBe(200);
      const unchanged = await request(conditional);
      expect(unchanged.status).toBe(304);
      expect(unchanged.headers['cache-control']).toBe('private, no-store');
      adminUsersFindFirstMock.mockResolvedValue(null);
      expect((await request(conditional)).status).toBe(404);
    });

    it('retains private cache policy for credential-bearing conditional requests', async () => {
      const initial = await request();
      for (const headers of [
        { authorization: 'Bearer stale-token' },
        { cookie: 'letter_archive_image_session=junk' },
      ]) {
        const result = await request({ ...headers, 'if-none-match': initial.headers.etag });
        expect(result.status).toBe(304);
        expect(result.headers['cache-control']).toBe('private, no-store');
      }
      const result = await request({ 'if-none-match': initial.headers.etag }, 'w=480&token=stale-token');
      expect(result.status).toBe(304);
      expect(result.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('saved480px previews', () => {
    let sequence = 0;
    let page: { id: string; checksumSha256: string; storagePath: string; originalFilename: string; letter: ReturnType<typeof catalogueLetter> };
    const request = (width = '480', headers: Record<string, string> = {}) => invokeRouter(imagesRouter, {
      method: 'GET', url: `/images/${page.id}`, query: { w: width }, headers,
    });
    beforeEach(() => {
      page = { id: `durable-${++sequence}`, checksumSha256: 'original', storagePath: `durable-${sequence}.jpg`,
        originalFilename: 'image.jpg', letter: catalogueLetter() };
      findFirstMock.mockResolvedValue(page);
      getAbsoluteStoragePathMock.mockImplementation((path) => `/abs/storage/${path}`);
      statMock.mockResolvedValue({ size: 4096, mtimeMs: 100 });
    });

    it('serves saved bytes without entering Sharp or writing again', async () => {
      previewReadMock.mockResolvedValue({ status: 'hit', buffer: Buffer.from('saved image') });
      const response = await request();
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual(Buffer.from('saved image'));
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(sharpMock).not.toHaveBeenCalled();
      expect(previewWriteMock).not.toHaveBeenCalled();
      expect(findFirstMock).toHaveBeenCalledTimes(2);
    });

    it('reuses24 real saved files from an independent store without transforming', async () => {
      const { mkdtemp, rm } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { ImageVariantStore: RealStore } = await vi.importActual<typeof import('../../services/image-variant-store.js')>('../../services/image-variant-store.js');
      const { imageVariantIdentity } = await import('../../services/image-variant.js');
      const root = await mkdtemp(join(tmpdir(), 'route-preview-'));
      try {
        const writer = new RealStore(root);
        const pages = Array.from({ length: 24 }, (_, i) => ({ ...page, id: `${page.id}-${i}`, storagePath: `${page.id}-${i}.jpg` }));
        for (const item of pages) {
          const key = imageVariantIdentity({ pageId: item.id, ...item, size: 4096, mtimeMs: 100 }, 480, 'jpeg');
          expect(await writer.write(key, 480, 'jpeg', Buffer.from(`saved ${item.id}`))).toBe('saved');
        }
        findFirstMock.mockImplementation(({ where }) => pages.find((item) => item.id === where.right));
        const router = createImagesRouter(new ImageTransformScheduler({ concurrency: 2, maxQueued: 32, maxWaiters: 64 }), new RealStore(root));
        const responses = await Promise.all(pages.map((item) => invokeRouter(router, {
          method: 'GET', url: `/images/${item.id}`, query: { w: '480' },
        })));
        expect(responses.every((result) => result.statusCode === 200)).toBe(true);
        expect(responses.map((result) => result.body)).toEqual(pages.map((item) => Buffer.from(`saved ${item.id}`)));
        expect(sharpMock).not.toHaveBeenCalled();
      } finally { await rm(root, { recursive: true, force: true }); }
    });

    it.each(['miss', 'invalid', 'error', 'busy'] as const)('falls back safely after a %s read and failed write', async (status) => {
      previewReadMock.mockResolvedValue({ status });
      previewWriteMock.mockResolvedValue('error');
      expect((await request()).statusCode).toBe(200);
      expect(sharpMock).toHaveBeenCalledOnce();
      expect(previewWriteMock).toHaveBeenCalledOnce();
      expect(findFirstMock).toHaveBeenCalledTimes(3);
    });

    it.each(['32', '479', '640', '1600'])('does not persist unsupported width%s', async (width) => {
      expect((await request(width)).statusCode).toBe(200);
      expect(sharpMock).toHaveBeenCalledOnce();
      expect(previewReadMock).not.toHaveBeenCalled();
      expect(previewWriteMock).not.toHaveBeenCalled();
    });

    it('does not read or save hidden admin previews', async () => {
      page.letter = catalogueLetter({ visibility: 'HIDDEN' });
      verifyImageSessionTokenMock.mockReturnValue({ userId: 'admin-1', purpose: 'image-session' });
      const response = await request('480', { cookie: 'letter_archive_image_session=valid-image-session' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(previewReadMock).not.toHaveBeenCalled();
      expect(previewWriteMock).not.toHaveBeenCalled();
    });

    it.each(['read', 'write'] as const)('denies an image unpublished during the saved %s', async (stage) => {
      const hide = () => findFirstMock.mockResolvedValue({ ...page, letter: catalogueLetter({ visibility: 'HIDDEN' }) });
      if (stage === 'read') previewReadMock.mockImplementation(async () => { hide(); return { status: 'hit', buffer: Buffer.from('saved') }; });
      else previewWriteMock.mockImplementation(async () => { hide(); return 'saved'; });
      const response = await request();
      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('private, no-store');
      // A cached variant cannot bypass publication on a subsequent request either.
      expect((await request()).statusCode).toBe(404);
      expect(previewReadMock).toHaveBeenCalledOnce();
    });

    it.each(['read', 'write'] as const)('rejects a source replaced during saved %s', async (stage) => {
      const replace = () => findFirstMock.mockResolvedValue({ ...page, checksumSha256: 'replacement', storagePath: 'replacement.jpg' });
      if (stage === 'read') previewReadMock.mockImplementation(async () => { replace(); return { status: 'hit', buffer: Buffer.from('old') }; });
      else previewWriteMock.mockImplementation(async () => { replace(); return 'saved'; });
      const response = await request();
      expect(response.statusCode).toBe(503);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['retry-after']).toBe('1');
    });

    it.each(['read', 'write'] as const)('rejects a file modified during a saved %s without a database change', async (stage) => {
      const modify = () => statMock.mockResolvedValue({ size: 5000, mtimeMs: 200 });
      if (stage === 'read') previewReadMock.mockImplementation(async () => {
        modify(); return { status: 'hit', buffer: Buffer.from('old') };
      });
      else previewWriteMock.mockImplementation(async () => { modify(); return 'saved'; });
      expect((await request()).statusCode).toBe(503);
      if (stage === 'read') {
        expect(sharpMock).not.toHaveBeenCalled();
        expect(previewWriteMock).not.toHaveBeenCalled();
      }
    });
  });

});
