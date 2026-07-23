import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  listCollectionsMock,
  getCollectionByCodeMock,
  resolveCollectionStartHereMock,
  getCollectionAggregationsMock,
  transformLettersWithRelatedToDTOMock,
  selectMock,
  selectFromMock,
  countWhereMock,
  executeMock,
  lettersFindManyMock,
  lettersFindFirstMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  eqMock,
  andMock,
  ascMock,
  sqlMock,
} = vi.hoisted(() => ({
  listCollectionsMock: vi.fn(),
  getCollectionByCodeMock: vi.fn(),
  resolveCollectionStartHereMock: vi.fn(),
  getCollectionAggregationsMock: vi.fn(),
  transformLettersWithRelatedToDTOMock: vi.fn(),
  selectMock: vi.fn(),
  selectFromMock: vi.fn(),
  countWhereMock: vi.fn(),
  executeMock: vi.fn(),
  lettersFindManyMock: vi.fn(),
  lettersFindFirstMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  ascMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  asc: ascMock,
  sql: sqlMock,
}));

vi.mock('../../services/collections.js', () => ({
  listCollections: listCollectionsMock,
  getCollectionByCode: getCollectionByCodeMock,
  resolveCollectionStartHere: resolveCollectionStartHereMock,
}));

vi.mock('../../dto/index.js', () => ({
  transformLettersWithRelatedToDTO: transformLettersWithRelatedToDTOMock,
}));

vi.mock('../../services/collection-profile.js', () => ({
  getCollectionAggregations: getCollectionAggregationsMock,
}));

vi.mock('../../services/public-read-model.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/public-read-model.js')>();
  return {
    ...actual,
    toPublicLetter: (letter: unknown) => letter,
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    select: selectMock,
    execute: executeMock,
    update: updateMock,
    query: {
      letters: {
        findMany: lettersFindManyMock,
        findFirst: lettersFindFirstMock,
      },
    },
  },
  letters: {
    id: 'letters.id',
    hook: 'letters.hook',
    dateRaw: 'letters.dateRaw',
    typeSequence: 'letters.typeSequence',
    collectionId: 'letters.collectionId',
    visibility: 'letters.visibility',
    letterDate: 'letters.letterDate',
    type: 'letters.type',
    metadataPublished: 'letters.metadataPublished',
  },
  collections: {
    id: 'collections.id',
    collectionCode: 'collections.collectionCode',
  },
}));

import collectionsRouter from '../collections.js';

describe('collections route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    ascMock.mockImplementation((value) => ({ direction: 'asc', value }));
    sqlMock.mockImplementation((strings, ...values) => ({ strings, values }));

    // db.select() chain — used for letter counts and date ranges
    countWhereMock.mockReturnValue({
      groupBy: vi.fn().mockResolvedValue([]),
    });
    selectFromMock.mockReturnValue({
      where: countWhereMock,
    });
    selectMock.mockReturnValue({
      from: selectFromMock,
    });

    // db.execute() — used for top senders/recipients
    executeMock.mockResolvedValue([]);
    updateWhereMock.mockResolvedValue(undefined);
    updateSetMock.mockReturnValue({
      where: updateWhereMock,
    });
    updateMock.mockReturnValue({
      set: updateSetMock,
    });

    listCollectionsMock.mockResolvedValue([
      {
        id: 'collection-9',
        collectionCode: '009',
        title: 'Collection Nine',
        description: 'Ninth set',
        createdAt: '2024-01-01T00:00:00Z',
        hook: null,
        profileStatus: 'EMPTY',
      },
      {
        id: 'collection-10',
        collectionCode: '010',
        title: 'Collection Ten',
        description: 'Tenth set',
        createdAt: '2024-02-01T00:00:00Z',
        hook: 'A brief hook',
        profileStatus: 'VERIFIED',
      },
    ]);

    transformLettersWithRelatedToDTOMock.mockImplementation(
      (enriched: Array<{ letter: { id: string }; relatedItems: unknown[] }>) =>
        enriched.map((e) => e.letter),
    );
    resolveCollectionStartHereMock.mockResolvedValue({
      letterId: null,
      reason: null,
    });
    getCollectionAggregationsMock.mockResolvedValue({
      sentimentArc: [],
      topicEvolution: [],
      correspondents: [],
      formatBreakdown: [],
    });
    lettersFindFirstMock.mockResolvedValue({ id: 'public-unit' });
  });

  it('returns public collections with published letter counts', async () => {
    // selectMock is called twice: letter counts then date ranges
    let selectCallCount = 0;
    selectMock.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // Letter counts query
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValue([
                { collectionId: 'collection-9', count: 3 },
              ]),
            }),
          }),
        };
      }
      // Date ranges query
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      };
    });

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections',
      path: '/collections',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'collection-9',
        collectionCode: '009',
        title: 'Collection Nine',
        description: 'Ninth set',
        createdAt: '2024-01-01T00:00:00Z',
        hook: null,
        letterCount: 3,
        dateRange: null,
        primarySender: null,
        primaryRecipient: null,
      },
    ]);
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('reflects collection revocation on the next list request', async () => {
    let selectCallCount = 0;
    selectMock.mockImplementation(() => {
      selectCallCount++;
      const isCountQuery = selectCallCount % 2 === 1;
      const isFirstRequest = selectCallCount <= 2;
      const rows = isCountQuery && isFirstRequest
        ? [{ collectionId: 'collection-9', count: 1 }]
        : [];
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };
    });

    const firstResponse = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections',
      path: '/collections',
      headers: { accept: 'application/json' },
    });
    const revokedResponse = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections',
      path: '/collections',
      headers: { accept: 'application/json' },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.body).toHaveLength(1);
    expect(revokedResponse.statusCode).toBe(200);
    expect(revokedResponse.body).toEqual([]);
    expect(selectMock).toHaveBeenCalledTimes(4);
  });

  it('returns a collection detail payload with transformed letters', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      createdAt: '2024-01-01T00:00:00Z',
      hook: 'Draft collection hook',
      profileStatus: 'AI_DRAFT',
    });
    lettersFindManyMock.mockResolvedValueOnce([
      {
        id: 'letter-1',
        dateRaw: '19470810',
        typeSequence: '01',
        type: 'L',
      },
      {
        id: 'letter-2',
        dateRaw: '19470811',
        typeSequence: '01',
        type: 'L',
      },
    ]);

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009',
      path: '/collections/009',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      createdAt: '2024-01-01T00:00:00Z',
      hook: null,
      letters: [
        { id: 'letter-1', dateRaw: '19470810', typeSequence: '01', type: 'L' },
        { id: 'letter-2', dateRaw: '19470811', typeSequence: '01', type: 'L' },
      ],
      letterCount: 2,
    });
    // Now uses transformLettersWithRelatedToDTO with enriched results
    expect(transformLettersWithRelatedToDTOMock).toHaveBeenCalledWith([
      {
        letter: { id: 'letter-1', dateRaw: '19470810', typeSequence: '01', type: 'L' },
        relatedItems: [],
      },
      {
        letter: { id: 'letter-2', dateRaw: '19470811', typeSequence: '01', type: 'L' },
        relatedItems: [],
      },
    ]);
  });

  it('does not expose a collection whose only published records are supplementary', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      profileStatus: 'EMPTY',
    });
    lettersFindManyMock.mockResolvedValueOnce([
      { id: 'cover-1', dateRaw: '19470810', typeSequence: '01', type: 'C' },
      { id: 'note-1', dateRaw: '19470811', typeSequence: '01', type: 'N' },
    ]);

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009',
      path: '/collections/009',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Collection not found',
      requestId: expect.any(String),
    });
    expect(transformLettersWithRelatedToDTOMock).not.toHaveBeenCalled();
  });

  it('reflects collection detail revocation on the next request', async () => {
    const collection = {
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      profileStatus: 'EMPTY',
    };
    getCollectionByCodeMock.mockResolvedValue(collection);
    lettersFindManyMock
      .mockResolvedValueOnce([
        { id: 'letter-1', dateRaw: '19470810', typeSequence: '01', type: 'L' },
      ])
      .mockResolvedValueOnce([]);

    const firstResponse = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009',
      path: '/collections/009',
      headers: { accept: 'application/json' },
    });
    const revokedResponse = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009',
      path: '/collections/009',
      headers: { accept: 'application/json' },
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(revokedResponse.statusCode).toBe(404);
    expect(lettersFindManyMock).toHaveBeenCalledTimes(2);
  });

  it('injects request ids into collection 404 responses', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/404',
      path: '/collections/404',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Collection not found',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('does not expose the admin collection-number sequence publicly', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/next-number',
      path: '/collections/next-number',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toHaveProperty('nextCollectionNumber');
  });

  it('uses the collection service featured-letter winner for the public profile', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      hook: null,
      profileNarrative: null,
      profileStatus: 'VERIFIED',
      profileStartHereLetterId: null,
      profileStartHereReason: 'Originally loaded stale reason',
      profileReadingPaths: [{
        title: 'A verified path',
        letterIds: ['letter-1', 'private-letter'],
      }],
      profileGapAnalysis: [],
      profileThemes: [{
        name: 'A verified theme',
        letterIds: ['private-letter', 'letter-1'],
      }],
    });
    resolveCollectionStartHereMock.mockResolvedValueOnce({
      letterId: 'letter-1',
      reason: 'Resolved winner reason',
    });
    lettersFindManyMock.mockResolvedValueOnce([{
      id: 'letter-1',
      collectionId: 'collection-9',
      dateRaw: '19470810',
      typeSequence: '01',
      type: 'L',
      metadataPublished: true,
    }]);
    lettersFindFirstMock
      .mockResolvedValueOnce({ id: 'public-unit' })
      .mockResolvedValueOnce({
        id: 'letter-1',
        hook: 'Start here',
        letterDate: '1947-08-10',
        dateRaw: '19470810',
        metadataPublished: true,
      });

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009/profile',
      path: '/collections/009/profile',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profileStatus: 'VERIFIED',
      profileCorrespondents: [],
      startHere: {
        letterId: 'letter-1',
        reason: 'Resolved winner reason',
        hook: 'Start here',
        date: '1947-08-10',
      },
      readingPaths: [{
        title: 'A verified path',
        letterIds: ['letter-1'],
      }],
      themes: [{
        name: 'A verified theme',
        letterIds: ['letter-1'],
      }],
    });
    expect(resolveCollectionStartHereMock).toHaveBeenCalledWith(
      'collection-9',
      {
        letterId: null,
        reason: 'Originally loaded stale reason',
      },
    );
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('removes orphan supplementary records from verified profile references', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      profileStatus: 'VERIFIED',
      profileStartHereLetterId: null,
      profileReadingPaths: [{
        title: 'A path',
        letterIds: ['root', 'attached-cover', 'orphan-cover'],
      }],
      profileThemes: [{
        name: 'A theme',
        letterIds: ['orphan-cover', 'attached-cover'],
      }],
    });
    lettersFindManyMock.mockResolvedValueOnce([
      {
        id: 'root',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: '01',
        type: 'L',
        metadataPublished: true,
      },
      {
        id: 'attached-cover',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: '01',
        type: 'C',
        metadataPublished: true,
      },
      {
        id: 'orphan-cover',
        collectionId: 'collection-9',
        dateRaw: '19470811',
        typeSequence: '01',
        type: 'C',
        metadataPublished: true,
      },
    ]);

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009/profile',
      path: '/collections/009/profile',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      readingPaths: [{ title: 'A path', letterIds: ['root', 'attached-cover'] }],
      themes: [{ name: 'A theme', letterIds: ['attached-cover'] }],
    });
  });

  it('does not expose draft collection-profile content', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      hook: 'Private generated hook',
      profileNarrative: 'Private generated narrative',
      profileStatus: 'AI_DRAFT',
      profileStartHereLetterId: 'private-letter',
      profileStartHereReason: 'Private reason',
      profileReadingPaths: [{ title: 'Private path', letterIds: ['private-letter'] }],
      profileGapAnalysis: [{ description: 'Private gap' }],
      profileThemes: [{ name: 'Private theme', letterIds: ['private-letter'] }],
      profileCorrespondents: [{ name: 'Private person', biography: 'Private bio' }],
    });

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009/profile',
      path: '/collections/009/profile',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      hook: null,
      narrative: null,
      profileStatus: 'EMPTY',
      startHere: null,
      readingPaths: [],
      gapAnalysis: [],
      themes: [],
      profileCorrespondents: [],
    });
    expect(resolveCollectionStartHereMock).not.toHaveBeenCalled();
  });

  it('does not expose a profile without a public primary catalogue unit', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      profileStatus: 'VERIFIED',
    });
    lettersFindFirstMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009/profile',
      path: '/collections/009/profile',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Collection not found',
      requestId: expect.any(String),
    });
    expect(getCollectionAggregationsMock).not.toHaveBeenCalled();
    expect(resolveCollectionStartHereMock).not.toHaveBeenCalled();
  });
});
