import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  dbTransactionMock,
  invalidateExtraContentJobForSourceChangeMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  invalidateExtraContentJobForSourceChangeMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
}));

vi.mock('../../db/index.js', () => {
  dbInsertMock.mockImplementation(() => ({
    values: insertValuesMock,
  }));
  insertValuesMock.mockImplementation(() => ({
    returning: insertReturningMock,
  }));
  dbUpdateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));
  updateWhereMock.mockImplementation(() => ({
    returning: updateReturningMock,
  }));
  const executor = {
    query: {
      letterPages: {
        findFirst: findFirstMock,
        findMany: findManyMock,
      },
    },
    insert: dbInsertMock,
    update: dbUpdateMock,
  };
  dbTransactionMock.mockImplementation(async (callback: (tx: typeof executor) => unknown) => (
    callback(executor)
  ));

  return {
    db: {
      ...executor,
      transaction: dbTransactionMock,
    },
    letterPages: {
      id: 'letterPages.id',
      letterId: 'letterPages.letterId',
      pageNumber: 'letterPages.pageNumber',
      checksumSha256: 'letterPages.checksumSha256',
    },
  };
});

vi.mock('../letters.js', () => ({
  invalidateExtraContentJobForSourceChange: invalidateExtraContentJobForSourceChangeMock,
}));

import {
  findOrCreatePage,
  findPageByChecksum,
  getPage,
  getPagesByLetterId,
} from '../letter-pages.js';

describe('letter pages service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    insertReturningMock.mockResolvedValue([
      {
        id: 'page-created',
        letterId: 'letter-1',
        pageNumber: 1,
        storagePath: 'storage/new.jpg',
        originalFilename: '009-19470810-L01-01.jpg',
        checksumSha256: 'checksum-a',
      },
    ]);
    updateReturningMock.mockResolvedValue([
      {
        id: 'page-existing',
        letterId: 'letter-1',
        pageNumber: 1,
        storagePath: 'storage/updated.jpg',
        originalFilename: '009-19470810-L01-01.jpg',
        checksumSha256: 'checksum-a',
      },
    ]);
  });

  it('creates a new page record when none exists', async () => {
    const result = await findOrCreatePage({
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
    });

    expect(result).toEqual({
      page: {
        id: 'page-created',
        letterId: 'letter-1',
        pageNumber: 1,
        storagePath: 'storage/new.jpg',
        originalFilename: '009-19470810-L01-01.jpg',
        checksumSha256: 'checksum-a',
      },
      changed: true,
    });
    expect(insertValuesMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
    });
  });

  it('updates the stored page path during force mode even when checksum is unchanged', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/old.jpg',
      checksumSha256: 'checksum-a',
    });

    const result = await findOrCreatePage({
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/updated.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      force: true,
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      checksumSha256: 'checksum-a',
      storagePath: 'storage/updated.jpg',
      updatedAt: expect.any(Date),
    });
    expect(result).toEqual({
      page: {
        id: 'page-existing',
        letterId: 'letter-1',
        pageNumber: 1,
        storagePath: 'storage/updated.jpg',
        originalFilename: '009-19470810-L01-01.jpg',
        checksumSha256: 'checksum-a',
      },
      changed: true,
    });
  });

  it('reports an existing page as unchanged when force mode has no meaningful update', async () => {
    const existing = {
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/existing.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
    };
    findFirstMock.mockResolvedValue(existing);

    const result = await findOrCreatePage({
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/existing.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      force: true,
    });

    expect(result).toEqual({ page: existing, changed: false });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('persists a changed extra-content page and invalidation in one transaction', async () => {
    const identity = {
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
    };

    await findOrCreatePage(
      {
        letterId: 'telegram-1',
        pageNumber: 1,
        storagePath: 'storage/new.jpg',
        originalFilename: '009-19470810-T01-01.jpg',
        checksumSha256: 'checksum-a',
      },
      { extraContentSource: identity },
    );

    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(invalidateExtraContentJobForSourceChangeMock).toHaveBeenCalledWith(
      identity,
      expect.objectContaining({ update: dbUpdateMock }),
    );
  });

  it('does not invalidate when the transactional page write is unchanged', async () => {
    const existing = {
      id: 'page-existing',
      letterId: 'telegram-1',
      pageNumber: 1,
      storagePath: 'storage/existing.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-a',
    };
    findFirstMock.mockResolvedValue(existing);

    await findOrCreatePage(
      {
        letterId: 'telegram-1',
        pageNumber: 1,
        storagePath: 'storage/existing.jpg',
        originalFilename: existing.originalFilename,
        checksumSha256: existing.checksumSha256,
        force: true,
      },
      {
        extraContentSource: {
          collectionId: 'collection-1',
          dateRaw: '19470810',
          typeSequence: 1,
        },
      },
    );

    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(invalidateExtraContentJobForSourceChangeMock).not.toHaveBeenCalled();
  });

  it('returns existing ordered pages for a letter', async () => {
    findManyMock.mockResolvedValue([
      { id: 'page-1', pageNumber: 1 },
      { id: 'page-2', pageNumber: 2 },
    ]);

    const result = await getPagesByLetterId('letter-2');

    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        kind: 'eq',
        field: 'letterPages.letterId',
        value: 'letter-2',
      },
      orderBy: expect.any(Function),
    });
    expect(result).toEqual([
      { id: 'page-1', pageNumber: 1 },
      { id: 'page-2', pageNumber: 2 },
    ]);
  });

  it('looks up pages by checksum', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-checksum',
      checksumSha256: 'checksum-z',
    });

    const result = await findPageByChecksum('checksum-z');

    expect(result).toEqual({
      id: 'page-checksum',
      checksumSha256: 'checksum-z',
    });
  });

  it('gets a specific page by letter id and page number', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-9',
      letterId: 'letter-9',
      pageNumber: 3,
    });

    const result = await getPage('letter-9', 3);

    expect(result).toEqual({
      id: 'page-9',
      letterId: 'letter-9',
      pageNumber: 3,
    });
  });
});
