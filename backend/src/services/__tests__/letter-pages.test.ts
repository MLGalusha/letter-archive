import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findFirstMock,
  findLetterFirstMock,
  findManyMock,
  dbSelectMock,
  selectFromMock,
  selectWhereMock,
  selectForUpdateMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  letterInsertValuesMock,
  letterInsertOnConflictMock,
  letterInsertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  dbTransactionMock,
  invalidateExtraContentSourceMock,
  invalidatePrimaryLetterSourceMock,
  invalidateRelatedPageSourceMock,
  lockCorrespondenceGroupByIdentityMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findLetterFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbSelectMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectWhereMock: vi.fn(),
  selectForUpdateMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  letterInsertValuesMock: vi.fn(),
  letterInsertOnConflictMock: vi.fn(),
  letterInsertReturningMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  invalidateExtraContentSourceMock: vi.fn(),
  invalidatePrimaryLetterSourceMock: vi.fn(),
  invalidateRelatedPageSourceMock: vi.fn(),
  lockCorrespondenceGroupByIdentityMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  or: vi.fn((...clauses: unknown[]) => ({ kind: 'or', clauses })),
}));

vi.mock('../../db/index.js', () => {
  const letterPagesTable = {
    id: 'letterPages.id',
    letterId: 'letterPages.letterId',
    pageNumber: 'letterPages.pageNumber',
    storagePath: 'letterPages.storagePath',
    checksumSha256: 'letterPages.checksumSha256',
  };
  const lettersTable = {
    id: 'letters.id',
    type: 'letters.type',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    typeSequence: 'letters.typeSequence',
  };
  dbInsertMock.mockImplementation((table: unknown) => ({
    values: table === lettersTable ? letterInsertValuesMock : insertValuesMock,
  }));
  insertValuesMock.mockImplementation(() => ({
    returning: insertReturningMock,
  }));
  letterInsertValuesMock.mockImplementation(() => ({
    onConflictDoNothing: letterInsertOnConflictMock,
  }));
  letterInsertOnConflictMock.mockImplementation(() => ({
    returning: letterInsertReturningMock,
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
      letters: {
        findFirst: findLetterFirstMock,
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
    letterPages: letterPagesTable,
    collections: {
      id: 'collections.id',
      collectionCode: 'collections.collectionCode',
    },
    letters: lettersTable,
  };
});

vi.mock('../letter/page-source-invalidation.js', () => ({
  invalidateExtraContentSource: invalidateExtraContentSourceMock,
  invalidatePrimaryLetterSource: invalidatePrimaryLetterSourceMock,
  invalidateRelatedPageSource: invalidateRelatedPageSourceMock,
}));

vi.mock('../letter/correspondence-group.js', () => ({
  lockCorrespondenceGroupByIdentity: lockCorrespondenceGroupByIdentityMock,
}));

import {
  findDurableContentDuplicateByIdentity,
  findOrCreatePage,
  findPageByChecksum,
  findPagesByChecksums,
  getPage,
  getPagesByLetterId,
  updatePageDimensionsIfSourceCurrent,
} from '../letter-pages.js';

type CreatePageParams = Parameters<typeof findOrCreatePage>[0];

const primaryLetterIdentity: CreatePageParams['letterIdentity'] = {
  collectionId: 'collection-1',
  dateRaw: '19470810',
  type: 'L',
  typeSequence: 1,
  letterDate: '1947-08-10',
  dateConfidence: 'exact',
};

const telegramLetterIdentity: CreatePageParams['letterIdentity'] = {
  ...primaryLetterIdentity,
  type: 'T',
};

function pageParams(overrides: Partial<CreatePageParams> = {}): CreatePageParams {
  return {
    letterIdentity: primaryLetterIdentity,
    ownerObservation: { kind: 'present', letterId: 'letter-1' },
    pageNumber: 1,
    storagePath: 'storage/new.jpg',
    originalFilename: '009-19470810-L01-01.jpg',
    checksumSha256: 'checksum-a',
    ...overrides,
  };
}

function lockedMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'letter-1',
    type: 'L',
    collectionId: 'collection-1',
    dateRaw: '19470810',
    typeSequence: 1,
    primarySourceRevision: 0,
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EMPTY',
    metadataContentStatus: 'EMPTY',
    ...overrides,
  };
}

function lockedMembers(
  members = [lockedMember()],
  currentSourceRevision = 0,
) {
  return {
    identity: {
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
    },
    collection: { id: 'collection-1', highlightImageId: null },
    members,
    currentSourceRevision,
    nextSourceRevision: currentSourceRevision + 1,
  };
}

describe('letter pages service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(undefined);
    findLetterFirstMock.mockResolvedValue({
      id: 'letter-1',
      type: 'L',
      collectionId: 'collection-1',
      dateRaw: '19470810',
      typeSequence: 1,
      primarySourceRevision: 0,
      visibility: 'HIDDEN',
      transcriptPublished: false,
      metadataPublished: false,
      transcriptStatus: 'EMPTY',
      metadataContentStatus: 'EMPTY',
    });
    findManyMock.mockResolvedValue([]);
    lockCorrespondenceGroupByIdentityMock.mockResolvedValue(lockedMembers());
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
    letterInsertReturningMock.mockResolvedValue([]);
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
    const result = await findOrCreatePage(pageParams());

    expect(result).toEqual({
      letter: expect.objectContaining({ id: 'letter-1' }),
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

  it('creates a missing correspondence member and its first page in one transaction', async () => {
    const primaryMember = lockedMember({
      id: 'letter-primary',
      primarySourceRevision: 3,
    });
    const createdTelegram = {
      ...primaryMember,
      id: 'telegram-created',
      type: 'T' as const,
      letterDate: '1947-08-10',
      dateConfidence: 'exact' as const,
    };
    lockCorrespondenceGroupByIdentityMock.mockResolvedValueOnce(
      lockedMembers([primaryMember], 3),
    );
    letterInsertReturningMock.mockResolvedValueOnce([createdTelegram]);
    insertReturningMock.mockResolvedValueOnce([{
      id: 'telegram-page',
      letterId: 'telegram-created',
      pageNumber: 1,
      storagePath: 'storage/telegram.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-telegram',
    }]);
    findLetterFirstMock.mockResolvedValueOnce({
      ...createdTelegram,
      primarySourceRevision: 4,
    });

    const result = await findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'absent' },
      storagePath: 'storage/telegram.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-telegram',
    }));

    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(letterInsertValuesMock).toHaveBeenCalledWith({
      collectionId: 'collection-1',
      dateRaw: '19470810',
      type: 'T',
      typeSequence: 1,
      letterDate: '1947-08-10',
      dateConfidence: 'exact',
      primarySourceRevision: 3,
    });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      letterId: 'telegram-created',
      pageNumber: 1,
    }));
    expect(invalidateExtraContentSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: expect.objectContaining({
          id: 'telegram-created',
          primarySourceRevision: 3,
        }),
        members: expect.arrayContaining([
          expect.objectContaining({ id: 'letter-primary' }),
          expect.objectContaining({ id: 'telegram-created' }),
        ]),
        nextSourceRevision: 4,
      }),
      expect.objectContaining({ update: dbUpdateMock }),
    );
    expect(result).toMatchObject({
      letter: { id: 'telegram-created', primarySourceRevision: 4 },
      page: { id: 'telegram-page', letterId: 'telegram-created' },
      outcome: 'created',
      sourceChanged: true,
      primarySourceRevision: 4,
    });
  });

  it('rejects a present owner observation when that member disappeared under the lock', async () => {
    lockCorrespondenceGroupByIdentityMock.mockResolvedValueOnce(lockedMembers([]));

    await expect(findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'present', letterId: 'telegram-deleted' },
      storagePath: 'storage/telegram.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-telegram',
    }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'SOURCE_REVISION_CHANGED',
    });

    expect(letterInsertValuesMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it('reuses a concurrently inserted member for a different page number', async () => {
    const winner = lockedMember({
      id: 'telegram-winner',
      type: 'T',
      primarySourceRevision: 5,
    });
    lockCorrespondenceGroupByIdentityMock.mockResolvedValueOnce(
      lockedMembers([winner], 5),
    );
    findLetterFirstMock
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce({ ...winner, primarySourceRevision: 6 });
    insertReturningMock.mockResolvedValueOnce([{
      id: 'telegram-page-2',
      letterId: 'telegram-winner',
      pageNumber: 2,
      storagePath: 'storage/telegram-2.jpg',
      originalFilename: '009-19470810-T01-02.jpg',
      checksumSha256: 'checksum-telegram-2',
    }]);

    const result = await findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'absent' },
      pageNumber: 2,
      storagePath: 'storage/telegram-2.jpg',
      originalFilename: '009-19470810-T01-02.jpg',
      checksumSha256: 'checksum-telegram-2',
    }));

    expect(letterInsertValuesMock).not.toHaveBeenCalled();
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      letterId: 'telegram-winner',
      pageNumber: 2,
    }));
    expect(result).toMatchObject({
      letter: { id: 'telegram-winner', primarySourceRevision: 6 },
      page: { pageNumber: 2 },
      primarySourceRevision: 6,
    });
  });

  it('reloads and reuses the identity winner when the member insert conflicts', async () => {
    const winner = lockedMember({
      id: 'telegram-winner',
      type: 'T',
      primarySourceRevision: 2,
    });
    lockCorrespondenceGroupByIdentityMock.mockResolvedValueOnce(
      lockedMembers([], 2),
    );
    letterInsertReturningMock.mockResolvedValueOnce([]);
    findLetterFirstMock
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce({ ...winner, primarySourceRevision: 3 });
    insertReturningMock.mockResolvedValueOnce([{
      id: 'telegram-page',
      letterId: 'telegram-winner',
      pageNumber: 1,
      storagePath: 'storage/telegram.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-telegram',
    }]);

    const result = await findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'absent' },
      storagePath: 'storage/telegram.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-telegram',
    }));

    expect(letterInsertOnConflictMock).toHaveBeenCalledWith({
      target: [
        'letters.collectionId',
        'letters.dateRaw',
        'letters.type',
        'letters.typeSequence',
      ],
    });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      letterId: 'telegram-winner',
    }));
    expect(result).toMatchObject({
      letter: { id: 'telegram-winner', primarySourceRevision: 3 },
      page: { letterId: 'telegram-winner' },
      primarySourceRevision: 3,
    });
  });

  it('reuses the committed same-page winner without another insert or invalidation', async () => {
    const winner = lockedMember({
      id: 'telegram-winner',
      type: 'T',
      primarySourceRevision: 5,
    });
    const winningPage = {
      id: 'telegram-page-1',
      letterId: 'telegram-winner',
      pageNumber: 1,
      storagePath: 'storage/winner.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-winner',
    };
    lockCorrespondenceGroupByIdentityMock.mockResolvedValueOnce(
      lockedMembers([winner], 5),
    );
    findLetterFirstMock.mockResolvedValueOnce(winner);
    findFirstMock.mockResolvedValueOnce(winningPage);

    const result = await findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'absent' },
      storagePath: 'storage/candidate.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-candidate',
      existingPagePolicy: 'keep',
    }));

    expect(letterInsertValuesMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(invalidateExtraContentSourceMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      letter: { id: 'telegram-winner' },
      page: winningPage,
      outcome: 'unchanged',
      primarySourceRevision: 5,
    });
  });

  it('propagates invalidation failure after staging the new member and page', async () => {
    const created = lockedMember({
      id: 'telegram-created',
      type: 'T',
    });
    lockCorrespondenceGroupByIdentityMock.mockResolvedValueOnce(lockedMembers([]));
    letterInsertReturningMock.mockResolvedValueOnce([created]);
    invalidateExtraContentSourceMock.mockRejectedValueOnce(
      new Error('invalidation failed'),
    );

    await expect(findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'absent' },
      storagePath: 'storage/telegram.jpg',
      originalFilename: '009-19470810-T01-01.jpg',
      checksumSha256: 'checksum-telegram',
    }))).rejects.toThrow('invalidation failed');

    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(letterInsertValuesMock).toHaveBeenCalledOnce();
    expect(insertValuesMock).toHaveBeenCalledOnce();
  });

  it('keeps the committed pointer when a concurrent replacement already stored identical bytes', async () => {
    findFirstMock.mockResolvedValue({
      id: 'page-existing',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/old.jpg',
      checksumSha256: 'checksum-a',
    });

    const result = await findOrCreatePage(pageParams({
      storagePath: 'storage/updated.jpg',
      width: 1200,
      height: 1800,
      existingPagePolicy: 'replace',
    }));

    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      letter: expect.objectContaining({ id: 'letter-1' }),
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

    const result = await findOrCreatePage(pageParams({
      storagePath: 'storage/stale.jpg',
      checksumSha256: 'checksum-stale',
      existingPagePolicy: 'invalidate',
      expectedExistingSource: {
        storagePath: 'storage/observed.jpg',
        checksumSha256: 'checksum-observed',
      },
    }));

    expect(result).toEqual({
      letter: expect.objectContaining({ id: 'letter-1' }),
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

    const result = await findOrCreatePage(pageParams({
      storagePath: 'storage/existing.jpg',
      width: 1200,
      height: 1800,
      existingPagePolicy: 'replace',
    }));

    expect(result).toEqual({
      letter: expect.objectContaining({ id: 'letter-1' }),
      page: existing,
      outcome: 'unchanged',
      sourceChanged: false,
      primarySourceRevision: 0,
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a force expectation from an older locked source revision', async () => {
    lockCorrespondenceGroupByIdentityMock.mockResolvedValueOnce(
      lockedMembers([lockedMember({ primarySourceRevision: 8 })], 8),
    );

    await expect(findOrCreatePage(pageParams({
      storagePath: 'storage/candidate.jpg',
      checksumSha256: 'checksum-candidate',
      existingPagePolicy: 'replace',
      expectedReplacementSource: {
        pageId: 'page-existing',
        primarySourceRevision: 7,
        storagePath: 'storage/observed.jpg',
        checksumSha256: 'checksum-observed',
      },
    }))).rejects.toMatchObject({
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

    await expect(findOrCreatePage(pageParams({
      storagePath: 'storage/candidate.jpg',
      checksumSha256: 'checksum-candidate',
      existingPagePolicy: 'replace',
      expectedReplacementSource: {
        pageId: 'page-existing',
        primarySourceRevision: 0,
        storagePath: 'storage/observed.jpg',
        checksumSha256: 'checksum-observed',
      },
    }))).rejects.toMatchObject({
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
      pageLayout: { schemaVersion: 2 },
      pageLayoutChecksumSha256: 'a'.repeat(64),
      lineSegments: [{ line: 1 }],
      segmentTrustState: 'trusted',
      width: 100,
      height: 200,
    });

    await findOrCreatePage(pageParams({
      originalFilename: '009-19470810-L01-01.png',
      checksumSha256: 'checksum-new',
      width: null,
      height: null,
      existingPagePolicy: 'replace',
    }));

    expect(updateSetMock).toHaveBeenCalledWith({
      checksumSha256: 'checksum-new',
      storagePath: 'storage/new.jpg',
      originalFilename: '009-19470810-L01-01.png',
      width: null,
      height: null,
      pageLayout: null,
      pageLayoutChecksumSha256: null,
      lineSegments: null,
      geometryRevision: 0,
      geometryChecksumSha256: null,
      segmentTrustState: 'unverified',
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      geometryApprovedBy: null,
      geometryApprovedAt: null,
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

    const result = await findOrCreatePage(pageParams({
      storagePath: 'storage/repaired.jpg',
      existingPagePolicy: 'reconcile',
    }));

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
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty('pageLayout');
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'pageLayoutChecksumSha256',
    );
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

    const result = await findOrCreatePage(pageParams({
      storagePath: 'storage/forced.jpg',
      checksumSha256: 'checksum-forced',
      existingPagePolicy: 'reconcile',
    }));

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
    lockCorrespondenceGroupByIdentityMock.mockResolvedValue(
      lockedMembers([lockedMember({ id: 'telegram-1', type: 'T' })]),
    );

    await findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'present', letterId: 'telegram-1' },
      originalFilename: '009-19470810-T01-01.jpg',
    }));

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
    lockCorrespondenceGroupByIdentityMock.mockResolvedValue(
      lockedMembers([lockedMember({ id: 'telegram-1', type: 'T' })]),
    );

    await findOrCreatePage(pageParams({
      letterIdentity: telegramLetterIdentity,
      ownerObservation: { kind: 'present', letterId: 'telegram-1' },
      storagePath: 'storage/existing.jpg',
      originalFilename: existing.originalFilename,
      checksumSha256: existing.checksumSha256,
      existingPagePolicy: 'replace',
    }));

    expect(dbTransactionMock).toHaveBeenCalledOnce();
    expect(invalidateExtraContentSourceMock).not.toHaveBeenCalled();
  });

  it('locks the sorted correspondence group before reading or mutating its page', async () => {
    await findOrCreatePage(pageParams({
      width: 1200,
      height: 1800,
    }));

    expect(lockCorrespondenceGroupByIdentityMock).toHaveBeenCalled();
    expect(
      lockCorrespondenceGroupByIdentityMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      findFirstMock.mock.invocationCallOrder[0],
    );
  });

  it.each(['P', 'V', 'A', 'D', 'N'] as const)(
    'withdraws and invalidates a changed %s page source',
    async (type) => {
      lockCorrespondenceGroupByIdentityMock.mockResolvedValue(
        lockedMembers([
          lockedMember({
            id: 'related-1',
            type,
            primarySourceRevision: 4,
          }),
        ], 4),
      );

      await findOrCreatePage(pageParams({
        letterIdentity: { ...primaryLetterIdentity, type },
        ownerObservation: { kind: 'present', letterId: 'related-1' },
        originalFilename: `009-19470810-${type}01-01.jpg`,
      }));

      expect(invalidateRelatedPageSourceMock).toHaveBeenCalledOnce();
      expect(invalidatePrimaryLetterSourceMock).not.toHaveBeenCalled();
      expect(invalidateExtraContentSourceMock).not.toHaveBeenCalled();
    },
  );

  it('rolls back the page transaction when primary invalidation fails', async () => {
    invalidatePrimaryLetterSourceMock.mockRejectedValueOnce(new Error('invalidation failed'));

    await expect(findOrCreatePage(pageParams({
      width: 1200,
      height: 1800,
    }))).rejects.toThrow('invalidation failed');
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

  it('prefers the requested page over a cross-identity checksum match', async () => {
    const targetPage = {
      id: 'page-target',
      letterId: 'letter-1',
      pageNumber: 1,
      storagePath: 'storage/target.jpg',
      checksumSha256: 'checksum-z',
    };
    findFirstMock.mockResolvedValueOnce(targetPage);
    const isDurableSource = vi.fn().mockResolvedValue(true);

    const result = await findDurableContentDuplicateByIdentity(
      {
        collectionId: 'collection-1',
        dateRaw: '19470810',
        type: 'L',
        typeSequence: 1,
        pageNumber: 1,
      },
      {
        checksumSha256: 'checksum-z',
        isDurableSource,
      },
    );

    expect(result).toBeUndefined();
    expect(findManyMock).not.toHaveBeenCalled();
    expect(isDurableSource).not.toHaveBeenCalled();
  });

  it('returns a locked and durable cross-identity checksum owner', async () => {
    const duplicatePage = {
      id: 'page-duplicate',
      letterId: 'letter-1',
      pageNumber: 4,
      storagePath: 'storage/duplicate.jpg',
      checksumSha256: 'checksum-z',
    };
    findManyMock.mockResolvedValueOnce([duplicatePage]);
    findFirstMock.mockResolvedValue(duplicatePage);
    const isDurableSource = vi.fn().mockResolvedValue(true);

    const result = await findDurableContentDuplicateByIdentity(
      {
        dateRaw: '19500101',
        type: 'L',
        typeSequence: 1,
        pageNumber: 1,
      },
      {
        checksumSha256: 'checksum-z',
        isDurableSource,
      },
    );

    expect(result).toMatchObject({
      letter: { id: 'letter-1' },
      page: duplicatePage,
      outcome: 'unchanged',
      sourceChanged: false,
    });
    expect(lockCorrespondenceGroupByIdentityMock).toHaveBeenCalledWith(
      {
        collectionId: 'collection-1',
        dateRaw: '19470810',
        typeSequence: 1,
      },
      expect.any(Object),
    );
    expect(isDurableSource).toHaveBeenCalledWith(duplicatePage);
  });

  it('batches checksum lookups', async () => {
    findManyMock.mockResolvedValueOnce([
      { id: 'page-a', checksumSha256: 'checksum-a' },
    ]);

    const result = await findPagesByChecksums(['checksum-a', 'checksum-b']);

    expect(result).toEqual([
      { id: 'page-a', checksumSha256: 'checksum-a' },
    ]);
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        kind: 'inArray',
        field: 'letterPages.checksumSha256',
        values: ['checksum-a', 'checksum-b'],
      },
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
