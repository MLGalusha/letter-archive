import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  findFirstMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  getAbsoluteStoragePathMock,
  detectAndStorePageLinesMock,
  getLetterByIdMock,
  fetchLetterWithRelatedAndTransformMock,
  buildLetterUpdatesMock,
  createVersionMock,
  verifyTranscriptMock,
  unverifyTranscriptMock,
  verifyMetadataMock,
  unverifyMetadataMock,
  regenerateTranscriptionMock,
  transcribeLetterOnlyMock,
  transcribeExtrasMock,
  describePhotoMock,
  updateExtraContentMock,
  updatePhotoDescriptionMock,
  executeRetagForLetterMock,
  verifyExtraContentMock,
  verifyPhotoDescriptionMock,
  unverifyExtraContentMock,
  unverifyPhotoDescriptionMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn(),
  detectAndStorePageLinesMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  fetchLetterWithRelatedAndTransformMock: vi.fn(),
  buildLetterUpdatesMock: vi.fn(),
  createVersionMock: vi.fn(),
  verifyTranscriptMock: vi.fn(),
  unverifyTranscriptMock: vi.fn(),
  verifyMetadataMock: vi.fn(),
  unverifyMetadataMock: vi.fn(),
  regenerateTranscriptionMock: vi.fn(),
  transcribeLetterOnlyMock: vi.fn(),
  transcribeExtrasMock: vi.fn(),
  describePhotoMock: vi.fn(),
  updateExtraContentMock: vi.fn(),
  updatePhotoDescriptionMock: vi.fn(),
  executeRetagForLetterMock: vi.fn(),
  verifyExtraContentMock: vi.fn(),
  verifyPhotoDescriptionMock: vi.fn(),
  unverifyExtraContentMock: vi.fn(),
  unverifyPhotoDescriptionMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  and: vi.fn((...clauses: unknown[]) => clauses),
  or: vi.fn((...clauses: unknown[]) => clauses),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  isNotNull: vi.fn((field: unknown) => ({ field, isNotNull: true })),
  ilike: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  asc: vi.fn((field: unknown) => ({ field, direction: 'asc' })),
  desc: vi.fn((field: unknown) => ({ field, direction: 'desc' })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    { raw: vi.fn() }
  ),
}));

vi.mock('../../../db/index.js', () => {
  dbInsertMock.mockImplementation(() => ({
    values: insertValuesMock,
  }));
  insertValuesMock.mockImplementation(() => ({
    returning: insertReturningMock,
  }));
  dbUpdateMock.mockImplementation(() => ({
    set: updateSetMock,
  }));
  updateSetMock.mockImplementation(() => ({
    where: updateWhereMock,
  }));

  return {
    db: {
      query: {
        letterPages: {
          findFirst: findFirstMock,
        },
      },
      insert: dbInsertMock,
      update: dbUpdateMock,
    },
    letters: {
      id: 'letters.id',
      collectionId: 'letters.collectionId',
      dateRaw: 'letters.dateRaw',
      typeSequence: 'letters.typeSequence',
    },
    letterPages: {
      id: 'letterPages.id',
    },
  };
});

vi.mock('../../../services/storage.js', () => ({
  getAbsoluteStoragePath: getAbsoluteStoragePathMock,
}));

vi.mock('../../../services/line-finder.js', () => ({
  savePageLineSegments: vi.fn(),
}));

vi.mock('../../../services/letters.js', () => ({
  getLetterById: getLetterByIdMock,
  resetLetterForProcessing: vi.fn(),
}));

vi.mock('../../../pipeline/metadataV2.js', () => ({
  runMetadataExtractionV2: vi.fn(),
  runEntityExtractionOnly: vi.fn(),
}));

vi.mock('../../../services/letter-queries.js', () => ({
  queryAdminLetters: vi.fn(),
  adminLettersQuerySchema: { parse: vi.fn() },
  fetchLetterWithRelatedAndTransform: fetchLetterWithRelatedAndTransformMock,
}));

vi.mock('../../../services/processing-queue.js', () => ({
  getProcessingStatus: vi.fn(),
  getQueueStatus: vi.fn(),
  requestBackgroundWorkerRun: vi.fn(),
  startTranscriptionProcessing: vi.fn(),
  startMetadataProcessing: vi.fn(),
  pauseProcessing: vi.fn(),
  resumeProcessing: vi.fn(),
  abortProcessing: vi.fn(),
  removeFromQueue: vi.fn(),
  clearQueue: vi.fn(),
  retryJob: vi.fn(),
  cancelActiveJob: vi.fn(),
  startEntityExtractionProcessing: vi.fn(),
  processingFilterSchema: { parse: vi.fn() },
  queueJobTypeSchema: { parse: vi.fn() },
}));

vi.mock('../../../services/letter-operations.js', () => ({
  bulkTranscribe: vi.fn(),
  bulkExtractMetadata: vi.fn(),
  bulkClearTranscriptions: vi.fn(),
  bulkUpdateFields: vi.fn(),
  bulkClearMetadata: vi.fn(),
  buildLetterUpdates: buildLetterUpdatesMock,
  getVersions: vi.fn(),
  createVersion: createVersionMock,
  restoreVersion: vi.fn(),
  verifyTranscript: verifyTranscriptMock,
  unverifyTranscript: unverifyTranscriptMock,
  verifyMetadata: verifyMetadataMock,
  unverifyMetadata: unverifyMetadataMock,
  regenerateTranscription: regenerateTranscriptionMock,
  transcribeLetterOnly: transcribeLetterOnlyMock,
  transcribeExtras: transcribeExtrasMock,
  describePhoto: describePhotoMock,
  updateExtraContent: updateExtraContentMock,
  updatePhotoDescription: updatePhotoDescriptionMock,
  verifyExtraContent: verifyExtraContentMock,
  verifyPhotoDescription: verifyPhotoDescriptionMock,
  unverifyExtraContent: unverifyExtraContentMock,
  unverifyPhotoDescription: unverifyPhotoDescriptionMock,
  updateAiNotes: vi.fn(),
  updateLinkedPerson: vi.fn(),
  updateLinkedPlace: vi.fn(),
  addLinkedPerson: vi.fn(),
  addLinkedPlace: vi.fn(),
  removeLinkedPerson: vi.fn(),
  removeLinkedPlace: vi.fn(),
}));

vi.mock('../../../services/metadata-update.js', () => ({
  executeRetagForLetter: executeRetagForLetterMock,
}));

import lettersRouter from '../letters.js';

const LETTER_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = 'collection-009-page-1';

function createStoredPage(overrides: Record<string, unknown> = {}) {
  return {
    id: PAGE_ID,
    storagePath: 'collections/009/19470810/L01/009-19470810-L01-01.jpg',
    lineSegments: [{ id: 10 }],
    ...overrides,
  };
}

function createLetterDto(overrides: Record<string, unknown> = {}) {
  return {
    id: LETTER_ID,
    transcriptionText: 'Edited line one\nEdited line two',
    workflow: 'TRANSCRIBED',
    ...overrides,
  };
}

function createVerifiedLetterDto(overrides: Record<string, unknown> = {}) {
  return createLetterDto({
    transcriptVerifiedBy: 'admin',
    transcriptVerifiedAt: '2026-03-09T12:00:00.000Z',
    metadataVerifiedBy: 'admin',
    metadataVerifiedAt: '2026-03-09T12:05:00.000Z',
    ...overrides,
  });
}

describe('admin letters line review route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stored line segments for a page', async () => {
    const segments = [{ id: 999, bbox: [1, 2, 3, 4] }];
    findFirstMock.mockResolvedValueOnce({ lineSegments: segments });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ lineSegments: segments });
  });

  it('returns empty array when page has no line segments', async () => {
    findFirstMock.mockResolvedValueOnce({ lineSegments: null });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ lineSegments: [] });
  });

  it('updates transcript text through the letter update route and returns the refreshed DTO', async () => {
    buildLetterUpdatesMock.mockResolvedValueOnce({
      dbUpdates: {
        transcriptionText: 'Edited line one\nEdited line two',
      },
      workflowChange: null,
    });
    updateWhereMock.mockResolvedValueOnce(undefined);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(createLetterDto());

    const response = await invokeRouter(lettersRouter, {
      method: 'PUT',
      url: `/letters/${LETTER_ID}`,
      path: `/letters/${LETTER_ID}`,
      body: {
        transcriptionText: 'Edited line one\nEdited line two',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(buildLetterUpdatesMock).toHaveBeenCalledWith(
      LETTER_ID,
      {
        transcriptionText: 'Edited line one\nEdited line two',
      },
      'admin',
    );
    expect(updateSetMock).toHaveBeenCalledWith({
      transcriptionText: 'Edited line one\nEdited line two',
    });
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(createLetterDto());
  });

  it('creates transcript versions after validating the target letter exists', async () => {
    getLetterByIdMock.mockResolvedValueOnce({ id: LETTER_ID });
    createVersionMock.mockResolvedValueOnce({
      versionNumber: 3,
      fieldType: 'transcript',
      source: 'human',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/versions`,
      path: `/letters/${LETTER_ID}/versions`,
      body: {
        fieldType: 'transcript',
        content: 'Edited line one\nEdited line two',
        source: 'human',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(getLetterByIdMock).toHaveBeenCalledWith(LETTER_ID);
    expect(createVersionMock).toHaveBeenCalledWith(LETTER_ID, {
      fieldType: 'transcript',
      content: 'Edited line one\nEdited line two',
      source: 'human',
    });
    expect(response.body).toEqual({
      versionNumber: 3,
      fieldType: 'transcript',
      source: 'human',
    });
  });

  it('re-tags metadata immediately and returns the refreshed letter DTO', async () => {
    const refreshedLetter = createLetterDto({
      metadata: {
        sender: 'Ada Lovelace',
        recipient: 'Charles Babbage',
        hook: 'Ada Lovelace shares a mathematical note with Charles Babbage.',
        description: 'Ada Lovelace writes to Charles Babbage about an analytical engine idea.',
      },
    });

    getLetterByIdMock.mockResolvedValueOnce({ id: LETTER_ID });
    executeRetagForLetterMock.mockResolvedValueOnce({ status: 'updated' });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(refreshedLetter);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/retag`,
      path: `/letters/${LETTER_ID}/retag`,
      body: {
        field: 'sender',
        oldSender: 'A. Lovelace',
        newSender: 'Ada Lovelace',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(getLetterByIdMock).toHaveBeenCalledWith(LETTER_ID);
    expect(executeRetagForLetterMock).toHaveBeenCalledWith(LETTER_ID, {
      field: 'sender',
      oldSender: 'A. Lovelace',
      newSender: 'Ada Lovelace',
    });
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(refreshedLetter);
  });

  it('passes includeExtras through regeneration and returns the refreshed letter DTO', async () => {
    regenerateTranscriptionMock.mockResolvedValueOnce({
      mainTranscript: true,
      extras: true,
      extrasCount: 2,
    });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(createLetterDto());

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/regenerate-transcription?includeExtras=true`,
      path: `/letters/${LETTER_ID}/regenerate-transcription`,
      query: { includeExtras: 'true' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(regenerateTranscriptionMock).toHaveBeenCalledWith(LETTER_ID, true);
    expect(response.body).toEqual({
      letter: createLetterDto(),
      regenerated: {
        mainTranscript: true,
        extras: true,
        extrasCount: 2,
      },
    });
  });

  it('returns a request-correlated 400 when transcribe-letter hits a typed status error', async () => {
    transcribeLetterOnlyMock.mockRejectedValueOnce(
      Object.assign(new Error('Letter has no pages to transcribe'), { status: 400 }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/transcribe-letter`,
      path: `/letters/${LETTER_ID}/transcribe-letter`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'Letter has no pages to transcribe',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('transcribes extra content and returns the refreshed letter DTO', async () => {
    transcribeExtrasMock.mockResolvedValueOnce({
      transcribedCount: 2,
      extraContentStatus: 'AI_DRAFT',
    });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        extraContentTranscript: 'Postscript one\nPostscript two',
        extraContentStatus: 'AI_DRAFT',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/transcribe-extras`,
      path: `/letters/${LETTER_ID}/transcribe-extras`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(transcribeExtrasMock).toHaveBeenCalledWith(LETTER_ID);
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual({
      letter: createLetterDto({
        extraContentTranscript: 'Postscript one\nPostscript two',
        extraContentStatus: 'AI_DRAFT',
      }),
      transcribedCount: 2,
      extraContentStatus: 'AI_DRAFT',
    });
  });

  it('injects requestId into manual extra-content validation errors', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'PUT',
      url: `/letters/${LETTER_ID}/extra-content`,
      path: `/letters/${LETTER_ID}/extra-content`,
      body: {},
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'extraContent field required',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('updates extra content and returns the refreshed letter DTO', async () => {
    updateExtraContentMock.mockResolvedValueOnce(true);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        extraContentTranscript: 'Typed by an admin',
        extraContentStatus: 'EDITED',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'PUT',
      url: `/letters/${LETTER_ID}/extra-content`,
      path: `/letters/${LETTER_ID}/extra-content`,
      body: { extraContent: 'Typed by an admin' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateExtraContentMock).toHaveBeenCalledWith(LETTER_ID, 'Typed by an admin');
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(
      createLetterDto({
        extraContentTranscript: 'Typed by an admin',
        extraContentStatus: 'EDITED',
      }),
    );
  });

  it('describes a photo and returns the refreshed letter DTO', async () => {
    describePhotoMock.mockResolvedValueOnce({
      describedCount: 1,
      photoDescriptionStatus: 'AI_DRAFT',
    });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        photoDescription: 'A small snapshot showing two children beside a porch railing.',
        photoDescriptionStatus: 'AI_DRAFT',
        photoDescriptionContext: 'Likely Jimmy and Molly',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/describe-photo`,
      path: `/letters/${LETTER_ID}/describe-photo`,
      body: { photoDescriptionContext: 'Likely Jimmy and Molly' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(describePhotoMock).toHaveBeenCalledWith(LETTER_ID, 'Likely Jimmy and Molly');
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual({
      letter: createLetterDto({
        photoDescription: 'A small snapshot showing two children beside a porch railing.',
        photoDescriptionStatus: 'AI_DRAFT',
        photoDescriptionContext: 'Likely Jimmy and Molly',
      }),
      describedCount: 1,
      photoDescriptionStatus: 'AI_DRAFT',
    });
  });

  it('injects requestId into manual photo-description validation errors', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'PUT',
      url: `/letters/${LETTER_ID}/photo-description`,
      path: `/letters/${LETTER_ID}/photo-description`,
      body: {},
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'photoDescription field required',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('updates photo description and returns the refreshed letter DTO', async () => {
    updatePhotoDescriptionMock.mockResolvedValueOnce(true);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        photoDescription: 'A corrected porch snapshot description.',
        photoDescriptionStatus: 'EDITED',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'PUT',
      url: `/letters/${LETTER_ID}/photo-description`,
      path: `/letters/${LETTER_ID}/photo-description`,
      body: { photoDescription: 'A corrected porch snapshot description.' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updatePhotoDescriptionMock).toHaveBeenCalledWith(LETTER_ID, {
      photoDescription: 'A corrected porch snapshot description.',
      photoDescriptionContext: undefined,
    });
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(
      createLetterDto({
        photoDescription: 'A corrected porch snapshot description.',
        photoDescriptionStatus: 'EDITED',
      }),
    );
  });

  it('accepts legacy extraContentTranscript payloads for extra-content updates', async () => {
    updateExtraContentMock.mockResolvedValueOnce(true);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        extraContentTranscript: 'Legacy payload text',
        extraContentStatus: 'EDITED',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'PUT',
      url: `/letters/${LETTER_ID}/extra-content`,
      path: `/letters/${LETTER_ID}/extra-content`,
      body: { extraContentTranscript: 'Legacy payload text' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateExtraContentMock).toHaveBeenCalledWith(LETTER_ID, 'Legacy payload text');
    expect(response.body).toEqual(
      createLetterDto({
        extraContentTranscript: 'Legacy payload text',
        extraContentStatus: 'EDITED',
      }),
    );
  });

  it('verifies extra content through the admin letters route', async () => {
    verifyExtraContentMock.mockResolvedValueOnce({ previousStatus: 'EDITED' });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        extraContentStatus: 'VERIFIED',
        extraContentVerifiedBy: 'admin',
        extraContentVerifiedAt: '2026-03-09T12:15:00.000Z',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/verify-extra-content`,
      path: `/letters/${LETTER_ID}/verify-extra-content`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(verifyExtraContentMock).toHaveBeenCalledWith(LETTER_ID, 'admin');
    expect(response.body).toEqual(
      createLetterDto({
        extraContentStatus: 'VERIFIED',
        extraContentVerifiedBy: 'admin',
        extraContentVerifiedAt: '2026-03-09T12:15:00.000Z',
      }),
    );
  });

  it('verifies photo description through the admin letters route', async () => {
    verifyPhotoDescriptionMock.mockResolvedValueOnce({ previousStatus: 'EDITED' });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        photoDescriptionStatus: 'VERIFIED',
        photoDescriptionVerifiedBy: 'admin',
        photoDescriptionVerifiedAt: '2026-03-09T12:20:00.000Z',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/verify-photo-description`,
      path: `/letters/${LETTER_ID}/verify-photo-description`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(verifyPhotoDescriptionMock).toHaveBeenCalledWith(LETTER_ID, 'admin');
    expect(response.body).toEqual(
      createLetterDto({
        photoDescriptionStatus: 'VERIFIED',
        photoDescriptionVerifiedBy: 'admin',
        photoDescriptionVerifiedAt: '2026-03-09T12:20:00.000Z',
      }),
    );
  });

  it('returns a request-correlated 404 when unverify-extra-content cannot find a verified draft', async () => {
    unverifyExtraContentMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/unverify-extra-content`,
      path: `/letters/${LETTER_ID}/unverify-extra-content`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(unverifyExtraContentMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual({
      error: 'Letter not found or not verified',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('returns a request-correlated 404 when unverify-photo-description cannot find a verified draft', async () => {
    unverifyPhotoDescriptionMock.mockResolvedValueOnce(null);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/unverify-photo-description`,
      path: `/letters/${LETTER_ID}/unverify-photo-description`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(unverifyPhotoDescriptionMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual({
      error: 'Letter not found or not verified',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it.each([
    {
      name: 'verifies transcript through the admin letters route',
      path: `/letters/${LETTER_ID}/verify-transcript`,
      serviceMock: verifyTranscriptMock,
      dto: createVerifiedLetterDto({ metadataVerifiedAt: null, metadataVerifiedBy: null }),
      expectedArgs: [LETTER_ID, 'admin'],
    },
    {
      name: 'removes transcript verification through the admin letters route',
      path: `/letters/${LETTER_ID}/unverify-transcript`,
      serviceMock: unverifyTranscriptMock,
      dto: createLetterDto({ transcriptVerifiedAt: null, transcriptVerifiedBy: null }),
      expectedArgs: [LETTER_ID],
    },
    {
      name: 'verifies metadata through the admin letters route',
      path: `/letters/${LETTER_ID}/verify-metadata`,
      serviceMock: verifyMetadataMock,
      dto: createVerifiedLetterDto({ transcriptVerifiedAt: null, transcriptVerifiedBy: null }),
      expectedArgs: [LETTER_ID, 'admin'],
    },
    {
      name: 'removes metadata verification through the admin letters route',
      path: `/letters/${LETTER_ID}/unverify-metadata`,
      serviceMock: unverifyMetadataMock,
      dto: createLetterDto({ metadataVerifiedAt: null, metadataVerifiedBy: null }),
      expectedArgs: [LETTER_ID],
    },
  ])('$name', async ({ path, serviceMock, dto, expectedArgs }) => {
    serviceMock.mockResolvedValueOnce(true);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(dto);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: path,
      path,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(serviceMock).toHaveBeenCalledWith(...expectedArgs);
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(dto);
  });

  it('toggles the follow-up flag and returns the refreshed letter DTO', async () => {
    getLetterByIdMock.mockResolvedValueOnce({ id: LETTER_ID });
    updateWhereMock.mockResolvedValueOnce(undefined);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(
      createLetterDto({
        flagged: true,
        flaggedBy: 'admin',
        flaggedAt: '2026-03-09T12:10:00.000Z',
      }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/${LETTER_ID}/flag`,
      path: `/letters/${LETTER_ID}/flag`,
      body: { flagged: true },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(getLetterByIdMock).toHaveBeenCalledWith(LETTER_ID);
    expect(updateSetMock).toHaveBeenCalledWith({
      flagged: true,
      flaggedAt: expect.any(Date),
      flaggedBy: 'admin',
    });
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(
      createLetterDto({
        flagged: true,
        flaggedBy: 'admin',
        flaggedAt: '2026-03-09T12:10:00.000Z',
      }),
    );
  });
});
