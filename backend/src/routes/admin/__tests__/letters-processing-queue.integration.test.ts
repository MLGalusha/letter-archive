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
  getQueueStatusMock,
  getProcessingStatusMock,
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
  getQueueStatusMock: vi.fn(),
  getProcessingStatusMock: vi.fn(),
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
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  })),
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
    lineCorrections: {
      id: 'lineCorrections.id',
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
  getLetterById: vi.fn(),
  resetLetterForProcessing: vi.fn(),
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
  updateExtraContent: vi.fn(),
  verifyExtraContent: vi.fn(),
  unverifyExtraContent: vi.fn(),
  updateAiNotes: vi.fn(),
  updateLinkedPerson: vi.fn(),
  updateLinkedPlace: vi.fn(),
  addLinkedPerson: vi.fn(),
  addLinkedPlace: vi.fn(),
  removeLinkedPerson: vi.fn(),
  removeLinkedPlace: vi.fn(),
  resyncCheck: vi.fn(),
  resyncLetterMetadata: vi.fn(),
}));

vi.mock('../../../services/line-reconciliation.js', () => ({
  calibrateThresholds: vi.fn(),
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
});
