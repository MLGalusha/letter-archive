import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  getCollectionByCodeMock,
  resolveCollectionStartHereMock,
  resolveRepresentativeLetterIdMock,
  transformLettersWithRelatedToDTOMock,
  getRowsMock,
  propagateNameMock,
  commitDirectIdentityFieldMock,
  syncLetterParticipantsFromMetadataMock,
  generateCollectionProfileMock,
  computeCollectionProfileSourceFingerprintMock,
  applyCollectionEditorMutationMock,
  collectionIdentityFingerprintMock,
  queryCollectionsFindManyMock,
  queryLettersFindManyMock,
  queryLetterPagesFindFirstMock,
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
  resolveCollectionStartHereMock: vi.fn(),
  resolveRepresentativeLetterIdMock: vi.fn(),
  transformLettersWithRelatedToDTOMock: vi.fn(),
  getRowsMock: vi.fn(),
  propagateNameMock: vi.fn(),
  commitDirectIdentityFieldMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
  generateCollectionProfileMock: vi.fn(),
  computeCollectionProfileSourceFingerprintMock: vi.fn(),
  applyCollectionEditorMutationMock: vi.fn(),
  collectionIdentityFingerprintMock: vi.fn(),
  queryCollectionsFindManyMock: vi.fn(),
  queryLettersFindManyMock: vi.fn(),
  queryLetterPagesFindFirstMock: vi.fn(),
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
  resolveCollectionStartHere: resolveCollectionStartHereMock,
}));

vi.mock('../../../services/letters.js', () => ({
  resolveRepresentativeLetterId: resolveRepresentativeLetterIdMock,
}));

vi.mock('../../../dto/index.js', () => ({
  transformLettersWithRelatedToDTO: transformLettersWithRelatedToDTOMock,
}));

vi.mock('../../../services/letter-queries.js', () => ({
  getRows: getRowsMock,
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

vi.mock('../../../ai/generate-collection-profile.js', () => ({
  assessCollectionCompleteness: vi.fn(),
  generateCollectionProfile: generateCollectionProfileMock,
}));

vi.mock('../../../services/collection-profile-source.js', () => ({
  computeCollectionProfileSourceFingerprint:
    computeCollectionProfileSourceFingerprintMock,
}));

vi.mock('../../../services/collection-editor-mutation.js', () => ({
  applyCollectionEditorMutation: applyCollectionEditorMutationMock,
  collectionIdentityFingerprint: collectionIdentityFingerprintMock,
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
      letterPages: {
        findFirst: queryLetterPagesFindFirstMock,
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
    profileRevision: 'collections.profileRevision',
    profileSourceFingerprint: 'collections.profileSourceFingerprint',
    profileStatus: 'collections.profileStatus',
  },
  letterPages: {
    id: 'letterPages.id',
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
    resolveCollectionStartHereMock.mockResolvedValue({
      letterId: null,
      reason: null,
    });
    propagateNameMock.mockResolvedValue(undefined);
    syncLetterParticipantsFromMetadataMock.mockResolvedValue(undefined);
    generateCollectionProfileMock.mockResolvedValue({
      sourceFingerprint: 'a'.repeat(32),
      hook: 'Generated hook',
      narrative: 'Generated narrative',
      correspondents: [],
      isStub: true,
    });
    computeCollectionProfileSourceFingerprintMock.mockResolvedValue(
      'a'.repeat(32),
    );
    applyCollectionEditorMutationMock.mockResolvedValue({
      profileRevision: 6,
      identityFingerprint: 'c'.repeat(64),
      updatedLetterCount: 2,
      changed: true,
    });
    collectionIdentityFingerprintMock.mockReturnValue('b'.repeat(64));
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
      profileStartHereReason: null,
      profileCorrespondents: [],
      identityFingerprint: 'b'.repeat(64),
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

  it('returns the collection service featured-letter winner', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      profileStartHereLetterId: null,
      profileStartHereReason: 'Originally loaded stale reason',
    });
    queryLettersFindManyMock.mockResolvedValueOnce([
      { id: 'letter-1', dateRaw: '19470810', typeSequence: '01', type: 'L' },
    ]);
    transformLettersWithRelatedToDTOMock.mockReturnValueOnce([
      { id: 'letter-1', title: 'First letter' },
    ]);
    resolveCollectionStartHereMock.mockResolvedValueOnce({
      letterId: 'letter-1',
      reason: 'Resolved winner reason',
    });

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'GET',
      url: '/009',
      path: '/009',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profileStartHereLetterId: 'letter-1',
      profileStartHereReason: 'Resolved winner reason',
      profileCorrespondents: [],
      letterCount: 1,
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

  it('adapts the complete collection editor payload to one mutation owner', async () => {
    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/editor',
      path: '/009/editor',
      body: {
        profileRevision: 5,
        identityFingerprint: 'b'.repeat(64),
        hook: 'Updated hook',
        profileNarrative: 'Updated narrative',
        profileStartHereLetterId: null,
        profileCorrespondents: [{
          name: '  Jimmie  ',
          hook: '  Short hook  ',
          biography: '',
        }],
        description: 'Updated notes',
        correspondentRenames: [{
          oldName: 'Jimmie',
          newName: 'Jimmy',
          roles: ['sender'],
        }],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      profileRevision: 6,
      identityFingerprint: 'c'.repeat(64),
      updatedLetterCount: 2,
      changed: true,
    });
    expect(applyCollectionEditorMutationMock).toHaveBeenCalledWith({
      code: '009',
      expectedProfileRevision: 5,
      expectedIdentityFingerprint: 'b'.repeat(64),
      hook: 'Updated hook',
      profileNarrative: 'Updated narrative',
      profileStartHereLetterId: null,
      profileCorrespondents: [{
        name: 'Jimmie',
        hook: 'Short hook',
        biography: null,
      }],
      description: 'Updated notes',
      correspondentRenames: [{
        oldName: 'Jimmie',
        newName: 'Jimmy',
        roles: ['sender'],
      }],
    });
  });

  it('routes the legacy correspondent endpoint through the atomic owner', async () => {
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
    expect(applyCollectionEditorMutationMock).toHaveBeenCalledWith({
      code: '009',
      correspondentRenames: [{
        oldName: 'Jimmie',
        newName: 'Jimmy',
        roles: ['sender'],
      }],
    });
  });

  it('surfaces an atomic editor conflict without invoking another writer', async () => {
    applyCollectionEditorMutationMock.mockRejectedValueOnce(
      Object.assign(new Error('Collection changed'), { status: 409 }),
    );

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/editor',
      path: '/009/editor',
      body: {
        profileRevision: 5,
        identityFingerprint: 'b'.repeat(64),
        hook: 'Updated hook',
        correspondentRenames: [],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: 'Collection changed' });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('injects request ids into invalid update payload responses', async () => {
    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009',
      path: '/009',
      body: {
        profileRevision: 2,
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
      profileRevision: 2,
      profileStatus: 'VERIFIED',
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
        profileRevision: 2,
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
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Updated title',
      description: 'Updated description',
      profileRevision: expect.objectContaining({
        strings: expect.any(Array),
      }),
      profileStatus: expect.objectContaining({
        strings: expect.any(Array),
      }),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith({
      op: 'and',
      conditions: [
        { op: 'eq', left: 'collections.id', right: 'collection-9' },
        { op: 'eq', left: 'collections.profileRevision', right: 2 },
      ],
    });
  });

  it('does not advance or demote a collection profile for metadata no-ops', async () => {
    const collection = {
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      profileRevision: 2,
      profileStatus: 'VERIFIED',
    };
    getCollectionByCodeMock.mockResolvedValueOnce(collection);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009',
      path: '/009',
      body: {
        profileRevision: 2,
        title: 'Collection Nine',
        description: 'Ninth set',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(collection);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('requires the source revision before updating legacy collection metadata', async () => {
    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009',
      path: '/009',
      body: { title: 'Updated title' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('version is missing'),
    });
    expect(getCollectionByCodeMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects a legacy metadata save when a concurrent source change wins', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      title: 'Collection Nine',
      description: 'Ninth set',
      profileRevision: 2,
      profileStatus: 'EDITED',
    });
    returningMock.mockResolvedValueOnce([]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009',
      path: '/009',
      body: {
        profileRevision: 2,
        description: 'Stale replacement notes',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('changed'),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      op: 'and',
      conditions: [
        { op: 'eq', left: 'collections.id', right: 'collection-9' },
        { op: 'eq', left: 'collections.profileRevision', right: 2 },
      ],
    });
  });

  it('rejects a profile start-here letter that does not resolve inside the collection', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'VERIFIED',
      profileRevision: 3,
    });
    resolveRepresentativeLetterIdMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 3,
        profileStartHereLetterId: '11111111-1111-4111-8111-111111111111',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Featured letter must be published',
    });
    expect(resolveRepresentativeLetterIdMock).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      {
        publishedOnly: true,
        collectionId: 'collection-9',
      },
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects a highlight image owned by another collection', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EDITED',
      profileRevision: 3,
      profileSourceFingerprint: 'a'.repeat(32),
      highlightImageId: null,
    });
    queryLetterPagesFindFirstMock.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      letter: { collectionId: 'collection-10' },
    });

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 3,
        highlightImageId: '11111111-1111-4111-8111-111111111111',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Highlight image must belong to this collection',
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('tells an old profile editor to reload instead of accepting an unfenced save', async () => {
    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileNarrative: 'Stale narrative',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('version is missing'),
    });
    expect(getCollectionByCodeMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects a profile save whose collection source epoch changed', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EDITED',
      profileRevision: 4,
    });

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 3,
        profileStatus: 'VERIFIED',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('changed'),
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('advances the profile epoch through the exact loaded revision', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EDITED',
      profileRevision: 4,
      profileSourceFingerprint: 'a'.repeat(32),
    });
    returningMock.mockResolvedValueOnce([{
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'VERIFIED',
      profileRevision: 5,
    }]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 4,
        profileStatus: 'VERIFIED',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profileStatus: 'VERIFIED',
      profileRevision: 5,
    });
    expect(updateSetMock).toHaveBeenCalledWith({
      profileStatus: 'VERIFIED',
      profileRevision: expect.objectContaining({
        strings: expect.any(Array),
      }),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      op: 'and',
      conditions: [
        { op: 'eq', left: 'collections.id', right: 'collection-9' },
        { op: 'eq', left: 'collections.profileRevision', right: 4 },
        {
          op: 'eq',
          left: 'collections.profileSourceFingerprint',
          right: 'a'.repeat(32),
        },
        expect.objectContaining({
          strings: expect.any(Array),
        }),
      ],
    });
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'profileSourceFingerprint',
    );
  });

  it('does not bless stale profile content with the latest source fingerprint', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EDITED',
      profileRevision: 4,
      profileSourceFingerprint: 'a'.repeat(32),
    });
    computeCollectionProfileSourceFingerprintMock.mockResolvedValueOnce(
      'b'.repeat(32),
    );

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 4,
        profileStatus: 'VERIFIED',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('regenerate'),
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('does not verify legacy profile content whose source provenance is unknown', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EDITED',
      profileRevision: 4,
      profileSourceFingerprint: null,
      profileNarrative: 'Legacy profile content',
    });

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 4,
        profileStatus: 'VERIFIED',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('not bound'),
    });
    expect(computeCollectionProfileSourceFingerprintMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('binds the first manual profile content edit to one terminal source fingerprint', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EMPTY',
      profileRevision: 4,
      profileSourceFingerprint: null,
      profileNarrative: null,
    });
    returningMock.mockResolvedValueOnce([{
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EMPTY',
      profileRevision: 5,
      profileSourceFingerprint: 'a'.repeat(32),
      profileNarrative: 'A manually authored profile',
    }]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 4,
        profileNarrative: 'A manually authored profile',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({
      profileNarrative: 'A manually authored profile',
      profileSourceFingerprint: 'a'.repeat(32),
      profileRevision: expect.objectContaining({
        strings: expect.any(Array),
      }),
    });
    expect(updateWhereMock).toHaveBeenCalledWith({
      op: 'and',
      conditions: [
        { op: 'eq', left: 'collections.id', right: 'collection-9' },
        { op: 'eq', left: 'collections.profileRevision', right: 4 },
        expect.objectContaining({
          strings: expect.any(Array),
        }),
        expect.objectContaining({
          strings: expect.any(Array),
        }),
      ],
    });
  });

  it('does not advance the profile epoch for an exact content no-op', async () => {
    const collection = {
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EDITED',
      profileRevision: 4,
      profileSourceFingerprint: 'a'.repeat(32),
      profileNarrative: 'Existing narrative',
    };
    getCollectionByCodeMock.mockResolvedValueOnce(collection);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 4,
        profileNarrative: 'Existing narrative',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(collection);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('demotes verified profile content edits without rebinding their source', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'VERIFIED',
      profileRevision: 4,
      profileSourceFingerprint: 'a'.repeat(32),
      profileNarrative: 'Reviewed narrative',
    });
    returningMock.mockResolvedValueOnce([{
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EDITED',
      profileRevision: 5,
      profileSourceFingerprint: 'a'.repeat(32),
      profileNarrative: 'Edited narrative',
    }]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'PUT',
      url: '/009/profile',
      path: '/009/profile',
      body: {
        profileRevision: 4,
        profileNarrative: 'Edited narrative',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith({
      profileNarrative: 'Edited narrative',
      profileStatus: 'EDITED',
      profileRevision: expect.objectContaining({
        strings: expect.any(Array),
      }),
    });
    expect(updateSetMock.mock.calls[0]?.[0]).not.toHaveProperty(
      'profileSourceFingerprint',
    );
    expect(computeCollectionProfileSourceFingerprintMock).not.toHaveBeenCalled();
  });

  it('stores generated profile output only with its exact source fingerprint', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EMPTY',
      profileRevision: 4,
      profileSourceFingerprint: null,
    });
    returningMock.mockResolvedValueOnce([{ profileRevision: 5 }]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'POST',
      url: '/009/generate-profile',
      path: '/009/generate-profile',
      body: {
        profileRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      sourceFingerprint: 'a'.repeat(32),
      profileStatus: 'AI_DRAFT',
      profileRevision: 5,
    });
    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      hook: 'Generated hook',
      profileNarrative: 'Generated narrative',
      profileSourceFingerprint: 'a'.repeat(32),
      profileStatus: 'AI_DRAFT',
      profileRevision: expect.objectContaining({
        strings: expect.any(Array),
      }),
    }));
    expect(updateWhereMock).toHaveBeenCalledWith({
      op: 'and',
      conditions: [
        { op: 'eq', left: 'collections.id', right: 'collection-9' },
        { op: 'eq', left: 'collections.profileRevision', right: 4 },
        expect.objectContaining({
          strings: expect.any(Array),
        }),
      ],
    });
  });

  it('discards AI profile output when source invalidation wins during generation', async () => {
    getCollectionByCodeMock.mockResolvedValueOnce({
      id: 'collection-9',
      collectionCode: '009',
      profileStatus: 'EMPTY',
      profileRevision: 4,
    });
    returningMock.mockResolvedValueOnce([]);

    const response = await invokeRouter(adminCollectionsRouter, {
      method: 'POST',
      url: '/009/generate-profile',
      path: '/009/generate-profile',
      body: {
        profileRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(generateCollectionProfileMock).toHaveBeenCalledWith('collection-9');
    expect(response.body).toMatchObject({
      error: expect.stringContaining('while the profile was generated'),
    });
  });

});
