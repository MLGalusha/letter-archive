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
  getProcessingStatusMock,
  requestBackgroundWorkerRunMock,
  startTranscriptionProcessingMock,
  startMetadataProcessingMock,
  startEntityExtractionProcessingMock,
  pauseProcessingMock,
  resumeProcessingMock,
  abortProcessingMock,
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
  getProcessingStatusMock: vi.fn(),
  requestBackgroundWorkerRunMock: vi.fn(),
  startTranscriptionProcessingMock: vi.fn(),
  startMetadataProcessingMock: vi.fn(),
  startEntityExtractionProcessingMock: vi.fn(),
  pauseProcessingMock: vi.fn(),
  resumeProcessingMock: vi.fn(),
  abortProcessingMock: vi.fn(),
  removeFromQueueMock: vi.fn(),
  clearQueueMock: vi.fn(),
  retryJobMock: vi.fn(),
  cancelActiveJobMock: vi.fn(),
  processingFilterParseMock: vi.fn(),
  queueJobTypeParseMock: vi.fn(),
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
  getAbsoluteStoragePath: vi.fn(),
}));

vi.mock('../../../services/line-finder.js', () => ({
  detectAndStorePageLines: vi.fn(),
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
  getProcessingStatus: getProcessingStatusMock,
  getQueueStatus: getQueueStatusMock,
  requestBackgroundWorkerRun: requestBackgroundWorkerRunMock,
  startTranscriptionProcessing: startTranscriptionProcessingMock,
  startMetadataProcessing: startMetadataProcessingMock,
  pauseProcessing: pauseProcessingMock,
  resumeProcessing: resumeProcessingMock,
  abortProcessing: abortProcessingMock,
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
  buildLetterUpdates: vi.fn(),
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
    },
    recent: [],
    counts: {
      activeCount: 0,
      queuedTranscription: 0,
      queuedMetadata: 0,
      queuedEntityExtraction: 0,
      recentSuccessCount: 0,
      recentFailedCount: 0,
    },
    onDemandProcessing: {
      isRunning: false,
      isPaused: false,
      shouldAbort: false,
      currentJob: null,
      completed: 0,
      failed: 0,
      total: 0,
      errors: [],
      lastCompletedAt: null,
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
      message: 'Started transcription',
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
      message: 'Started transcription',
      total: 2,
    });
    expect(processingFilterParseMock).toHaveBeenCalledWith({ collectionCode: '009' });
    expect(startTranscriptionProcessingMock).toHaveBeenCalledWith({ collectionCode: '009' });
  });

  it('returns a request-correlated 400 when pause fails synchronously', async () => {
    pauseProcessingMock.mockImplementation(() => {
      throw new Error('Already paused');
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/pause',
      path: '/processing/pause',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'Already paused',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('returns a request-correlated 400 when resume fails synchronously', async () => {
    resumeProcessingMock.mockImplementation(() => {
      throw new Error('Not paused');
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/resume',
      path: '/processing/resume',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: 'Not paused',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('starts entity extraction with validated filter options', async () => {
    processingFilterParseMock.mockReturnValue({ collectionCode: '009', year: 1947 });
    startEntityExtractionProcessingMock.mockResolvedValue({
      message: 'Started entity extraction',
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
      message: 'Started entity extraction',
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

  it('aborts the running queue through the processing service', async () => {
    abortProcessingMock.mockResolvedValue({ message: 'Processing aborted' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/abort',
      path: '/processing/abort',
      headers: { accept: 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Processing aborted' });
    expect(abortProcessingMock).toHaveBeenCalledTimes(1);
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

  it('removes a queued job after parsing the queue job type', async () => {
    queueJobTypeParseMock.mockReturnValue('metadata');
    removeFromQueueMock.mockResolvedValue({ message: 'Removed from queue' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/queue/remove',
      path: '/processing/queue/remove',
      headers: { accept: 'application/json' },
      body: {
        letterId: 'letter-3',
        type: 'metadata',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Removed from queue' });
    expect(queueJobTypeParseMock).toHaveBeenCalledWith('metadata');
    expect(removeFromQueueMock).toHaveBeenCalledWith('letter-3', 'metadata');
  });

  it('clears an entire queue after validating the job type', async () => {
    queueJobTypeParseMock.mockReturnValue('entity_extraction');
    clearQueueMock.mockResolvedValue({
      message: 'Cleared entity extraction queue',
      cleared: 4,
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/queue/clear',
      path: '/processing/queue/clear',
      headers: { accept: 'application/json' },
      body: {
        type: 'entity_extraction',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Cleared entity extraction queue',
      cleared: 4,
    });
    expect(clearQueueMock).toHaveBeenCalledWith('entity_extraction');
  });

  it('retries a failed job after validating the job type', async () => {
    queueJobTypeParseMock.mockReturnValue('transcription');
    retryJobMock.mockResolvedValue({ message: 'Retrying transcription for letter letter-7' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: '/processing/queue/retry',
      path: '/processing/queue/retry',
      headers: { accept: 'application/json' },
      body: {
        letterId: 'letter-7',
        type: 'transcription',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: 'Retrying transcription for letter letter-7',
    });
    expect(retryJobMock).toHaveBeenCalledWith('letter-7', 'transcription');
  });

  it('re-enqueues an existing letter for processing', async () => {
    getLetterByIdMock.mockResolvedValue({ id: 'letter-8' });
    resetLetterForProcessingMock.mockResolvedValue(undefined);

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
    expect(requestBackgroundWorkerRunMock).toHaveBeenCalledWith('letter:process', { bypassPause: true });
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
