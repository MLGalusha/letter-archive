import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  listCollectionsMock,
  getCollectionByCodeMock,
  transformLettersToDTOMock,
  selectMock,
  selectFromMock,
  countWhereMock,
  lettersFindManyMock,
  eqMock,
  andMock,
  ascMock,
  sqlMock,
} = vi.hoisted(() => ({
  listCollectionsMock: vi.fn(),
  getCollectionByCodeMock: vi.fn(),
  transformLettersToDTOMock: vi.fn(),
  selectMock: vi.fn(),
  selectFromMock: vi.fn(),
  countWhereMock: vi.fn(),
  lettersFindManyMock: vi.fn(),
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
}));

vi.mock('../../dto/index.js', () => ({
  transformLettersToDTO: transformLettersToDTOMock,
}));

vi.mock('../../db/index.js', () => ({
  db: {
    select: selectMock,
    query: {
      letters: {
        findMany: lettersFindManyMock,
      },
    },
  },
  letters: {
    collectionId: 'letters.collectionId',
    visibility: 'letters.visibility',
    letterDate: 'letters.letterDate',
  },
  collections: {
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

    countWhereMock.mockReturnValue({
      groupBy: vi.fn().mockResolvedValue([]),
    });
    selectFromMock.mockReturnValue({
      where: countWhereMock,
    });
    selectMock.mockReturnValue({
      from: selectFromMock,
    });

    listCollectionsMock.mockResolvedValue([
      {
        id: 'collection-9',
        collectionCode: '009',
        title: 'Collection Nine',
        description: 'Ninth set',
      },
      {
        id: 'collection-10',
        collectionCode: '010',
        title: 'Collection Ten',
        description: 'Tenth set',
      },
    ]);

    transformLettersToDTOMock.mockImplementation((letters) => letters);
  });

  it('returns public collections with published letter counts', async () => {
    // Single grouped query returns counts for all collections at once
    countWhereMock.mockReturnValue({
      groupBy: vi.fn().mockResolvedValue([
        { collectionId: 'collection-9', count: 3 },
      ]),
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
        letterCount: 3,
      },
      {
        id: 'collection-10',
        collectionCode: '010',
        title: 'Collection Ten',
        description: 'Tenth set',
        letterCount: 0,
      },
    ]);
    // Now a single batched query instead of N+1
    expect(countWhereMock).toHaveBeenCalledTimes(1);
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
      },
      {
        id: 'letter-2',
        dateRaw: '19470811',
      },
    ]);
    transformLettersToDTOMock.mockReturnValueOnce([
      { id: 'letter-1', letterDate: '1947-08-10' },
      { id: 'letter-2', letterDate: '1947-08-11' },
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
        { id: 'letter-1', letterDate: '1947-08-10' },
        { id: 'letter-2', letterDate: '1947-08-11' },
      ],
      letterCount: 2,
    });
    expect(transformLettersToDTOMock).toHaveBeenCalledWith([
      {
        id: 'letter-1',
        dateRaw: '19470810',
      },
      {
        id: 'letter-2',
        dateRaw: '19470811',
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
});
