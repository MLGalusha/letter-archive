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
  getAbsoluteStoragePath: getAbsoluteStoragePathMock,
}));

vi.mock('../../../services/line-finder.js', () => ({
  detectAndStorePageLines: detectAndStorePageLinesMock,
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

const LETTER_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = 'collection-009-page-1';

function createAlgorithmOutput(overrides: Record<string, unknown> = {}) {
  return {
    bbox: [10, 20, 300, 40],
    confidence: 0.92,
    isPhantom: false,
    wasMerged: false,
    hppOverlap: 0.84,
    visionWordCount: 6,
    transcriptMatchScore: 0.91,
    ...overrides,
  };
}

function createPageContext(overrides: Record<string, unknown> = {}) {
  return {
    medianRmsContrast: 0.44,
    medianVariance: 0.51,
    medianDensity: 0.72,
    medianMinValue: 0.12,
    totalSegments: 3,
    totalVisionBoxes: 18,
    imageWidth: 1600,
    imageHeight: 2200,
    ...overrides,
  };
}

function createLineCorrectionBody(
  overrides: Partial<{
    collectionCode: string;
    correctionType: string;
    algorithmOutput: Record<string, unknown>;
    correctedBbox: [number, number, number, number];
    correctedIsDeleted: boolean;
    sourceSegmentIds: number[];
    pageContext: Record<string, unknown>;
  }> = {},
) {
  return {
    letterId: LETTER_ID,
    collectionCode: '009',
    correctionType: 'reject_phantom',
    algorithmOutput: createAlgorithmOutput(),
    sourceSegmentIds: [101],
    pageContext: createPageContext(),
    ...overrides,
  };
}

function createStoredPage(overrides: Record<string, unknown> = {}) {
  return {
    id: PAGE_ID,
    storagePath: 'collections/009/19470810/L01/009-19470810-L01-01.jpg',
    lineSegments: [{ id: 10 }],
    ocrWordBoxes: [{ text: 'Dear', bbox: [10, 20, 30, 10] }],
    reconciledLines: [
      {
        sourceSegmentIds: [101],
        isDeleted: false,
        isPhantom: true,
        bbox: [10, 20, 300, 40],
      },
      {
        sourceSegmentIds: [202],
        isDeleted: false,
        isPhantom: false,
        bbox: [20, 80, 260, 36],
      },
    ],
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

describe('admin letters line review route integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects requestId into manual line-correction validation errors', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/pages/${PAGE_ID}/line-corrections`,
      path: `/letters/pages/${PAGE_ID}/line-corrections`,
      body: { letterId: 'bad-shape' },
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

  it('records reject_phantom corrections and updates matching reconciled lines', async () => {
    findFirstMock.mockResolvedValueOnce(createStoredPage());
    insertReturningMock.mockResolvedValueOnce([
      { id: 'corr-1', correctionType: 'reject_phantom' },
    ]);
    updateWhereMock.mockResolvedValueOnce(undefined);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/pages/${PAGE_ID}/line-corrections`,
      path: `/letters/pages/${PAGE_ID}/line-corrections`,
      body: createLineCorrectionBody(),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(dbInsertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: PAGE_ID,
        letterId: LETTER_ID,
        correctionType: 'reject_phantom',
        sourceSegmentIds: [101],
      }),
    );
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciledLines: [
          expect.objectContaining({
            sourceSegmentIds: [101],
            isPhantom: false,
          }),
          expect.objectContaining({
            sourceSegmentIds: [202],
            isPhantom: false,
          }),
        ],
        updatedAt: expect.any(Date),
      }),
    );
    expect(response.body).toEqual({
      correction: { id: 'corr-1', correctionType: 'reject_phantom' },
      reconciledLines: [
        expect.objectContaining({
          sourceSegmentIds: [101],
          isDeleted: false,
          isPhantom: false,
        }),
        expect.objectContaining({
          sourceSegmentIds: [202],
          isDeleted: false,
          isPhantom: false,
        }),
      ],
    });
  });

  it('applies resize corrections to the reconciled line bbox override', async () => {
    findFirstMock.mockResolvedValueOnce(createStoredPage());
    insertReturningMock.mockResolvedValueOnce([
      { id: 'corr-2', correctionType: 'resize' },
    ]);
    updateWhereMock.mockResolvedValueOnce(undefined);

    const correctedBbox: [number, number, number, number] = [12, 18, 340, 44];
    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/pages/${PAGE_ID}/line-corrections`,
      path: `/letters/pages/${PAGE_ID}/line-corrections`,
      body: createLineCorrectionBody({
        correctionType: 'resize',
        correctedBbox,
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      correction: { id: 'corr-2', correctionType: 'resize' },
      reconciledLines: [
        expect.objectContaining({
          sourceSegmentIds: [101],
          bbox: correctedBbox,
          adminBboxOverride: correctedBbox,
        }),
        expect.objectContaining({
          sourceSegmentIds: [202],
          bbox: [20, 80, 260, 36],
        }),
      ],
    });
  });

  it('returns detected line data with stored OCR fallbacks when the detector omits them', async () => {
    findFirstMock.mockResolvedValueOnce(createStoredPage());
    getAbsoluteStoragePathMock.mockReturnValueOnce('/tmp/collection-009-page-1.jpg');
    detectAndStorePageLinesMock.mockResolvedValueOnce({
      lineSegments: [{ id: 999, bbox: [1, 2, 3, 4] }],
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/pages/${PAGE_ID}/detect-lines`,
      path: `/letters/pages/${PAGE_ID}/detect-lines`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(getAbsoluteStoragePathMock).toHaveBeenCalledWith(
      'collections/009/19470810/L01/009-19470810-L01-01.jpg',
    );
    expect(detectAndStorePageLinesMock).toHaveBeenCalledWith(
      PAGE_ID,
      '/tmp/collection-009-page-1.jpg',
    );
    expect(response.body).toEqual({
      lineSegments: [{ id: 999, bbox: [1, 2, 3, 4] }],
      ocrWordBoxes: [{ text: 'Dear', bbox: [10, 20, 30, 10] }],
      reconciledLines: expect.arrayContaining([
        expect.objectContaining({
          sourceSegmentIds: [101],
          isPhantom: true,
        }),
      ]),
    });
  });

  it('propagates line-detection failures through the error handler with request id', async () => {
    findFirstMock.mockResolvedValueOnce(createStoredPage());
    getAbsoluteStoragePathMock.mockReturnValueOnce('/tmp/collection-009-page-1.jpg');
    detectAndStorePageLinesMock.mockRejectedValueOnce(new Error('opencv offline'));

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/pages/${PAGE_ID}/detect-lines`,
      path: `/letters/pages/${PAGE_ID}/detect-lines`,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({
      error: 'Internal server error',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
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
    expect(buildLetterUpdatesMock).toHaveBeenCalledWith(LETTER_ID, {
      transcriptionText: 'Edited line one\nEdited line two',
    });
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
});
