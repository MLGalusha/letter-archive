import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  getCollectionByCodeMock,
  resolveCollectionFeaturedLetterIdMock,
  transformLettersWithRelatedToDTOMock,
  getRowsMock,
  analyzeCollectionMock,
  propagateNameMock,
  commitDirectIdentityFieldMock,
  syncLetterParticipantsFromMetadataMock,
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
  andMock,
  eqMock,
  ascMock,
  sqlMock,
} = vi.hoisted(() => ({
  getCollectionByCodeMock: vi.fn(),
  resolveCollectionFeaturedLetterIdMock: vi.fn(),
  transformLettersWithRelatedToDTOMock: vi.fn(),
  getRowsMock: vi.fn(),
  analyzeCollectionMock: vi.fn(),
  propagateNameMock: vi.fn(),
  commitDirectIdentityFieldMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
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
  andMock: vi.fn(),
  eqMock: vi.fn(),
  ascMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  and: andMock,
  eq: eqMock,
  asc: ascMock,
  sql: sqlMock,
}));

vi.mock('../../../services/collections.js', () => ({
  getCollectionByCode: getCollectionByCodeMock,
  resolveCollectionFeaturedLetterId: resolveCollectionFeaturedLetterIdMock,
}));

vi.mock('../../../dto/index.js', () => ({
  transformLettersWithRelatedToDTO: transformLettersWithRelatedToDTOMock,
}));

vi.mock('../../../services/letter-queries.js', () => ({
  getRows: getRowsMock,
}));

vi.mock('../../../ai/analyze-collection.js', () => ({
  analyzeCollection: analyzeCollectionMock,
}));

vi.mock('../../../services/name-propagation.js', () => ({
  propagateName: propagateNameMock,
  commitDirectIdentityField: commitDirectIdentityFieldMock,
  isIdentityRevisionConflict: (error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    const status = 'status' in error ? error.status : undefined;
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    return status === 409 || statusCode === 409;
  },
  observeIdentityField: (
    source: { sender: string | null; recipient: string | null; metadataRevision: number; updatedAt: Date },
    field: 'sender' | 'recipient',
  ) => ({
    value: source[field],
    metadataRevision: source.metadataRevision,
    updatedAt: source.updatedAt,
  }),
}));

vi.mock('../../../services/entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
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
    sender: 'letters.sender',
    recipient: 'letters.recipient',
    metadataRevision: 'letters.metadataRevision',
    updatedAt: 'letters.updatedAt',
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
    andMock.mockImplementation((...conditions) => ({ op: 'and', conditions }));
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

    transformLettersWithRelatedToDTOMock.mockImplementation((groups: Array<{ letter: unknown }>) =>
      groups.map(({ letter }) => letter),
    );
    resolveCollectionFeaturedLetterIdMock.mockResolvedValue(null);
    propagateNameMock.mockResolvedValue(undefined);
    syncLetterParticipantsFromMetadataMock.mockResolvedValue(undefined);
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
    executeMock
      .mockResolvedValueOnce({ rows: 'all-stats' })
      .mockResolvedValueOnce({ rows: 'type-counts' });
    getRowsMock
      .mockReturnValueOnce([
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
          min_date_specific: '19470810',
          max_date_specific: '19470812',
        },
        // collection-10 has no rows — defaults to 0
      ])
      .mockReturnValueOnce([
        { collection_id: 'collection-9', type: 'L', cnt: 2 },
        { collection_id: 'collection-9', type: 'C', cnt: 1 },
        { collection_id: 'collection-9', type: 'P', cnt: 1 },
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
        minDateSpecific: true,
        maxDateSpecific: true,
        letterPageCount: 7,
        extraContentCount: 2,
        typeCounts: {
          letter: 2,
          photo: 1,
          cover: 1,
          telegram: 0,
          card: 0,
          ephemera: 0,
          voice: 0,
          article: 0,
          diary: 0,
        },
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
        minDateSpecific: false,
        maxDateSpecific: false,
        letterPageCount: 0,
        extraContentCount: 0,
        typeCounts: {
          letter: 0,
          photo: 0,
          cover: 0,
          telegram: 0,
          card: 0,
          ephemera: 0,
          voice: 0,
          article: 0,
          diary: 0,
        },
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
      { id: 'letter-1', dateRaw: '19470810', typeSequence: '01', type: 'L' },
      { id: 'letter-2', dateRaw: '19470810', typeSequence: '01', type: 'C' },
      { id: 'letter-3', dateRaw: '19470811', typeSequence: '01', type: 'L' },
    ]);
    transformLettersWithRelatedToDTOMock.mockReturnValueOnce([
      { id: 'letter-1', title: 'First letter' },
      { id: 'letter-3', title: 'Second letter' },
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
      profileStartHereLetterId: null,
      profileCorrespondents: [],
      letters: [
        { id: 'letter-1', title: 'First letter' },
        { id: 'letter-3', title: 'Second letter' },
      ],
      letterCount: 2,
    });
    expect(transformLettersWithRelatedToDTOMock).toHaveBeenCalledWith([
      {
        letter: { id: 'letter-1', dateRaw: '19470810', typeSequence: '01', type: 'L' },
        relatedItems: [
          { id: 'letter-2', dateRaw: '19470810', typeSequence: '01', type: 'C' },
        ],
      },
      {
        letter: { id: 'letter-3', dateRaw: '19470811', typeSequence: '01', type: 'L' },
        relatedItems: [],
      },
    ]);
  });

  it('persists an auto-picked featured letter when the saved selection is missing', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      profileStartHereLetterId: null,
    });
    queryLettersFindManyMock.mockResolvedValueOnce([
      { id: 'letter-1', dateRaw: '19470810', typeSequence: '01', type: 'L' },
    ]);
    transformLettersWithRelatedToDTOMock.mockReturnValueOnce([
      { id: 'letter-1', title: 'First letter' },
    ]);
    resolveCollectionFeaturedLetterIdMock.mockResolvedValueOnce('letter-1');

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'GET',
      url: '/009',
      path: '/009',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profileStartHereLetterId: 'letter-1',
      profileCorrespondents: [],
      letterCount: 1,
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      profileStartHereLetterId: 'letter-1',
    });
  });

  it('renames a correspondent across matching letters in a collection only', async () => {
    const observedAt = new Date('2026-07-17T12:00:00.000Z');
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
    });
    queryLettersFindManyMock.mockResolvedValueOnce([
      { id: 'letter-1', sender: 'Jimmie', recipient: 'Molly', metadataRevision: 1, updatedAt: observedAt },
      { id: 'letter-2', sender: 'Jimmie', recipient: 'Molly', metadataRevision: 2, updatedAt: observedAt },
      { id: 'letter-3', sender: 'Someone Else', recipient: 'Molly', metadataRevision: 3, updatedAt: observedAt },
    ]);
    propagateNameMock
      .mockResolvedValueOnce({
        letter: {
          id: 'letter-1',
          sender: 'Jimmy',
          recipient: 'Molly',
          metadataRevision: 2,
          updatedAt: new Date('2026-07-17T12:01:00.000Z'),
        },
        fieldsUpdated: ['sender'],
      })
      .mockResolvedValueOnce({
        letter: {
          id: 'letter-2',
          sender: 'Jimmy',
          recipient: 'Molly',
          metadataRevision: 3,
          updatedAt: new Date('2026-07-17T12:01:00.000Z'),
        },
        fieldsUpdated: ['sender'],
      });

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PATCH',
      url: '/009/correspondents',
      path: '/009/correspondents',
      body: {
        oldName: 'Jimmie',
        newName: 'Jimmy',
        roles: ['sender'],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      updatedCount: 2,
      message: 'Updated 2 letters',
    });
    expect(propagateNameMock).toHaveBeenCalledTimes(2);
    expect(propagateNameMock).toHaveBeenNthCalledWith(1, {
      letterId: 'letter-1',
      field: 'sender',
      oldName: 'Jimmie',
      newName: 'Jimmy',
      observed: {
        value: 'Jimmie',
        metadataRevision: 1,
        updatedAt: observedAt,
      },
    });
    expect(propagateNameMock).toHaveBeenNthCalledWith(2, {
      letterId: 'letter-2',
      field: 'sender',
      oldName: 'Jimmie',
      newName: 'Jimmy',
      observed: {
        value: 'Jimmie',
        metadataRevision: 2,
        updatedAt: observedAt,
      },
    });
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenNthCalledWith(1, {
      letterId: 'letter-1',
      sender: 'Jimmy',
    });
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenNthCalledWith(2, {
      letterId: 'letter-2',
      sender: 'Jimmy',
    });
  });

  it('does not turn a name-propagation revision conflict into a stale fallback update', async () => {
    const updatedAt = new Date('2026-07-17T12:00:00.000Z');
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
    });
    queryLettersFindManyMock.mockResolvedValueOnce([{
      id: 'letter-1',
      sender: 'Jimmie',
      recipient: 'Molly',
      metadataRevision: 4,
      updatedAt,
    }]);
    propagateNameMock.mockRejectedValueOnce(Object.assign(
      new Error('Metadata changed during name propagation'),
      { status: 409 },
    ));

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PATCH',
      url: '/009/correspondents',
      path: '/009/correspondents',
      body: {
        oldName: 'Jimmie',
        newName: 'Jimmy',
        roles: ['sender'],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(updateMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('guards the non-conflict fallback with the observed metadata revision', async () => {
    const updatedAt = new Date('2026-07-17T12:00:00.000Z');
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
    });
    queryLettersFindManyMock.mockResolvedValueOnce([{
      id: 'letter-1',
      sender: 'Jimmie',
      recipient: 'Molly',
      metadataRevision: 4,
      updatedAt,
    }]);
    propagateNameMock.mockRejectedValueOnce(new Error('Unexpected propagation failure'));
    commitDirectIdentityFieldMock.mockRejectedValueOnce(Object.assign(
      new Error('Metadata changed during identity update'),
      { status: 409 },
    ));

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PATCH',
      url: '/009/correspondents',
      path: '/009/correspondents',
      body: {
        oldName: 'Jimmie',
        newName: 'Jimmy',
        roles: ['sender'],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(commitDirectIdentityFieldMock).toHaveBeenCalledWith({
      letter: {
        id: 'letter-1',
        sender: 'Jimmie',
        recipient: 'Molly',
        metadataRevision: 4,
        updatedAt,
      },
      field: 'sender',
      value: 'Jimmy',
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
  });

  it('chains a second role from the first committed revision and never syncs a failed role', async () => {
    const initialAt = new Date('2026-07-17T12:00:00.000Z');
    const senderCommittedAt = new Date('2026-07-17T12:01:00.000Z');
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
    });
    queryLettersFindManyMock.mockResolvedValueOnce([{
      id: 'letter-1',
      sender: 'Jimmie',
      recipient: 'Jimmie',
      metadataRevision: 4,
      updatedAt: initialAt,
    }]);
    propagateNameMock
      .mockResolvedValueOnce({
        letter: {
          id: 'letter-1',
          sender: 'Jimmy',
          recipient: 'Jimmie',
          metadataRevision: 5,
          updatedAt: senderCommittedAt,
        },
        fieldsUpdated: ['sender'],
      })
      .mockRejectedValueOnce(Object.assign(new Error('Recipient changed'), { status: 409 }));

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PATCH',
      url: '/009/correspondents',
      path: '/009/correspondents',
      body: {
        oldName: 'Jimmie',
        newName: 'Jimmy',
        roles: ['sender', 'recipient'],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(propagateNameMock).toHaveBeenNthCalledWith(2, {
      letterId: 'letter-1',
      field: 'recipient',
      oldName: 'Jimmie',
      newName: 'Jimmy',
      observed: {
        value: 'Jimmie',
        metadataRevision: 5,
        updatedAt: senderCommittedAt,
      },
    });
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledTimes(1);
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      sender: 'Jimmy',
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
