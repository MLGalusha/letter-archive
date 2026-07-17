import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const { getLetterByIdMock, fetchLetterWithRelatedAndTransformMock, dbUpdateMock, updateSetMock, updateWhereMock, updateReturningMock, runMetadataExtractionV2Mock, runEntityExtractionOnlyMock } = vi.hoisted(() => ({
  getLetterByIdMock: vi.fn(),
  fetchLetterWithRelatedAndTransformMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  runMetadataExtractionV2Mock: vi.fn(),
  runEntityExtractionOnlyMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ kind: 'eq', field, value })),
  and: vi.fn((...clauses: unknown[]) => ({ kind: 'and', clauses })),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({
    kind: 'inArray',
    field,
    values,
  })),
  isNull: vi.fn((field: unknown) => ({ kind: 'isNull', field })),
}));

vi.mock('../../../db/index.js', () => {
  dbUpdateMock.mockImplementation(() => ({ set: updateSetMock }));
  updateSetMock.mockImplementation(() => ({ where: updateWhereMock }));

  return {
    db: {
      update: dbUpdateMock,
      query: {
        letterPersons: { findFirst: vi.fn() },
        canonicalPersons: { findFirst: vi.fn() },
      },
    },
    letters: {
      id: 'letters.id',
      metadataStatus: 'letters.metadataStatus',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      transcriptionStatus: 'letters.transcriptionStatus',
      transcriptionText: 'letters.transcriptionText',
      workflow: 'letters.workflow',
    },
    canonicalPersons: { id: 'canonicalPersons.id' },
    letterPages: { id: 'letterPages.id' },
    letterPersons: {
      letterId: 'letterPersons.letterId',
      role: 'letterPersons.role',
    },
  };
});

vi.mock('../../../services/letters.js', () => ({
  getLetterById: getLetterByIdMock,
  resetLetterForProcessing: vi.fn(),
}));

vi.mock('../../../services/letter-queries.js', () => ({
  fetchLetterWithRelatedAndTransform: fetchLetterWithRelatedAndTransformMock,
}));

vi.mock('../../../pipeline/metadataV2.js', () => ({
  runMetadataExtractionV2: runMetadataExtractionV2Mock,
  runEntityExtractionOnly: runEntityExtractionOnlyMock,
}));

vi.mock('../../../services/letter-operations.js', () => ({
  createVersion: vi.fn(),
  describePhoto: vi.fn(),
  getVersions: vi.fn(),
  regenerateTranscription: vi.fn(),
  restoreVersion: vi.fn(),
  transcribeExtras: vi.fn(),
  transcribeLetterOnly: vi.fn(),
  updateLetter: vi.fn(),
  updateAiNotes: vi.fn(),
  updateExtraContent: vi.fn(),
  updatePhotoDescription: vi.fn(),
}));

vi.mock('../../../services/line-segments.js', () => ({
  savePageLineSegments: vi.fn(),
}));
vi.mock('../../../services/metadata-update.js', () => ({
  executeRetagForLetter: vi.fn(),
}));
vi.mock('../../../services/note-resolution.js', () => ({
  checkNoteAutoResolutions: vi.fn(),
}));
vi.mock('../../../services/processing-queue.js', () => ({
  requestBackgroundWorkerRun: vi.fn(),
}));
vi.mock('../../../services/entities/persons.js', () => ({
  addAliasToCanonicalPerson: vi.fn(),
}));
vi.mock('../../../services/entities/participant-sync.js', () => ({
  syncLetterParticipantsFromMetadata: vi.fn(),
}));
vi.mock('../../../services/storage.js', () => ({
  getAbsoluteStoragePath: vi.fn(),
}));

import contentRouter from '../letters/content.js';

describe('admin downstream extraction exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([]);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValue({
      id: 'letter-1',
    });
  });

  it.each([
    {
      route: '/letter-1/regenerate-metadata',
      body: {},
      letter: {
        transcriptConfirmedAt: new Date(),
        transcriptionStatus: 'RUNNING',
        metadataStatus: 'SUCCESS',
      },
    },
    {
      route: '/letter-1/regenerate-entities',
      body: {},
      letter: {
        transcriptionText: 'transcript',
        transcriptionStatus: 'RUNNING',
        entityExtractionStatus: 'SUCCESS',
      },
    },
    {
      route: '/letter-1/re-extract',
      body: { mode: 'metadata_only' },
      letter: {
        transcriptionText: 'transcript',
        transcriptionStatus: 'RUNNING',
        metadataStatus: 'SUCCESS',
      },
    },
  ])('rejects $route while retranscription is running', async ({ route, body, letter }) => {
    getLetterByIdMock.mockResolvedValue(letter);

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: route,
      path: route,
      body,
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Transcription is already in progress',
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
    expect(runEntityExtractionOnlyMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      description: 'metadata regeneration while entity extraction is running',
      route: '/letter-1/regenerate-metadata',
      body: {},
      letter: {
        transcriptConfirmedAt: new Date(),
        transcriptionStatus: 'SUCCESS',
        metadataStatus: 'SUCCESS',
        entityExtractionStatus: 'RUNNING',
      },
      error: 'Entity extraction is already in progress',
    },
    {
      description: 'metadata re-extraction while entity extraction is running',
      route: '/letter-1/re-extract',
      body: { mode: 'metadata_only' },
      letter: {
        transcriptionText: 'transcript',
        transcriptionStatus: 'SUCCESS',
        metadataStatus: 'SUCCESS',
        entityExtractionStatus: 'RUNNING',
      },
      error: 'Entity extraction is already in progress',
    },
    {
      description: 'entity regeneration while metadata extraction is running',
      route: '/letter-1/regenerate-entities',
      body: {},
      letter: {
        transcriptionText: 'transcript',
        transcriptionStatus: 'SUCCESS',
        metadataStatus: 'RUNNING',
        entityExtractionStatus: 'SUCCESS',
      },
      error: 'Metadata extraction is already in progress',
    },
    {
      description: 'entity re-extraction while metadata extraction is running',
      route: '/letter-1/re-extract',
      body: { mode: 'entities_only' },
      letter: {
        transcriptionText: 'transcript',
        transcriptionStatus: 'SUCCESS',
        metadataStatus: 'RUNNING',
        entityExtractionStatus: 'SUCCESS',
      },
      error: 'Metadata extraction is already in progress',
    },
  ])('rejects $description', async ({ route, body, letter, error }) => {
    getLetterByIdMock.mockResolvedValue(letter);

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: route,
      path: route,
      body,
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
    expect(runEntityExtractionOnlyMock).not.toHaveBeenCalled();
  });

  it('does not preclaim metadata when transcription wins the atomic race', async () => {
    getLetterByIdMock.mockResolvedValue({
      transcriptConfirmedAt: new Date(),
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      sender: null,
      recipient: null,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/regenerate-metadata',
      path: '/letter-1/regenerate-metadata',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'transcript' },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
        {
          kind: 'eq',
          field: 'letters.entityExtractionStatus',
          value: 'SUCCESS',
        },
      ],
    });
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('does not reset entity work when transcription wins the atomic race', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionText: 'transcript',
      transcriptionStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/regenerate-entities',
      path: '/letter-1/regenerate-entities',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'transcript' },
        {
          kind: 'eq',
          field: 'letters.entityExtractionStatus',
          value: 'SUCCESS',
        },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
      ],
    });
    expect(runEntityExtractionOnlyMock).not.toHaveBeenCalled();
  });

  it('does not reset entity work when entity extraction wins a metadata re-extraction race', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionText: 'transcript',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'PENDING',
      metadataV2Json: null,
      sender: null,
      recipient: null,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/re-extract',
      path: '/letter-1/re-extract',
      body: { mode: 'metadata_only' },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'transcript' },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
        {
          kind: 'eq',
          field: 'letters.entityExtractionStatus',
          value: 'PENDING',
        },
      ],
    });
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('does not reset entity work when metadata extraction wins an entity re-extraction race', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionText: 'transcript',
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      metadataV2Json: null,
      sender: null,
      recipient: null,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/re-extract',
      path: '/letter-1/re-extract',
      body: { mode: 'entities_only' },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'transcript' },
        {
          kind: 'eq',
          field: 'letters.entityExtractionStatus',
          value: 'SUCCESS',
        },
        { kind: 'eq', field: 'letters.metadataStatus', value: 'SUCCESS' },
      ],
    });
    expect(runEntityExtractionOnlyMock).not.toHaveBeenCalled();
  });

  it('rejects transcript confirmation while retranscription is already running', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'RUNNING',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('binds the validated transcript snapshot when confirmation claims metadata', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
    });
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-1' }]);

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateWhereMock).toHaveBeenCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'transcript' },
        {
          kind: 'inArray',
          field: 'letters.metadataStatus',
          values: ['PENDING', 'FAILED'],
        },
        {
          kind: 'eq',
          field: 'letters.entityExtractionStatus',
          value: 'PENDING',
        },
      ],
    });
    expect(runMetadataExtractionV2Mock).toHaveBeenCalledWith('letter-1', undefined, true);
  });

  it('binds the validated transcript snapshot when a worker wins the metadata claim', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
    });
    updateReturningMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'letter-1' }]);

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateWhereMock).toHaveBeenNthCalledWith(2, {
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'transcript' },
      ],
    });
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('returns a conflict when transcription wins the confirmation race', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
    });
    updateReturningMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(updateWhereMock).toHaveBeenLastCalledWith({
      kind: 'and',
      clauses: [
        { kind: 'eq', field: 'letters.id', value: 'letter-1' },
        { kind: 'eq', field: 'letters.workflow', value: 'TRANSCRIBED' },
        { kind: 'eq', field: 'letters.transcriptionStatus', value: 'SUCCESS' },
        { kind: 'eq', field: 'letters.transcriptionText', value: 'transcript' },
      ],
    });
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });
});
