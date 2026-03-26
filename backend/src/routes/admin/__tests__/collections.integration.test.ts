import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  getCollectionByCodeMock,
  transformLettersToDTOMock,
  getRowsMock,
  analyzeCollectionMock,
  queryCollectionsFindManyMock,
  queryLettersFindManyMock,
  executeMock,
  selectMock,
  selectFromMock,
  innerJoinMock,
  selectWhereMock,
  updateMock,
  updateSetMock,
  updateWhereMock,
  returningMock,
  eqMock,
  ascMock,
  sqlMock,
} = vi.hoisted(() => ({
  getCollectionByCodeMock: vi.fn(),
  transformLettersToDTOMock: vi.fn(),
  getRowsMock: vi.fn(),
  analyzeCollectionMock: vi.fn(),
  queryCollectionsFindManyMock: vi.fn(),
  queryLettersFindManyMock: vi.fn(),
  executeMock: vi.fn(),
  selectMock: vi.fn(),
  selectFromMock: vi.fn(),
  innerJoinMock: vi.fn(),
  selectWhereMock: vi.fn(),
  updateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  returningMock: vi.fn(),
  eqMock: vi.fn(),
  ascMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: eqMock,
  asc: ascMock,
  sql: sqlMock,
}));

vi.mock('../../../services/collections.js', () => ({
  getCollectionByCode: getCollectionByCodeMock,
}));

vi.mock('../../../dto/index.js', () => ({
  transformLettersToDTO: transformLettersToDTOMock,
}));

vi.mock('../../../services/letter-queries.js', () => ({
  getRows: getRowsMock,
}));

vi.mock('../../../ai/analyze-collection.js', () => ({
  analyzeCollection: analyzeCollectionMock,
}));

vi.mock('../../../db/index.js', () => ({
  db: {
    query: {
      collections: {
        findMany: queryCollectionsFindManyMock,
      },
      letters: {
        findMany: queryLettersFindManyMock,
      },
    },
    execute: executeMock,
    select: selectMock,
    update: updateMock,
  },
  letters: {
    id: 'letters.id',
    type: 'letters.type',
    collectionId: 'letters.collectionId',
    letterDate: 'letters.letterDate',
  },
  collections: {
    id: 'collections.id',
  },
  letterPages: {
    letterId: 'letterPages.letterId',
  },
}));

import adminCollectionsRouter from '../collections.js';

describe('admin collections route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    eqMock.mockImplementation((left, right) => ({ op: 'eq', left, right }));
    ascMock.mockImplementation((value) => ({ direction: 'asc', value }));
    sqlMock.mockImplementation((strings, ...values) => ({ strings, values }));

    innerJoinMock.mockReturnValue({
      where: selectWhereMock,
      groupBy: vi.fn().mockResolvedValue([]),
    });
    selectFromMock.mockReturnValue({
      innerJoin: innerJoinMock,
    });
    selectMock.mockReturnValue({
      from: selectFromMock,
    });

    updateSetMock.mockReturnValue({
      where: updateWhereMock,
    });
    updateWhereMock.mockReturnValue({
      returning: returningMock,
    });
    updateMock.mockReturnValue({
      set: updateSetMock,
    });

    transformLettersToDTOMock.mockImplementation((letters) => letters);
  });

  it('returns admin collection stats with page counts and verification totals', async () => {
    queryCollectionsFindManyMock.mockResolvedValueOnce([
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
    // Single batched execute for stats across all collections
    executeMock.mockResolvedValueOnce({ rows: 'all-stats' });
    getRowsMock.mockReturnValueOnce([
      {
        collection_id: 'collection-9',
        total: 4,
        published: 3,
        hidden: 1,
        uploaded: 1,
        transcribed: 1,
        metadata_ready: 1,
        reviewed: 1,
        verified: 2,
        min_date: '19470810',
        max_date: '19470812',
      },
      // collection-10 has no rows — defaults to 0
    ]);
    // Single batched groupBy for page counts across all collections
    innerJoinMock.mockReturnValue({
      groupBy: vi.fn().mockResolvedValue([
        { collectionId: 'collection-9', letterPageCount: 7, extraContentCount: 2 },
      ]),
    });

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'GET',
      url: '/',
      path: '/',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([
      {
        id: 'collection-9',
        collectionCode: '009',
        title: 'Collection Nine',
        description: 'Ninth set',
        letterCount: 4,
        publishedCount: 3,
        hiddenCount: 1,
        uploadedCount: 1,
        transcribedCount: 1,
        metadataReadyCount: 1,
        reviewedCount: 1,
        verifiedCount: 2,
        minDate: '19470810',
        maxDate: '19470812',
        letterPageCount: 7,
        extraContentCount: 2,
      },
      {
        id: 'collection-10',
        collectionCode: '010',
        title: 'Collection Ten',
        description: 'Tenth set',
        letterCount: 0,
        publishedCount: 0,
        hiddenCount: 0,
        uploadedCount: 0,
        transcribedCount: 0,
        metadataReadyCount: 0,
        reviewedCount: 0,
        verifiedCount: 0,
        minDate: null,
        maxDate: null,
        letterPageCount: 0,
        extraContentCount: 0,
      },
    ]);
  });

  it('returns a single admin collection with transformed letters', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
    });
    queryLettersFindManyMock.mockResolvedValueOnce([
      { id: 'letter-1' },
      { id: 'letter-2' },
    ]);
    transformLettersToDTOMock.mockReturnValueOnce([
      { id: 'letter-1', title: 'First letter' },
      { id: 'letter-2', title: 'Second letter' },
    ]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'GET',
      url: '/009',
      path: '/009',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      letters: [
        { id: 'letter-1', title: 'First letter' },
        { id: 'letter-2', title: 'Second letter' },
      ],
      letterCount: 2,
    });
  });

  it('injects request ids into invalid update payload responses', async () => {
    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009',
      path: '/009',
      body: {
        title: '',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid request body',
      details: expect.any(Array),
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('updates collection metadata when the payload is valid', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
    });
    returningMock.mockResolvedValueOnce([
      {
        id: 'collection-9',
        collectionCode: '009',
        title: 'Updated title',
        description: 'Updated description',
      },
    ]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009',
      path: '/009',
      body: {
        title: 'Updated title',
        description: 'Updated description',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Updated title',
      description: 'Updated description',
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      title: 'Updated title',
      description: 'Updated description',
    });
  });

  it('analyzes a collection by resolved collection id', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
    });
    analyzeCollectionMock.mockResolvedValueOnce({
      collectionId: 'collection-9',
      collectionCode: '009',
      letterCount: 4,
      analysis: {
        people: [],
        places: [],
        relationships: [],
        potentialDuplicates: [],
      },
      stats: {
        peopleFound: 0,
        placesFound: 0,
        relationshipsFound: 0,
        duplicatesFound: 0,
        entitiesCreated: 0,
        entitiesLinked: 0,
        itemsQueuedForReview: 0,
      },
      isStub: false,
    });

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'POST',
      url: '/009/analyze',
      path: '/009/analyze',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      collectionId: 'collection-9',
      collectionCode: '009',
      letterCount: 4,
      analysis: {
        people: [],
        places: [],
        relationships: [],
        potentialDuplicates: [],
      },
      stats: {
        peopleFound: 0,
        placesFound: 0,
        relationshipsFound: 0,
        duplicatesFound: 0,
        entitiesCreated: 0,
        entitiesLinked: 0,
        itemsQueuedForReview: 0,
      },
      isStub: false,
    });
    expect(analyzeCollectionMock).toHaveBeenCalledWith('collection-9');
  });
});
