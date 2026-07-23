import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  getLetterByIdMock,
  fetchLetterWithRelatedAndTransformMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  updateReturningMock,
  runMetadataExtractionV2Mock,
  runEntityExtractionOnlyMock,
  observeMetadataStateMock,
  claimRequestedMetadataMock,
  claimMetadataAfterTranscriptConfirmationMock,
  dbTransactionMock,
  syncLetterParticipantsFromMetadataMock,
} = vi.hoisted(() => ({
  getLetterByIdMock: vi.fn(),
  fetchLetterWithRelatedAndTransformMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  updateReturningMock: vi.fn(),
  runMetadataExtractionV2Mock: vi.fn(),
  runEntityExtractionOnlyMock: vi.fn(),
  observeMetadataStateMock: vi.fn(),
  claimRequestedMetadataMock: vi.fn(),
  claimMetadataAfterTranscriptConfirmationMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
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
      transaction: dbTransactionMock,
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

vi.mock('../../../services/letter/metadata-job.js', () => ({
  buildHumanMetadataJobPatch: vi.fn(() => ({
    metadataStatus: 'SUCCESS',
    metadataRunId: null,
    metadataError: null,
    metadataContentStatus: 'EDITED',
    metadataVerifiedAt: null,
    metadataVerifiedBy: null,
    workflow: 'METADATA_DRAFTED',
  })),
  observeMetadataState: observeMetadataStateMock,
  claimRequestedMetadata: claimRequestedMetadataMock,
  claimMetadataAfterTranscriptConfirmation:
    claimMetadataAfterTranscriptConfirmationMock,
  observedMetadataRevisionConditions: vi.fn(() => [
    { kind: 'observedMetadataRevision' },
  ]),
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
  syncLetterParticipantsFromMetadata: syncLetterParticipantsFromMetadataMock,
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
    runMetadataExtractionV2Mock.mockResolvedValue({ kind: 'completed' });
    observeMetadataStateMock.mockImplementation(letter => ({ letter }));
    claimRequestedMetadataMock.mockResolvedValue(null);
    claimMetadataAfterTranscriptConfirmationMock.mockResolvedValue(null);
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
      type: 'L',
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
    expect(claimRequestedMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { letter: expect.objectContaining({ transcriptionText: 'transcript' }) },
    );
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('does not reset entity work when transcription wins the atomic race', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
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
      type: 'L',
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
    expect(claimRequestedMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { letter: expect.objectContaining({ entityExtractionStatus: 'PENDING' }) },
    );
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('does not reset entity work when metadata extraction wins an entity re-extraction race', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
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
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
    });
    claimMetadataAfterTranscriptConfirmationMock.mockResolvedValueOnce({
      runId: 'run-a',
      revision: 0,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(claimMetadataAfterTranscriptConfirmationMock).toHaveBeenCalledWith(
      'letter-1',
      { letter: expect.objectContaining({ transcriptionText: 'transcript' }) },
      'admin',
    );
    expect(runMetadataExtractionV2Mock).toHaveBeenCalledWith(
      'letter-1',
      undefined,
      { runId: 'run-a', revision: 0 },
    );
  });

  it('returns a conflict when a request-owned metadata run is superseded', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
      transcriptConfirmedAt: new Date(),
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'SUCCESS',
      sender: null,
      recipient: null,
    });
    claimRequestedMetadataMock.mockResolvedValueOnce({
      runId: 'run-a',
      revision: 1,
    });
    runMetadataExtractionV2Mock.mockResolvedValueOnce({ kind: 'superseded' });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/regenerate-metadata',
      path: '/letter-1/regenerate-metadata',
      body: {},
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('superseded'),
    });
  });

  it('binds the validated transcript snapshot when a worker wins the metadata claim', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
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
      ],
    });
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('returns a conflict when transcription wins the confirmation race', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
    });
    updateReturningMock.mockResolvedValueOnce([]);

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

  it('rolls back identity metadata and does not report success when participant projection fails', async () => {
    let persistedSender: string | null = null;
    let stagedSender: string | null = persistedSender;
    const transactionExecutor = {
      query: {
        letterPersons: { findFirst: vi.fn() },
        canonicalPersons: { findFirst: vi.fn() },
      },
      update: vi.fn(() => ({
        set: vi.fn((patch: { sender?: string | null }) => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              stagedSender = patch.sender ?? null;
              return [{ id: 'letter-1' }];
            }),
          })),
        })),
      })),
    };

    dbTransactionMock.mockImplementationOnce(async (
      callback: (tx: typeof transactionExecutor) => Promise<unknown>,
    ) => {
      try {
        const result = await callback(transactionExecutor);
        persistedSender = stagedSender;
        return result;
      } catch (error) {
        stagedSender = persistedSender;
        throw error;
      }
    });
    syncLetterParticipantsFromMetadataMock.mockRejectedValueOnce(
      new Error('participant projection failed'),
    );
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      sender: null,
      recipient: 'Existing Recipient',
      metadataRevision: 4,
      metadataV2Json: null,
      metadataJson: null,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'PATCH',
      url: '/letter-1/identity',
      path: '/letter-1/identity',
      body: { sender: 'Corrected Sender' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: 'Internal server error',
      requestId: expect.any(String),
    });
    expect(persistedSender).toBeNull();
    expect(dbTransactionMock).toHaveBeenCalledTimes(1);
    expect(syncLetterParticipantsFromMetadataMock).toHaveBeenCalledWith({
      letterId: 'letter-1',
      sender: 'Corrected Sender',
      recipient: undefined,
      database: transactionExecutor,
    });
    expect(fetchLetterWithRelatedAndTransformMock).not.toHaveBeenCalled();
  });
});
