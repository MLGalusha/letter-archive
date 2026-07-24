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
  getLetterByIdMock,
  resetLetterForProcessingMock,
  getQueueStatusMock,
  requestBackgroundWorkerRunMock,
  startTranscriptionProcessingMock,
  startMetadataProcessingMock,
  startEntityExtractionProcessingMock,
  removeFromQueueMock,
  clearQueueMock,
  retryJobMock,
  cancelActiveJobMock,
  processingFilterParseMock,
  queueJobTypeParseMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  resetLetterForProcessingMock: vi.fn(),
  getQueueStatusMock: vi.fn(),
  requestBackgroundWorkerRunMock: vi.fn(),
  startTranscriptionProcessingMock: vi.fn(),
  startMetadataProcessingMock: vi.fn(),
  startEntityExtractionProcessingMock: vi.fn(),
  removeFromQueueMock: vi.fn(),
  clearQueueMock: vi.fn(),
  retryJobMock: vi.fn(),
  cancelActiveJobMock: vi.fn(),
  processingFilterParseMock: vi.fn(),
  queueJobTypeParseMock: vi.fn(),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
  ne: vi.fn((field: unknown, value: unknown) => ({ field, value, operator: 'ne' })),
  and: vi.fn((...clauses: unknown[]) => clauses),
  or: vi.fn((...clauses: unknown[]) => clauses),
  inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
  isNotNull: vi.fn((field: unknown) => ({ field, isNotNull: true })),
  isNull: vi.fn((field: unknown) => ({ field, isNull: true })),
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
      type: 'letters.type',
      typeSequence: 'letters.typeSequence',
      workflow: 'letters.workflow',
      transcriptionStatus: 'letters.transcriptionStatus',
      transcriptionRunId: 'letters.transcriptionRunId',
      transcriptionLeaseExpiresAt: 'letters.transcriptionLeaseExpiresAt',
      transcriptionClaimKind: 'letters.transcriptionClaimKind',
      metadataStatus: 'letters.metadataStatus',
      metadataRunId: 'letters.metadataRunId',
      metadataRunRevision: 'letters.metadataRunRevision',
      metadataLeaseExpiresAt: 'letters.metadataLeaseExpiresAt',
      metadataLeaseRunId: 'letters.metadataLeaseRunId',
      metadataClaimKind: 'letters.metadataClaimKind',
      entityExtractionStatus: 'letters.entityExtractionStatus',
      extraContentJobStatus: 'letters.extraContentJobStatus',
      transcriptConfirmedAt: 'letters.transcriptConfirmedAt',
      transcriptionText: 'letters.transcriptionText',
      deadLetter: 'letters.deadLetter',
    },
    letterPages: {
      id: 'letterPages.id',
      letterId: 'letterPages.letterId',
    },
  };
});

vi.mock('../../../services/storage.js', () => ({
  getAbsoluteStoragePath: vi.fn(),
}));

vi.mock('../../../services/letters.js', () => ({
  getLetterById: getLetterByIdMock,
  resetLetterForProcessing: resetLetterForProcessingMock,
}));

vi.mock('../../../pipeline/metadataV2.js', () => ({
  runMetadataExtractionV2: vi.fn(),
  runEntityExtractionOnly: vi.fn(),
}));

vi.mock('../../../services/letter-queries.js', () => ({
  queryAdminLetters: vi.fn(),
  adminLettersQuerySchema: { parse: vi.fn() },
  fetchLetterWithRelatedAndTransform: vi.fn(),
}));

vi.mock('../../../services/processing-queue.js', () => ({
  getQueueStatus: getQueueStatusMock,
  requestBackgroundWorkerRun: requestBackgroundWorkerRunMock,
  startTranscriptionProcessing: startTranscriptionProcessingMock,
  startMetadataProcessing: startMetadataProcessingMock,
  removeFromQueue: removeFromQueueMock,
  clearQueue: clearQueueMock,
  retryJob: retryJobMock,
  cancelActiveJob: cancelActiveJobMock,
  startEntityExtractionProcessing: startEntityExtractionProcessingMock,
  processingFilterSchema: { parse: processingFilterParseMock },
  queueJobTypeSchema: { parse: queueJobTypeParseMock },
}));

vi.mock('../../../services/letter-operations.js', () => ({
  bulkTranscribe: vi.fn(),
  bulkExtractMetadata: vi.fn(),
  bulkClearTranscriptions: vi.fn(),
  bulkUpdateFields: vi.fn(),
  bulkClearMetadata: vi.fn(),
  updateLetter: vi.fn(),
  getVersions: vi.fn(),
  createVersion: vi.fn(),
  restoreVersion: vi.fn(),
  verifyTranscript: vi.fn(),
  unverifyTranscript: vi.fn(),
  verifyMetadata: vi.fn(),
  unverifyMetadata: vi.fn(),
  regenerateTranscription: vi.fn(),
  transcribeLetterOnly: vi.fn(),
  transcribeExtras: vi.fn(),
  describePhoto: vi.fn(),
  updateExtraContent: vi.fn(),
  updatePhotoDescription: vi.fn(),
  verifyExtraContent: vi.fn(),
  verifyPhotoDescription: vi.fn(),
  unverifyExtraContent: vi.fn(),
  unverifyPhotoDescription: vi.fn(),
  updateAiNotes: vi.fn(),
  updateLinkedPerson: vi.fn(),
  updateLinkedPlace: vi.fn(),
  addLinkedPerson: vi.fn(),
  addLinkedPlace: vi.fn(),
  removeLinkedPerson: vi.fn(),
  removeLinkedPlace: vi.fn(),
}));

import lettersRouter from '../letters.js';

function createQueueStatus() {
  return {
    active: [],
    queued: {
      transcription: [],
      metadata: [],
      entityExtraction: [],
      extraContent: [],
    },
    recent: [],
    worker: {
      lastTickAt: null,
      isPolling: false,
      lastError: null,
      currentBatchSize: null,
      updatedAt: null,
    },
    counts: {
      activeCount: 0,
      queuedTranscription: 0,
      queuedMetadata: 0,
      queuedEntityExtraction: 0,
      queuedExtraContent: 0,
      recentSuccessCount: 0,
      recentFailedCount: 0,
      recentClearedCount: 0,
    },
  };
}

describe('admin letters processing queue integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processingFilterParseMock.mockImplementation((value) => value);
    queueJobTypeParseMock.mockImplementation((value) => value);
    requestBackgroundWorkerRunMock.mockResolvedValue(false);
  });

  it('returns queue status from the processing service', async () => {
    getQueueStatusMock.mockResolvedValue(createQueueStatus());

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: '/processing/queue',
      path: '/processing/queue',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(createQueueStatus());
  });

  it('starts transcription with validated filter options', async () => {
    processingFilterParseMock.mockReturnValue({ collectionCode: '009' });
    startTranscriptionProcessingMock.mockResolvedValue({
      message: 'Worker requested; matching letters are already queued',
      total: 2,
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/start-transcription',
      path: '/processing/start-transcription',
      headers: { accept: 'application/json' },
      body: { collectionCode: '009' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Worker requested; matching letters are already queued',
      total: 2,
    });
    expect(processingFilterParseMock).toHaveBeenCalledWith({ collectionCode: '009' });
    expect(startTranscriptionProcessingMock).toHaveBeenCalledWith({ collectionCode: '009' });
  });

  it('starts entity extraction with validated filter options', async () => {
    processingFilterParseMock.mockReturnValue({ collectionCode: '009', year: 1947 });
    startEntityExtractionProcessingMock.mockResolvedValue({
      message: 'Worker requested; matching letters are already queued',
      total: 3,
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/start-entities',
      path: '/processing/start-entities',
      headers: { accept: 'application/json' },
      body: { collectionCode: '009', year: 1947 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Worker requested; matching letters are already queued',
      total: 3,
    });
    expect(processingFilterParseMock).toHaveBeenCalledWith({
      collectionCode: '009',
      year: 1947,
    });
    expect(startEntityExtractionProcessingMock).toHaveBeenCalledWith({
      collectionCode: '009',
      year: 1947,
    });
  });

  it('rejects cancel requests that do not include a letter id', async () => {
    queueJobTypeParseMock.mockReturnValue('transcription');

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/cancel',
      path: '/processing/cancel',
      headers: { accept: 'application/json' },
      body: { type: 'transcription' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'letterId required',
      requestId: expect.any(String),
    });
    expect(cancelActiveJobMock).not.toHaveBeenCalled();
  });

  it('forwards extra-content cancellation through the durable queue route', async () => {
    queueJobTypeParseMock.mockReturnValue('extra_content');
    cancelActiveJobMock.mockResolvedValue({ message: 'Job cancelled' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/cancel',
      path: '/processing/cancel',
      headers: { accept: 'application/json' },
      body: {
        letterId: 'letter-extra',
        type: 'extra_content',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Job cancelled' });
    expect(queueJobTypeParseMock).toHaveBeenCalledWith('extra_content');
    expect(cancelActiveJobMock).toHaveBeenCalledWith('letter-extra', 'extra_content');
  });

  it('removes a queued job after parsing the queue job type', async () => {
    queueJobTypeParseMock.mockReturnValue('extra_content');
    removeFromQueueMock.mockResolvedValue({ message: 'Removed from queue' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/queue/remove',
      path: '/processing/queue/remove',
      headers: { accept: 'application/json' },
      body: {
        letterId: 'letter-3',
        type: 'extra_content',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Removed from queue' });
    expect(queueJobTypeParseMock).toHaveBeenCalledWith('extra_content');
    expect(removeFromQueueMock).toHaveBeenCalledWith('letter-3', 'extra_content');
  });

  it('clears an entire queue after validating the job type', async () => {
    queueJobTypeParseMock.mockReturnValue('extra_content');
    clearQueueMock.mockResolvedValue({
      message: 'Cleared extra content queue',
      cleared: 4,
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/queue/clear',
      path: '/processing/queue/clear',
      headers: { accept: 'application/json' },
      body: {
        type: 'extra_content',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Cleared extra content queue',
      cleared: 4,
    });
    expect(clearQueueMock).toHaveBeenCalledWith('extra_content');
  });

  it('retries a failed job after validating the job type', async () => {
    queueJobTypeParseMock.mockReturnValue('extra_content');
    retryJobMock.mockResolvedValue({ message: 'Retrying extra_content for letter letter-7' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/queue/retry',
      path: '/processing/queue/retry',
      headers: { accept: 'application/json' },
      body: {
        letterId: 'letter-7',
        type: 'extra_content',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Retrying extra_content for letter letter-7',
    });
    expect(retryJobMock).toHaveBeenCalledWith('letter-7', 'extra_content');
  });

  it('re-enqueues an existing letter for processing', async () => {
    getLetterByIdMock.mockResolvedValue({ id: 'letter-8' });
    resetLetterForProcessingMock.mockResolvedValue(true);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/letters/letter-8/process',
      path: '/letters/letter-8/process',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Letter enqueued for processing',
      letterId: 'letter-8',
    });
    expect(getLetterByIdMock).toHaveBeenCalledWith('letter-8');
    expect(resetLetterForProcessingMock).toHaveBeenCalledWith('letter-8');
    expect(requestBackgroundWorkerRunMock).toHaveBeenCalledWith('letter:process');
  });

  it('does not re-enqueue a letter when an active job wins the reset race', async () => {
    getLetterByIdMock.mockResolvedValue({ id: 'letter-8' });
    resetLetterForProcessingMock.mockResolvedValue(false);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/letters/letter-8/process',
      path: '/letters/letter-8/process',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(requestBackgroundWorkerRunMock).not.toHaveBeenCalled();
  });

  it('returns a request-correlated 404 when reprocessing a missing letter', async () => {
    getLetterByIdMock.mockResolvedValue(undefined);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/letters/missing-letter/process',
      path: '/letters/missing-letter/process',
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
    expect(resetLetterForProcessingMock).not.toHaveBeenCalled();
  });
});
