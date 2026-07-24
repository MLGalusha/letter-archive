import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findManyMock,
  dbSelectMock,
  selectFromMock,
  selectWhereMock,
  selectForUpdateMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  dbTransactionMock,
  invalidateExtraContentSourceMock,
  invalidatePrimaryLetterSourceMock,
  invalidateRelatedPageSourceMock,
  lockCorrespondenceGroupByLetterIdMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbSelectMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectForUpdateMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  invalidateExtraContentSourceMock: vi.fn(),
  invalidatePrimaryLetterSourceMock: vi.fn(),
  invalidateRelatedPageSourceMock: vi.fn(),
  lockCorrespondenceGroupByLetterIdMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
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
  dbSelectMock.mockImplementation(() => ({
    from: selectFromMock,
  }));
  selectFromMock.mockImplementation(() => ({
    where: selectWhereMock,
  }));
  selectWhereMock.mockImplementation(() => ({
    for: selectForUpdateMock,
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
    select: dbSelectMock,
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
      storagePath: 'letterPages.storagePath',
      checksumSha256: 'letterPages.checksumSha256',
    },
    collections: {
      id: 'collections.id',
      collectionCode: 'collections.collectionCode',
    },
    letters: {
      id: 'letters.id',
      type: 'letters.type',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      typeSequence: 'letters.typeSequence',
    },
  };
});

vi.mock('../letter/page-source-invalidation.js', () => ({
  invalidateExtraContentSource: invalidateExtraContentSourceMock,
  invalidatePrimaryLetterSource: invalidatePrimaryLetterSourceMock,
  invalidateRelatedPageSource: invalidateRelatedPageSourceMock,
}));

vi.mock('../letter/correspondence-group.js', () => ({
  lockCorrespondenceGroupByLetterId: lockCorrespondenceGroupByLetterIdMock,
}));

import {
  findOrCreatePage,
  findPageByChecksum,
  getPage,
  getPagesByLetterId,
  updatePageDimensionsIfSourceCurrent,
} from '../letter-pages.js';

describe('letter pages service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(undefined);
    findManyMock.mockResolvedValue([]);
    lockCorrespondenceGroupByLetterIdMock.mockResolvedValue({
      identity: {
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
      },
      owner: {
        id: 'letter-1',
        type: 'L',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
        primarySourceRevision: 0,
      },
      members: [],
      nextSourceRevision: 1,
    });
    selectForUpdateMock.mockResolvedValue([{
      id: 'collection-1',
    }]);
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
      collectionId: 'collection-1',
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
      outcome: 'created',
      sourceChanged: true,
      primarySourceRevision: 1,
    });
    expect(insertValuesMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      width: null,
      height: null,
    });
  });

  it('keeps the committed pointer when a concurrent replacement already stored identical bytes', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/old.jpg',
      checksumSha256: 'checksum-a',
    });

    const result = await findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/updated.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      width: 1200,
      height: 1800,
      existingPagePolicy: 'replace',
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      page: expect.objectContaining({ storagePath: 'storage/old.jpg' }),
      outcome: 'unchanged',
      sourceChanged: false,
      primarySourceRevision: 0,
    });
  });

  it('does not reconcile from an observed pointer after another source wins the lock', async () => {
    const committed = {
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/newer.jpg',
      checksumSha256: 'checksum-newer',
    };
    findFirstMock.mockResolvedValue(committed);

    const result = await findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/stale.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-stale',
      existingPagePolicy: 'invalidate',
      expectedExistingSource: {
        storagePath: 'storage/observed.jpg',
        checksumSha256: 'checksum-observed',
      },
    });

    expect(result).toEqual({
      page: committed,
      outcome: 'unchanged',
      sourceChanged: false,
      primarySourceRevision: 0,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(invalidatePrimaryLetterSourceMock).not.toHaveBeenCalled();
  });

  it('reports an existing page as unchanged when replacement has no meaningful update', async () => {
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
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/existing.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      width: 1200,
      height: 1800,
      existingPagePolicy: 'replace',
    });

    expect(result).toEqual({
      page: existing,
      outcome: 'unchanged',
      sourceChanged: false,
      primarySourceRevision: 0,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a force expectation from an older locked source revision', async () => {
    lockCorrespondenceGroupByLetterIdMock.mockResolvedValueOnce({
      identity: {
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
      },
      owner: {
        id: 'letter-1',
        type: 'L',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
        primarySourceRevision: 8,
      },
      members: [],
      nextSourceRevision: 9,
    });

    await expect(findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/candidate.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-candidate',
      existingPagePolicy: 'replace',
      expectedReplacementSource: {
        pageId: 'page-existing',
        primarySourceRevision: 7,
        storagePath: 'storage/observed.jpg',
        checksumSha256: 'checksum-observed',
      },
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(findFirstMock).not.toHaveBeenCalled();
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a force expectation when the locked page pointer no longer matches', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/winner.jpg',
      checksumSha256: 'checksum-winner',
    });

    await expect(findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/candidate.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-candidate',
      existingPagePolicy: 'replace',
      expectedReplacementSource: {
        pageId: 'page-existing',
        primarySourceRevision: 0,
        storagePath: 'storage/observed.jpg',
        checksumSha256: 'checksum-observed',
      },
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(invalidatePrimaryLetterSourceMock).not.toHaveBeenCalled();
  });

  it('replaces source identity and clears stale page geometry', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/old.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-old',
      lineSegments: [{ line: 1 }],
      segmentTrustState: 'trusted',
      width: 100,
      height: 200,
    });

    await findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.png',
      checksumSha256: 'checksum-new',
      width: null,
      height: null,
      existingPagePolicy: 'replace',
    });

    expect(updateSetMock).toHaveBeenCalledWith({
      checksumSha256: 'checksum-new',
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.png',
      width: null,
      height: null,
      lineSegments: null,
      segmentTrustState: 'unverified',
      updatedAt: expect.any(Date),
    });
    expect(invalidatePrimaryLetterSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({ id: 'letter-1', type: 'L' }),
      }),
      expect.objectContaining({ update: dbUpdateMock }),
    );
  });

  it('repairs an identical missing pointer without invalidating derived content', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/missing.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      lineSegments: [{ line: 1 }],
      segmentTrustState: 'trusted',
    });
    updateReturningMock.mockResolvedValueOnce([{
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/repaired.jpg',
      checksumSha256: 'checksum-a',
    }]);

    const result = await findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/repaired.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      existingPagePolicy: 'reconcile',
    });

    expect(result).toMatchObject({
      outcome: 'relocated',
      sourceChanged: false,
      previousStoragePath: 'storage/missing.jpg',
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      storagePath: 'storage/repaired.jpg',
      checksumSha256: 'checksum-a',
    }));
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty('lineSegments');
    expect(invalidatePrimaryLetterSourceMock).not.toHaveBeenCalled();
  });

  it('commits backfilled dimensions only for the observed page source', async () => {
    updateReturningMock.mockResolvedValueOnce([{ id: 'page-existing' }]);

    await expect(updatePageDimensionsIfSourceCurrent(
      {
        pageId: 'page-existing',
        storagePath: 'storage/observed.jpg',
        checksumSha256: 'checksum-observed',
      },
      { width: 1200, height: 1800 },
    )).resolves.toBe(true);

    expect(updateSetMock).toHaveBeenCalledWith({ width: 1200, height: 1800 });
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letterPages.id', value: 'page-existing' },
        {
          kind: 'eq',
          field: 'letterPages.storagePath',
          value: 'storage/observed.jpg',
        },
        {
          kind: 'eq',
          field: 'letterPages.checksumSha256',
          value: 'checksum-observed',
        },
      ],
    });
  });

  it('uses a null-safe checksum fence and reports a lost dimension backfill', async () => {
    updateReturningMock.mockResolvedValueOnce([]);

    await expect(updatePageDimensionsIfSourceCurrent(
      {
        pageId: 'page-existing',
        storagePath: 'storage/legacy.jpg',
        checksumSha256: null,
      },
      { width: 900, height: 1400 },
    )).resolves.toBe(false);

    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letterPages.id', value: 'page-existing' },
        {
          kind: 'eq',
          field: 'letterPages.storagePath',
          value: 'storage/legacy.jpg',
        },
        { kind: 'isNull', field: 'letterPages.checksumSha256' },
      ],
    });
  });

  it('lets force reconciliation replace a concurrently changed source', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/concurrent.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-concurrent',
      lineSegments: [{ line: 1 }],
      segmentTrustState: 'trusted',
    });

    const result = await findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/forced.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-forced',
      existingPagePolicy: 'reconcile',
    });

    expect(result).toMatchObject({
      outcome: 'replaced',
      sourceChanged: true,
    });
    expect(invalidatePrimaryLetterSourceMock).toHaveBeenCalledOnce();
  });

  it('persists a changed extra-content page and invalidation in one transaction', async () => {
    const identity = {
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
    };
    lockCorrespondenceGroupByLetterIdMock.mockResolvedValue({
      identity,
      owner: {
        id: 'telegram-1',
        type: 'T',
        ...identity,
        primarySourceRevision: 0,
      },
      members: [],
      nextSourceRevision: 1,
    });

    await findOrCreatePage(
      {
        collectionId: 'collection-1',
        letterId: 'telegram-1',
        pageNumber: 1,
        storagePath: 'storage/new.jpg',
        originalFilename: '009-19470810-T01-01.jpg',
        checksumSha256: 'checksum-a',
      },
    );

    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(invalidateExtraContentSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ identity }),
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
    lockCorrespondenceGroupByLetterIdMock.mockResolvedValue({
      identity: {
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
      },
      owner: {
        id: 'telegram-1',
        type: 'T',
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
        primarySourceRevision: 0,
      },
      members: [],
      nextSourceRevision: 1,
    });

    await findOrCreatePage(
      {
        collectionId: 'collection-1',
        letterId: 'telegram-1',
        pageNumber: 1,
        storagePath: 'storage/existing.jpg',
        originalFilename: existing.originalFilename,
        checksumSha256: existing.checksumSha256,
        existingPagePolicy: 'replace',
      },
    );

    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(invalidateExtraContentSourceMock).not.toHaveBeenCalled();
  });

  it('locks the sorted correspondence group before reading or mutating its page', async () => {
    await findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      width: 1200,
      height: 1800,
    });

    expect(lockCorrespondenceGroupByLetterIdMock).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({ update: dbUpdateMock }),
    );
    expect(
      lockCorrespondenceGroupByLetterIdMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      findFirstMock.mock.invocationCallOrder[0],
    );
  });

  it.each(['P', 'V', 'A', 'D', 'N'] as const)(
    'withdraws and invalidates a changed %s page source',
    async (type) => {
      lockCorrespondenceGroupByLetterIdMock.mockResolvedValue({
        identity: {
          collectionId: 'collection-1',
          dateRaw: '19470810',
          typeSequence: 1,
        },
        owner: {
          id: 'related-1',
          type,
          collectionId: 'collection-1',
          dateRaw: '19470810',
          typeSequence: 1,
          primarySourceRevision: 4,
        },
        members: [],
        nextSourceRevision: 5,
      });

      await findOrCreatePage({
        collectionId: 'collection-1',
        letterId: 'related-1',
        pageNumber: 1,
        storagePath: 'storage/new.jpg',
        originalFilename: `009-19470810-${type}01-01.jpg`,
        checksumSha256: 'checksum-a',
      });

      expect(invalidateRelatedPageSourceMock).toHaveBeenCalledOnce();
      expect(invalidatePrimaryLetterSourceMock).not.toHaveBeenCalled();
      expect(invalidateExtraContentSourceMock).not.toHaveBeenCalled();
    },
  );

  it('rolls back the page transaction when primary invalidation fails', async () => {
    invalidatePrimaryLetterSourceMock.mockRejectedValueOnce(new Error('invalidation failed'));

    await expect(findOrCreatePage({
      collectionId: 'collection-1',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.jpg',
      checksumSha256: 'checksum-a',
      width: 1200,
      height: 1800,
    })).rejects.toThrow('invalidation failed');
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
