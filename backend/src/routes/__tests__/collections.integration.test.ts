import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  listCollectionsMock,
  getCollectionByCodeMock,
  resolveCollectionFeaturedLetterIdMock,
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
  resolveCollectionFeaturedLetterIdMock: vi.fn(),
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
  resolveCollectionFeaturedLetterId: resolveCollectionFeaturedLetterIdMock,
}));

vi.mock('../../dto/index.js', () => ({
  transformLettersWithRelatedToDTO: transformLettersWithRelatedToDTOMock,
}));

vi.mock('../../services/collection-profile.js', () => ({
  getCollectionAggregations: getCollectionAggregationsMock,
}));

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
    collectionId: 'letters.collectionId',
    visibility: 'letters.visibility',
    letterDate: 'letters.letterDate',
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
      },
      {
        id: 'collection-10',
        collectionCode: '010',
        title: 'Collection Ten',
        description: 'Tenth set',
        createdAt: '2024-02-01T00:00:00Z',
        hook: 'A brief hook',
      },
    ]);

    transformLettersWithRelatedToDTOMock.mockImplementation(
      (enriched: Array<{ letter: { id: string }; relatedItems: unknown[] }>) =>
        enriched.map((e) => e.letter),
    );
    resolveCollectionFeaturedLetterIdMock.mockResolvedValue(null);
    getCollectionAggregationsMock.mockResolvedValue({
      sentimentArc: [],
      topicEvolution: [],
      correspondents: [],
      formatBreakdown: [],
    });
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
      {
        id: 'collection-10',
        collectionCode: '010',
        title: 'Collection Ten',
        description: 'Tenth set',
        createdAt: '2024-02-01T00:00:00Z',
        hook: 'A brief hook',
        letterCount: 0,
        dateRange: null,
        primarySender: null,
        primaryRecipient: null,
      },
    ]);
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('returns the next collection number from the highest numeric code', async () => {
    listCollectionsMock.mockResolvedValueOnce([
      { id: 'collection-9', collectionCode: '009' },
      { id: 'collection-10', collectionCode: '010' },
      { id: 'collection-x', collectionCode: 'legacy' },
    ]);

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/next-number',
      path: '/collections/next-number',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ nextCollectionNumber: 11 });
  });

  it('returns a collection detail payload with transformed letters', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
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

  it('auto-picks and persists a featured letter for the public collection profile when none is saved', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      hook: null,
      profileNarrative: null,
      profileStatus: 'EMPTY',
      profileStartHereLetterId: null,
      profileStartHereReason: '',
      profileReadingPaths: [],
      profileGapAnalysis: [],
      profileThemes: [],
    });
    resolveCollectionFeaturedLetterIdMock.mockResolvedValueOnce('letter-1');
    lettersFindFirstMock.mockResolvedValueOnce({
      id: 'letter-1',
      hook: 'Start here',
      letterDate: '1947-08-10',
      dateRaw: '19470810',
    });

    const response = await invokeRouter(collectionsRouter, {
      method: 'GET',
      url: '/collections/009/profile',
      path: '/collections/009/profile',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profileStatus: 'EMPTY',
      profileCorrespondents: [],
      startHere: {
        letterId: 'letter-1',
        reason: '',
        hook: 'Start here',
        date: '1947-08-10',
      },
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      profileStartHereLetterId: 'letter-1',
    });
  });
});
