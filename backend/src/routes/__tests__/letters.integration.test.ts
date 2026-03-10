import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../test/express-test-utils.js';

const {
  findCollectionsMock,
  findLettersMock,
  findFirstLetterMock,
  transformLettersWithRelatedToDTOMock,
  transformLetterWithRelatedToDTOMock,
  transformLetterToDTOMock,
  transformLettersToDTOMock,
  logIfSlowMock,
  eqMock,
  andMock,
  inArrayMock,
  ilikeMock,
  ascMock,
  descMock,
  sqlMock,
} = vi.hoisted(() => ({
  findCollectionsMock: vi.fn(),
  findLettersMock: vi.fn(),
  findFirstLetterMock: vi.fn(),
  transformLettersWithRelatedToDTOMock: vi.fn(),
  transformLetterWithRelatedToDTOMock: vi.fn(),
  transformLetterToDTOMock: vi.fn(),
  transformLettersToDTOMock: vi.fn(),
  logIfSlowMock: vi.fn(),
  eqMock: vi.fn(),
  andMock: vi.fn(),
  inArrayMock: vi.fn(),
  ilikeMock: vi.fn(),
  ascMock: vi.fn(),
  descMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  and: andMock,
  inArray: inArrayMock,
  ilike: ilikeMock,
  asc: ascMock,
  desc: descMock,
  sql: sqlMock,
}));

vi.mock('../../dto/index.js', () => ({
  transformLetterToDTO: transformLetterToDTOMock,
  transformLettersToDTO: transformLettersToDTOMock,
  transformLetterWithRelatedToDTO: transformLetterWithRelatedToDTOMock,
  transformLettersWithRelatedToDTO: transformLettersWithRelatedToDTOMock,
}));

vi.mock('../../utils/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/logger.js')>();
  return {
    ...actual,
    logIfSlow: logIfSlowMock,
    TIMING_THRESHOLDS: {
      ...actual.TIMING_THRESHOLDS,
      DB_QUERY: 250,
    },
  };
});

vi.mock('../../db/index.js', () => ({
  db: {
    query: {
      collections: {
        findMany: findCollectionsMock,
      },
      letters: {
        findMany: findLettersMock,
        findFirst: findFirstLetterMock,
      },
    },
  },
  letters: {
    id: 'letters.id',
    collectionId: 'letters.collectionId',
    dateRaw: 'letters.dateRaw',
    sender: 'letters.sender',
    workflow: 'letters.workflow',
    visibility: 'letters.visibility',
    createdAt: 'letters.createdAt',
    type: 'letters.type',
  },
  collections: {
    collectionCode: 'collections.collectionCode',
  },
}));

import lettersRouter from '../letters.js';

describe('letters route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
    inArrayMock.mockImplementation((left, right) => ({ op: 'inArray', left, right }));
    ilikeMock.mockImplementation((left, right) => ({ op: 'ilike', left, right }));
    ascMock.mockImplementation((value) => ({ direction: 'asc', value }));
    descMock.mockImplementation((value) => ({ direction: 'desc', value }));
    sqlMock.mockImplementation((strings, ...values) => ({ strings, values }));

    transformLettersWithRelatedToDTOMock.mockImplementation((groups) =>
      groups.map(
        ({
          letter,
          relatedItems,
        }: {
          letter: { id: string };
          relatedItems: Array<{ id: string }>;
        }) => ({
          id: letter.id,
          relatedIds: relatedItems.map((item) => item.id),
        }),
      ),
    );
    transformLetterWithRelatedToDTOMock.mockImplementation(
      (
        letter: { id: string },
        relatedItems: Array<{ id: string }>,
      ) => ({
        id: letter.id,
        relatedIds: relatedItems.map((item) => item.id),
      }),
    );
  });

  it('groups letters by date and type sequence, then filters by the primary workflow', async () => {
    findCollectionsMock.mockResolvedValueOnce([
      {
        id: 'collection-9',
        collectionCode: '009',
      },
    ]);
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'letter-primary',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: 1,
        type: 'L',
        workflow: 'UPLOADED',
      },
      {
        id: 'letter-cover',
        collectionId: 'collection-9',
        dateRaw: '19470810',
        typeSequence: 1,
        type: 'C',
        workflow: 'REVIEWED',
      },
      {
        id: 'letter-reviewed',
        collectionId: 'collection-9',
        dateRaw: '19470811',
        typeSequence: 1,
        type: 'L',
        workflow: 'REVIEWED',
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      query: {
        collection: '9',
        workflow: 'UPLOADED',
        page: '1',
        limit: '20',
        sort: 'createdAt',
        sortOrder: 'desc',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      letters: [
        {
          id: 'letter-primary',
          relatedIds: ['letter-cover'],
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
    });
    expect(findCollectionsMock).toHaveBeenCalledTimes(1);
    expect(transformLettersWithRelatedToDTOMock).toHaveBeenCalledWith([
      {
        letter: {
          id: 'letter-primary',
          collectionId: 'collection-9',
          dateRaw: '19470810',
          typeSequence: 1,
          type: 'L',
          workflow: 'UPLOADED',
        },
        relatedItems: [
          {
            id: 'letter-cover',
            collectionId: 'collection-9',
            dateRaw: '19470810',
            typeSequence: 1,
            type: 'C',
            workflow: 'REVIEWED',
          },
        ],
      },
    ]);
  });

  it('returns an empty paginated response when the collection filter matches nothing', async () => {
    findCollectionsMock.mockResolvedValueOnce([]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters',
      path: '/letters',
      query: {
        collection: '404',
      },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      letters: [],
      page: 1,
      limit: 20,
      total: 0,
    });
    expect(findLettersMock).not.toHaveBeenCalled();
  });

  it('returns a related-letter payload for a published letter detail request', async () => {
    findFirstLetterMock.mockResolvedValueOnce({
      id: 'letter-primary',
      collectionId: 'collection-9',
      type: 'L',
      dateRaw: '19470810',
    });
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'letter-cover',
        type: 'C',
      },
      {
        id: 'letter-extra',
        type: 'E',
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/letter-primary',
      path: '/letters/letter-primary',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'letter-primary',
      relatedIds: ['letter-cover', 'letter-extra'],
    });
  });

  it('injects request ids into missing-letter responses', async () => {
    findFirstLetterMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/missing-letter',
      path: '/letters/missing-letter',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({
      error: 'Letter not found',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('returns null adjacency for published non-letter records while keeping collection totals', async () => {
    findFirstLetterMock.mockResolvedValueOnce({
      id: 'letter-cover',
      collectionId: 'collection-9',
      dateRaw: '19470810',
      createdAt: '2026-03-09T12:00:00.000Z',
    });
    findLettersMock.mockResolvedValueOnce([
      {
        id: 'letter-1',
        dateRaw: '19470810',
        createdAt: '2026-03-09T11:00:00.000Z',
      },
      {
        id: 'letter-2',
        dateRaw: '19470811',
        createdAt: '2026-03-09T12:00:00.000Z',
      },
    ]);

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/letters/letter-cover/adjacent',
      path: '/letters/letter-cover/adjacent',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      prev: null,
      next: null,
      position: null,
      total: 2,
    });
  });
});
