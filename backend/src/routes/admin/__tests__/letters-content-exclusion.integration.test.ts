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
  generateAndSaveReadingViewMock,
  dbTransactionMock,
  syncLetterParticipantsFromMetadataMock,
  addAiNoteMock,
  resolveAiNotesForChangedFieldsMock,
  updateAiNotesMock,
  updateAiNoteStatusMock,
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
  generateAndSaveReadingViewMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  syncLetterParticipantsFromMetadataMock: vi.fn(),
  addAiNoteMock: vi.fn(),
  resolveAiNotesForChangedFieldsMock: vi.fn(),
  updateAiNotesMock: vi.fn(),
  updateAiNoteStatusMock: vi.fn(),
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
      primarySourceRevision: 'letters.primarySourceRevision',
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
vi.mock('../../../services/letter/ai-notes.js', () => ({
  addAiNote: addAiNoteMock,
  resolveAiNotesForChangedFields: resolveAiNotesForChangedFieldsMock,
  updateAiNotes: updateAiNotesMock,
  updateAiNoteStatus: updateAiNoteStatusMock,
}));

vi.mock('../../../services/line-segments.js', () => ({
  savePageLineSegments: vi.fn(),
  updatePageSegmentTrust: vi.fn(),
  updateLetterSegmentTrust: vi.fn(),
}));
vi.mock('../../../services/metadata-update.js', () => ({
  executeRetagForLetter: vi.fn(),
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
vi.mock('../../../services/letter/correspondence-deletion.js', () => ({
  deleteCorrespondenceGroup: vi.fn(),
}));
vi.mock('../../../services/letter/readingView.js', () => ({
  generateAndSaveReadingView: generateAndSaveReadingViewMock,
}));

import contentRouter from '../letters/content.js';

describe('admin downstream extraction exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateReturningMock.mockResolvedValue([]);
    runMetadataExtractionV2Mock.mockResolvedValue({ kind: 'completed' });
    runEntityExtractionOnlyMock.mockResolvedValue({ kind: 'completed' });
    observeMetadataStateMock.mockImplementation(letter => ({ letter }));
    claimRequestedMetadataMock.mockResolvedValue(null);
    claimMetadataAfterTranscriptConfirmationMock.mockResolvedValue(null);
    generateAndSaveReadingViewMock.mockResolvedValue('Reading view');
    addAiNoteMock.mockResolvedValue(true);
    resolveAiNotesForChangedFieldsMock.mockReturnValue(null);
    updateAiNotesMock.mockResolvedValue(true);
    updateAiNoteStatusMock.mockResolvedValue(true);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValue({
      id: 'letter-1',
    });
  });

  it.each([
    {
      method: 'PUT',
      route: '/letter-1/ai-notes',
      body: { aiNotes: [] },
    },
    {
      method: 'POST',
      route: '/letter-1/notes',
      body: {
        content: 'Check the sender',
        category: 'identity',
        priority: 'high',
      },
    },
    {
      method: 'PATCH',
      route: '/letter-1/notes/note-1',
      body: { status: 'resolved' },
    },
  ])('requires source authority for $method $route', async ({
    method,
    route,
    body,
  }) => {
    const response = await invokeRouter(contentRouter, {
      method,
      url: route,
      path: route,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: 'SOURCE_REVISION_CHANGED',
      error: expect.stringContaining('source version is missing'),
    });
    expect(addAiNoteMock).not.toHaveBeenCalled();
    expect(updateAiNotesMock).not.toHaveBeenCalled();
    expect(updateAiNoteStatusMock).not.toHaveBeenCalled();
  });

  it('passes the observed source revision to every note mutation owner', async () => {
    const replaceResponse = await invokeRouter(contentRouter, {
      method: 'PUT',
      url: '/letter-1/ai-notes',
      path: '/letter-1/ai-notes',
      body: {
        primarySourceRevision: 7,
        aiNotes: [],
      },
      headers: { 'content-type': 'application/json' },
    });
    const addResponse = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/notes',
      path: '/letter-1/notes',
      body: {
        primarySourceRevision: 7,
        content: 'Check the sender',
        category: 'identity',
        priority: 'high',
      },
      headers: { 'content-type': 'application/json' },
    });
    const statusResponse = await invokeRouter(contentRouter, {
      method: 'PATCH',
      url: '/letter-1/notes/note-1',
      path: '/letter-1/notes/note-1',
      body: {
        primarySourceRevision: 7,
        status: 'dismissed',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect([
      replaceResponse.statusCode,
      addResponse.statusCode,
      statusResponse.statusCode,
    ]).toEqual([200, 200, 200]);
    expect(updateAiNotesMock).toHaveBeenCalledWith('letter-1', [], 7);
    expect(addAiNoteMock).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({
        content: 'Check the sender',
        category: 'identity',
        priority: 'high',
      }),
      7,
      'admin',
    );
    expect(updateAiNoteStatusMock).toHaveBeenCalledWith(
      'letter-1',
      'note-1',
      'dismissed',
      7,
      'admin',
    );
  });

  it.each([
    {
      route: '/letter-1/regenerate-metadata',
      body: {},
    },
    {
      route: '/letter-1/regenerate-entities',
      body: {},
    },
    {
      route: '/letter-1/re-extract',
      body: { mode: 'metadata_only' },
    },
    {
      route: '/letter-1/generate-reading-view',
      body: {},
    },
  ])('requires an observed page-source revision for $route', async ({
    route,
    body,
  }) => {
    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: route,
      path: route,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('source version is missing'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(getLetterByIdMock).not.toHaveBeenCalled();
    expect(claimRequestedMetadataMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
    expect(runEntityExtractionOnlyMock).not.toHaveBeenCalled();
    expect(generateAndSaveReadingViewMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      route: '/letter-1/regenerate-metadata',
      body: { primarySourceRevision: 7 },
    },
    {
      route: '/letter-1/regenerate-entities',
      body: { primarySourceRevision: 7 },
    },
    {
      route: '/letter-1/re-extract',
      body: { mode: 'metadata_only', primarySourceRevision: 7 },
    },
    {
      route: '/letter-1/generate-reading-view',
      body: { primarySourceRevision: 7 },
    },
  ])('rejects stale page-source authority before starting $route', async ({
    route,
    body,
  }) => {
    getLetterByIdMock.mockResolvedValueOnce({
      id: 'letter-1',
      primarySourceRevision: 8,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: route,
      path: route,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('source changed'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(claimRequestedMetadataMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
    expect(runEntityExtractionOnlyMock).not.toHaveBeenCalled();
    expect(generateAndSaveReadingViewMock).not.toHaveBeenCalled();
  });

  it('passes the observed source revision through manual reading-view generation', async () => {
    getLetterByIdMock.mockResolvedValueOnce({
      id: 'letter-1',
      transcriptionText: 'Reviewed transcript',
      transcriptionStatus: 'SUCCESS',
      primarySourceRevision: 7,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/generate-reading-view',
      path: '/letter-1/generate-reading-view',
      body: { primarySourceRevision: 7 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(generateAndSaveReadingViewMock).toHaveBeenCalledWith(
      'letter-1',
      7,
    );
  });

  it('classifies a metadata race-to-claim source change as terminal', async () => {
    getLetterByIdMock
      .mockResolvedValueOnce({
        id: 'letter-1',
        type: 'L',
        transcriptConfirmedAt: new Date(),
        transcriptionStatus: 'SUCCESS',
        transcriptionText: 'transcript',
        metadataStatus: 'SUCCESS',
        entityExtractionStatus: 'SUCCESS',
        primarySourceRevision: 7,
      })
      .mockResolvedValueOnce({
        id: 'letter-1',
        primarySourceRevision: 8,
      });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/regenerate-metadata',
      path: '/letter-1/regenerate-metadata',
      body: { primarySourceRevision: 7 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('source changed'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(claimRequestedMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      expect.any(Object),
      7,
    );
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('classifies an entity race-to-claim source change as terminal', async () => {
    getLetterByIdMock
      .mockResolvedValueOnce({
        id: 'letter-1',
        type: 'L',
        transcriptionStatus: 'SUCCESS',
        transcriptionText: 'transcript',
        metadataStatus: 'SUCCESS',
        entityExtractionStatus: 'SUCCESS',
        primarySourceRevision: 7,
      })
      .mockResolvedValueOnce({
        id: 'letter-1',
        primarySourceRevision: 8,
      });
    runEntityExtractionOnlyMock.mockResolvedValueOnce({ kind: 'claim_lost' });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/regenerate-entities',
      path: '/letter-1/regenerate-entities',
      body: { primarySourceRevision: 7 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('source changed'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(runEntityExtractionOnlyMock).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({
        claimKind: 'REQUESTED',
        expectedPrimarySourceRevision: 7,
      }),
    );
  });

  it.each([
    {
      route: '/letter-1/regenerate-metadata',
      body: { primarySourceRevision: 0 },
      letter: {
        transcriptConfirmedAt: new Date(),
        transcriptionStatus: 'RUNNING',
        metadataStatus: 'SUCCESS',
      },
    },
    {
      route: '/letter-1/regenerate-entities',
      body: { primarySourceRevision: 0 },
      letter: {
        transcriptionText: 'transcript',
        transcriptionStatus: 'RUNNING',
        entityExtractionStatus: 'SUCCESS',
      },
    },
    {
      route: '/letter-1/re-extract',
      body: { mode: 'metadata_only', primarySourceRevision: 0 },
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
      body: { primarySourceRevision: 0 },
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
      body: { mode: 'metadata_only', primarySourceRevision: 0 },
      letter: {
        transcriptionText: 'transcript',
        transcriptConfirmedAt: new Date(),
        transcriptionStatus: 'SUCCESS',
        metadataStatus: 'SUCCESS',
        entityExtractionStatus: 'RUNNING',
      },
      error: 'Entity extraction is already in progress',
    },
    {
      description: 'entity regeneration while metadata extraction is running',
      route: '/letter-1/regenerate-entities',
      body: { primarySourceRevision: 0 },
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
      body: { mode: 'entities_only', primarySourceRevision: 0 },
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

  it('rejects metadata re-extraction until the transcript is confirmed', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionText: 'transcript',
      transcriptConfirmedAt: null,
      transcriptionStatus: 'SUCCESS',
      metadataStatus: 'SUCCESS',
      entityExtractionStatus: 'PENDING',
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/re-extract',
      path: '/letter-1/re-extract',
      body: { mode: 'metadata_only', primarySourceRevision: 0 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Transcript must be confirmed before regenerating metadata',
    });
    expect(claimRequestedMetadataMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
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
      body: { primarySourceRevision: 0 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(claimRequestedMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { letter: expect.objectContaining({ transcriptionText: 'transcript' }) },
      0,
    );
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it.each([
    {
      description: 'entity regeneration',
      url: '/letter-1/regenerate-entities',
      body: { primarySourceRevision: 0 },
    },
    {
      description: 'entity-only re-extraction',
      url: '/letter-1/re-extract',
      body: { mode: 'entities_only', primarySourceRevision: 0 },
    },
  ])('delegates $description ownership to the entity pipeline without a pre-reset', async ({
    url,
    body,
  }) => {
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
      url,
      path: url,
      body,
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runEntityExtractionOnlyMock).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({ claimKind: 'REQUESTED' }),
    );
  });

  it('does not reset entity work when entity extraction wins a metadata re-extraction race', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionText: 'transcript',
      transcriptConfirmedAt: new Date(),
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
      body: { mode: 'metadata_only', primarySourceRevision: 0 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(claimRequestedMetadataMock).toHaveBeenCalledWith(
      'letter-1',
      { letter: expect.objectContaining({ entityExtractionStatus: 'PENDING' }) },
      0,
    );
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it.each([
    {
      description: 'entity regeneration',
      url: '/letter-1/regenerate-entities',
      body: { primarySourceRevision: 0 },
    },
    {
      description: 'entity-only re-extraction',
      url: '/letter-1/re-extract',
      body: { mode: 'entities_only', primarySourceRevision: 0 },
    },
  ])('returns a conflict when $description loses its pipeline claim race', async ({
    url,
    body,
  }) => {
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
    runEntityExtractionOnlyMock.mockResolvedValueOnce({ kind: 'claim_lost' });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url,
      path: url,
      body,
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('claim lost'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runEntityExtractionOnlyMock).toHaveBeenCalledWith(
      'letter-1',
      expect.objectContaining({ claimKind: 'REQUESTED' }),
    );
  });

  it('rejects transcript confirmation while retranscription is already running', async () => {
    getLetterByIdMock.mockResolvedValue({
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'RUNNING',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      primarySourceRevision: 7,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: { primarySourceRevision: 7 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('requires a page-source revision before confirming a transcript', async () => {
    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: {},
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('source version is missing'),
      code: 'SOURCE_REVISION_CHANGED',
    });
    expect(getLetterByIdMock).not.toHaveBeenCalled();
  });

  it('binds the validated transcript snapshot when confirmation claims metadata', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      primarySourceRevision: 7,
    });
    claimMetadataAfterTranscriptConfirmationMock.mockResolvedValueOnce({
      runId: 'run-a',
      revision: 0,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: { primarySourceRevision: 7 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(claimMetadataAfterTranscriptConfirmationMock).toHaveBeenCalledWith(
      'letter-1',
      { letter: expect.objectContaining({ transcriptionText: 'transcript' }) },
      7,
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
      body: { primarySourceRevision: 0 },
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
      primarySourceRevision: 7,
    });
    updateReturningMock.mockResolvedValueOnce([{ id: 'letter-1' }]);

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: { primarySourceRevision: 7 },
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
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
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
      primarySourceRevision: 7,
    });
    updateReturningMock.mockResolvedValueOnce([]);

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: { primarySourceRevision: 7 },
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
        { kind: 'eq', field: 'letters.primarySourceRevision', value: 7 },
      ],
    });
    expect(runMetadataExtractionV2Mock).not.toHaveBeenCalled();
  });

  it('rejects transcript confirmation from a stale page-source epoch', async () => {
    getLetterByIdMock.mockResolvedValue({
      type: 'L',
      workflow: 'TRANSCRIBED',
      transcriptionStatus: 'SUCCESS',
      transcriptionText: 'newer source transcript',
      metadataStatus: 'PENDING',
      entityExtractionStatus: 'PENDING',
      primarySourceRevision: 8,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'POST',
      url: '/letter-1/confirm-transcript',
      path: '/letter-1/confirm-transcript',
      body: { primarySourceRevision: 7 },
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('source changed'),
    });
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(claimMetadataAfterTranscriptConfirmationMock).not.toHaveBeenCalled();
  });

  it('rejects a delayed identity edit that was based on an older same-source name', async () => {
    getLetterByIdMock.mockResolvedValue({
      id: 'letter-1',
      sender: 'Newer Sender',
      recipient: 'Existing Recipient',
      metadataRevision: 5,
      primarySourceRevision: 6,
      metadataV2Json: null,
      metadataJson: null,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'PATCH',
      url: '/letter-1/identity',
      path: '/letter-1/identity',
      body: {
        primarySourceRevision: 6,
        expectedSender: 'Older Sender',
        sender: 'Delayed Sender',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Letter identity changed; reload before saving names',
      requestId: expect.any(String),
    });
    expect(dbTransactionMock).not.toHaveBeenCalled();
    expect(syncLetterParticipantsFromMetadataMock).not.toHaveBeenCalled();
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
      primarySourceRevision: 6,
      metadataV2Json: null,
      metadataJson: null,
    });

    const response = await invokeRouter(contentRouter, {
      method: 'PATCH',
      url: '/letter-1/identity',
      path: '/letter-1/identity',
      body: {
        primarySourceRevision: 6,
        expectedSender: null,
        sender: 'Corrected Sender',
      },
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
