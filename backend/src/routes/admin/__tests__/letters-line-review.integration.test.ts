import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeRouter } from '../../../test/express-test-utils.js';

const {
  findFirstMock,
  findManyMock,
  dbInsertMock,
  insertValuesMock,
  insertReturningMock,
  dbUpdateMock,
  updateSetMock,
  updateWhereMock,
  getAbsoluteStoragePathMock,
  getLetterByIdMock,
  fetchLetterWithRelatedAndTransformMock,
  updateLetterMock,
  createVersionMock,
  restoreVersionMock,
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
  getPageGeometryEnvelopeMock,
  savePageLineSegmentsMock,
  adaptKrakenNativePageLayoutV2Mock,
  validateStoredPageLayoutMock,
  savePageLayoutV2Mock,
  savePageGeometryProposalMock,
  getCurrentPageGeometryProposalMock,
  updatePageSegmentTrustMock,
  updateLetterSegmentTrustMock,
} = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  dbInsertMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertReturningMock: vi.fn(),
  dbUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  getAbsoluteStoragePathMock: vi.fn(),
  getLetterByIdMock: vi.fn(),
  fetchLetterWithRelatedAndTransformMock: vi.fn(),
  updateLetterMock: vi.fn(),
  createVersionMock: vi.fn(),
  restoreVersionMock: vi.fn(),
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
  getPageGeometryEnvelopeMock: vi.fn(),
  savePageLineSegmentsMock: vi.fn(),
  adaptKrakenNativePageLayoutV2Mock: vi.fn(),
  validateStoredPageLayoutMock: vi.fn(),
  savePageLayoutV2Mock: vi.fn(),
  savePageGeometryProposalMock: vi.fn(),
  getCurrentPageGeometryProposalMock: vi.fn(),
  updatePageSegmentTrustMock: vi.fn(),
  updateLetterSegmentTrustMock: vi.fn(),
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
          findMany: findManyMock,
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
      primarySourceRevision: 'letters.primarySourceRevision',
      deadLetter: 'letters.deadLetter',
    },
    letterPages: {
      id: 'letterPages.id',
      letterId: 'letterPages.letterId',
    },
  };
});

vi.mock('../../../services/storage.js', () => ({
  getAbsoluteStoragePath: getAbsoluteStoragePathMock,
}));

vi.mock('../../../services/letter/correspondence-deletion.js', () => ({
  deleteCorrespondenceGroup: vi.fn(),
}));

vi.mock('../../../services/line-segments.js', () => ({
  getPageGeometryEnvelope: getPageGeometryEnvelopeMock,
  savePageLineSegments: savePageLineSegmentsMock,
  updatePageSegmentTrust: updatePageSegmentTrustMock,
  updateLetterSegmentTrust: updateLetterSegmentTrustMock,
}));

vi.mock('../../../services/kraken-page-layout-adapter.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../services/kraken-page-layout-adapter.js')
  >('../../../services/kraken-page-layout-adapter.js');
  return {
    ...actual,
    adaptKrakenNativePageLayoutV2: adaptKrakenNativePageLayoutV2Mock,
  };
});

vi.mock('../../../services/page-layout.js', () => ({
  savePageLayoutV2: savePageLayoutV2Mock,
}));

vi.mock('../../../services/page-geometry-proposals.js', () => ({
  createPageGeometryProposalRepository: vi.fn(() => ({
    save: savePageGeometryProposalMock,
    getCurrent: getCurrentPageGeometryProposalMock,
  })),
}));

vi.mock('../../../services/stored-page-layout.js', () => ({
  validateStoredPageLayout: validateStoredPageLayoutMock,
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
  getQueueStatus: vi.fn(),
  requestBackgroundWorkerRun: vi.fn(),
  wakeBackgroundWorkerForQueuedProcessing: vi.fn(),
  removeFromQueue: vi.fn(),
  clearQueue: vi.fn(),
  retryJob: vi.fn(),
  cancelActiveJob: vi.fn(),
  queueJobTypeSchema: { parse: vi.fn() },
}));

vi.mock('../../../services/letter-operations.js', () => ({
  bulkTranscribe: vi.fn(),
  bulkExtractMetadata: vi.fn(),
  bulkClearTranscriptions: vi.fn(),
  bulkUpdateFields: vi.fn(),
  bulkClearMetadata: vi.fn(),
  updateLetter: updateLetterMock,
  getVersions: vi.fn(),
  createVersion: createVersionMock,
  restoreVersion: restoreVersionMock,
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
vi.mock('../../../services/letter/ai-notes.js', () => ({
  addAiNote: vi.fn(),
  resolveAiNotesForChangedFields: vi.fn(() => null),
  updateAiNotes: vi.fn(),
  updateAiNoteStatus: vi.fn(),
}));

vi.mock('../../../services/metadata-update.js', () => ({
  executeRetagForLetter: executeRetagForLetterMock,
}));

import lettersRouter from '../letters.js';
import { sourceRevisionChanged } from '../../../services/letter/source-revision.js';

const LETTER_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = 'collection-009-page-1';
const PAGE_UUID = '22222222-2222-4222-8222-222222222222';
const SOURCE_CHECKSUM = 'a'.repeat(64);
const DETECTOR_RUN_ID = 'run-11111111-1111-4111-8111-111111111111';
const NATIVE_LINE_ID = `line-sha256-${'1'.repeat(64)}`;

function createNativePageLayout() {
  return {
    schemaVersion: 2,
    kind: 'PageLayout',
    source: {
      name: 'page.jpg',
      coordinateSpace: 'normalized-image-pixels',
      original: {
        sha256: SOURCE_CHECKSUM,
        width: 200,
        height: 300,
        mode: 'RGB',
        exifOrientation: 1,
      },
      normalized: {
        sha256: 'b'.repeat(64),
        rasterSha256: 'c'.repeat(64),
        rasterChecksumAlgorithm: 'sha256-rgb8-v1',
        width: 200,
        height: 300,
        mode: 'RGB',
        format: 'PNG',
      },
      normalization: {
        operation: 'identity',
        applied: false,
        exifReadError: false,
      },
    },
    producer: {
      engine: 'kraken',
      engineVersion: '7.0.3',
      api: 'kraken.tasks.SegmentationTaskModel',
      model: {
        name: 'blla.mlmodel',
        kind: 'kraken-package-resource',
        sha256: 'c'.repeat(64),
        sizeBytes: 5_000_000,
      },
      config: {
        accelerator: 'cpu',
        device: 'auto',
        precision: '32-true',
        batchSize: 1,
        raiseOnError: true,
        numThreads: 1,
        inputPadding: 0,
        textDirection: 'horizontal-lr',
        effective: {
          accelerator: 'cpu',
          baseline_ro_fn: {
            kind: 'python-callable',
            module: 'kraken.lib.segmentation',
            qualname: 'polygonal_reading_order',
          },
          batch_size: 1,
          bbox_line_padding: 0,
          bbox_ro_fn: {
            kind: 'python-callable',
            module: 'kraken.lib.segmentation',
            qualname: 'reading_order',
          },
          compile_config: null,
          device: 'auto',
          input_padding: 0,
          legacy_black_colseps: false,
          legacy_maxcolseps: 2,
          legacy_no_hlines: true,
          legacy_scale: null,
          num_threads: 1,
          precision: '32-true',
          raise_on_error: true,
          text_direction: 'horizontal-lr',
        },
      },
      runtime: {
        python: {
          version: '3.12.11',
          implementation: 'CPython',
        },
        platform: {
          system: 'Linux',
          release: '6.1.0',
          machine: 'x86_64',
        },
        packages: {
          kraken: '7.0.3',
          torch: '2.12.0',
          pillow: '12.3.0',
          numpy: '2.4.6',
          coremltools: '9.0',
          lightning: '2.6.1',
          safetensors: '0.7.0',
          scikitImage: '0.25.2',
          scikitLearn: '1.7.2',
          scipy: '1.15.3',
          shapely: '2.1.2',
          torchmetrics: '1.9.0',
          torchvision: '0.27.0',
        },
        artifacts: {
          adapter: {
            name: 'letter-archive-kraken-native-layout',
            contractVersion: 2,
            sha256: 'e'.repeat(64),
          },
          constraints: {
            name: 'constraints-runtime.txt',
            sha256: 'f'.repeat(64),
          },
        },
        execution: {
          processMode: 'persistent-worker',
          accelerator: 'cpu',
          configuredDevice: 'auto',
          resolvedDevice: 'cpu',
          resolutionSource: 'model-parameters',
          precision: '32-true',
          modelParameterDevices: ['cpu'],
          modelParameterDtypes: ['torch.float32'],
        },
      },
    },
    segmentation: {
      type: 'baselines',
      textDirection: 'horizontal-lr',
      scriptDetection: false,
      language: null,
      readingOrder: {
        source: 'segmentation.lines',
        lineIds: [NATIVE_LINE_ID],
      },
      alternateReadingOrders: [],
      regions: [],
      lines: [{
        id: NATIVE_LINE_ID,
        providerId: 'provider-line-id',
        identityVersion: 1,
        idSource:
          'derived-source-raster-model-provider-order-geometry-v2',
        providerOrdinal: 0,
        text: null,
        baseDirection: null,
        tags: null,
        providerRegionIds: [],
        regionIds: [],
        unresolvedProviderRegionIds: [],
        language: null,
        geometry: {
          type: 'baselines',
          baseline: [
            { x: 10, y: 30 },
            { x: 180, y: 32 },
          ],
          boundary: [
            { x: 8, y: 10 },
            { x: 185, y: 10 },
            { x: 185, y: 45 },
            { x: 8, y: 45 },
            { x: 8, y: 10 },
          ],
        },
        displayExtent: {
          bbox: [8, 10, 185, 45],
          source: 'derived-boundary-aabb',
          derived: true,
        },
      }],
    },
  };
}

function createRotationNativePageLayout() {
  const native = createNativePageLayout();
  return {
    ...native,
    producer: {
      ...native.producer,
      config: {
        ...native.producer.config,
        rotationProfile: {
          name: 'sideways-recovery-v1',
          evidenceContract: 'native-and-source-projected-v2',
          rotationsDegrees: [0, 90, 270],
          passOutcomes: [
            { rotationDegrees: 0, status: 'succeeded' },
            { rotationDegrees: 90, status: 'succeeded' },
            { rotationDegrees: 270, status: 'succeeded' },
          ],
          mergePolicy:
            'baseline-plus-nonoverlapping-vertical-zones',
          coordinateTransform:
            'pil-pixel-centers-to-source-v1',
          selectionParameters: {
            verticalAxisToleranceDegrees: 15,
            strongBaselineLongEdgeRatio: 0.025,
            zoneJoinPaddingLongEdgeRatio: 0.06,
            zoneMemberPaddingLongEdgeRatio: 0.02,
            minimumStrongProposalClustersPerZone: 2,
            minimumProposalClustersPerZone: 3,
            baselineInterferencePaddingLongEdgeRatio: 0,
            baselineInterferenceHorizontalAxisToleranceDegrees: 20,
            maximumHorizontalBaselineCentroidRatioPerZone: 0.1,
            minimumHorizontalBaselineCentroidAllowancePerZone: 2,
          },
          selectionSummary: {
            rawInputLineCount: 1,
            inputLineCount: 1,
            clusterCount: 0,
            includedClusterCount: 0,
            rejectedClusterCount: 0,
            appendedRotatedLineCount: 0,
          },
        },
      },
    },
  };
}

function createCanonicalPageLayout() {
  return {
    schemaVersion: 2,
    layoutId: `layout-sha256-${'e'.repeat(64)}`,
    pageId: PAGE_ID,
    provenance: {
      model: { checksumSha256: 'c'.repeat(64) },
    },
  };
}

function createStoredPage(overrides: Record<string, unknown> = {}) {
  return {
    id: PAGE_ID,
    storagePath: 'collections/009/19470810/L01/009-19470810-L01-01.jpg',
    lineSegments: [{ id: 10 }],
    ...overrides,
  };
}

const geometryChecksum = 'e'.repeat(64);
const lineSegmentsChecksum = 'f'.repeat(64);

function createGeometryEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    lineSegments: [],
    geometryRevision: 2,
    geometryChecksumSha256: geometryChecksum,
    lineSegmentsChecksumSha256: lineSegmentsChecksum,
    reviewState: {
      trustState: 'unverified',
      approvedGeometryRevision: null,
      approvedGeometryChecksumSha256: null,
      approvedBy: null,
      approvedAt: null,
    },
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
    getPageGeometryEnvelopeMock.mockResolvedValue(createGeometryEnvelope());
    savePageLineSegmentsMock.mockResolvedValue({
      kind: 'saved',
      envelope: createGeometryEnvelope(),
    });
    updatePageSegmentTrustMock.mockResolvedValue({
      kind: 'saved',
      envelope: createGeometryEnvelope(),
    });
    adaptKrakenNativePageLayoutV2Mock.mockReturnValue(createCanonicalPageLayout());
    validateStoredPageLayoutMock.mockReturnValue({ status: 'absent' });
    savePageLayoutV2Mock.mockResolvedValue({
      saved: true,
      checksumSha256: 'd'.repeat(64),
      lineCount: 1,
      projectionAction: 'created',
    });
    savePageGeometryProposalMock.mockResolvedValue({
      kind: 'saved',
      value: {
        id: '33333333-3333-4333-8333-333333333333',
        artifactChecksumSha256: '9'.repeat(64),
        artifact: {
          source: { baseGeometryRevision: 2 },
          candidates: [{ id: 'rotation-candidate-1' }],
        },
        createdBy: 'admin',
        createdAt: new Date('2026-07-31T14:00:00.000Z'),
      },
    });
    getCurrentPageGeometryProposalMock.mockResolvedValue({
      kind: 'none',
    });
    updatePageSegmentTrustMock.mockResolvedValue(true);
    updateLetterSegmentTrustMock.mockResolvedValue(true);
  });

  it('validates and saves native Kraken layout against the queued source identity', async () => {
    const nativePageLayout = createNativePageLayout();
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      path: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      body: {
        nativePageLayout,
        runId: DETECTOR_RUN_ID,
        primarySourceRevision: 4,
        sourceChecksum: SOURCE_CHECKSUM,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(adaptKrakenNativePageLayoutV2Mock).toHaveBeenCalledWith(
      nativePageLayout,
      {
        pageId: PAGE_ID,
        expectedSourceChecksumSha256: SOURCE_CHECKSUM,
        runId: DETECTOR_RUN_ID,
      },
    );
    expect(savePageLayoutV2Mock).toHaveBeenCalledWith(
      PAGE_ID,
      createCanonicalPageLayout(),
      {
        primarySourceRevision: 4,
        sourceChecksum: SOURCE_CHECKSUM,
      },
    );
    expect(response.body).toEqual({
      ok: true,
      layoutId: `layout-sha256-${'e'.repeat(64)}`,
      pageLayoutChecksumSha256: 'd'.repeat(64),
      lineCount: 1,
      projectionAction: 'created',
    });
  });

  it('rejects malformed native Kraken output before persistence', async () => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      path: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      body: {
        nativePageLayout: {
          ...createNativePageLayout(),
          unexpectedFlattenedLines: [],
        },
        runId: DETECTOR_RUN_ID,
        primarySourceRevision: 4,
        sourceChecksum: SOURCE_CHECKSUM,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(adaptKrakenNativePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageLayoutV2Mock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'revision',
      body: {
        nativePageLayout: createNativePageLayout(),
        runId: DETECTOR_RUN_ID,
        sourceChecksum: SOURCE_CHECKSUM,
      },
    },
    {
      label: 'checksum',
      body: {
        nativePageLayout: createNativePageLayout(),
        runId: DETECTOR_RUN_ID,
        primarySourceRevision: 4,
      },
    },
  ])('requires the exact page source $label for native layout writes', async ({ body }) => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      path: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(savePageLayoutV2Mock).not.toHaveBeenCalled();
  });

  it('rejects a detector envelope produced from different source bytes', async () => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });
    const nativePageLayout = createNativePageLayout();
    nativePageLayout.source.original.sha256 = 'f'.repeat(64);

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      path: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      body: {
        nativePageLayout,
        runId: DETECTOR_RUN_ID,
        primarySourceRevision: 4,
        sourceChecksum: SOURCE_CHECKSUM,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(adaptKrakenNativePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageLayoutV2Mock).not.toHaveBeenCalled();
  });

  it('rejects a native layout write if its atomic source/empty-review fence loses', async () => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });
    savePageLayoutV2Mock.mockResolvedValueOnce({
      saved: false,
      checksumSha256: 'd'.repeat(64),
      lineCount: 1,
      projectionAction: null,
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      path: `/letters/pages/${PAGE_ID}/page-layout/kraken`,
      body: {
        nativePageLayout: createNativePageLayout(),
        runId: DETECTOR_RUN_ID,
        primarySourceRevision: 4,
        sourceChecksum: SOURCE_CHECKSUM,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('stores rotation output as an immutable proposal without mutating canonical geometry', async () => {
    const nativePageLayout = createRotationNativePageLayout();
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      path: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      body: {
        nativePageLayout,
        runId: DETECTOR_RUN_ID,
        source: {
          primarySourceRevision: 4,
          sourceChecksumSha256: SOURCE_CHECKSUM,
          baseGeometryRevision: 2,
          baseGeometryChecksumSha256: geometryChecksum,
          baseLineSegmentsChecksumSha256: lineSegmentsChecksum,
        },
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(adaptKrakenNativePageLayoutV2Mock).toHaveBeenCalledWith(
      nativePageLayout,
      {
        pageId: PAGE_ID,
        expectedSourceChecksumSha256: SOURCE_CHECKSUM,
        runId: DETECTOR_RUN_ID,
      },
    );
    expect(savePageGeometryProposalMock).toHaveBeenCalledWith({
      layout: createCanonicalPageLayout(),
      expected: {
        primarySourceRevision: 4,
        sourceChecksumSha256: SOURCE_CHECKSUM,
        baseGeometryRevision: 2,
        baseGeometryChecksumSha256: geometryChecksum,
        baseLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
      actorId: 'admin',
    });
    expect(response.body).toEqual({
      ok: true,
      status: 'saved',
      proposalId: '33333333-3333-4333-8333-333333333333',
      artifactChecksumSha256: '9'.repeat(64),
      candidateCount: 1,
      createdAt: '2026-07-31T14:00:00.000Z',
    });
    expect(savePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('accepts a valid rotation run with no candidates without writing canonical geometry', async () => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });
    savePageGeometryProposalMock.mockResolvedValueOnce({
      kind: 'no-candidates',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      path: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      body: {
        nativePageLayout: createRotationNativePageLayout(),
        runId: DETECTOR_RUN_ID,
        source: {
          primarySourceRevision: 4,
          sourceChecksumSha256: SOURCE_CHECKSUM,
          baseGeometryRevision: 2,
          baseGeometryChecksumSha256: geometryChecksum,
          baseLineSegmentsChecksumSha256: lineSegmentsChecksum,
        },
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      status: 'no-candidates',
      candidateCount: 0,
    });
    expect(savePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('rejects standard detector output on the rotation proposal endpoint', async () => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      path: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      body: {
        nativePageLayout: createNativePageLayout(),
        runId: DETECTOR_RUN_ID,
        source: {
          primarySourceRevision: 4,
          sourceChecksumSha256: SOURCE_CHECKSUM,
          baseGeometryRevision: 2,
          baseGeometryChecksumSha256: geometryChecksum,
          baseLineSegmentsChecksumSha256: lineSegmentsChecksum,
        },
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(adaptKrakenNativePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageGeometryProposalMock).not.toHaveBeenCalled();
  });

  it('rejects rotation output produced from different source bytes', async () => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });
    const nativePageLayout = createRotationNativePageLayout();
    nativePageLayout.source.original.sha256 = '8'.repeat(64);

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      path: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      body: {
        nativePageLayout,
        runId: DETECTOR_RUN_ID,
        source: {
          primarySourceRevision: 4,
          sourceChecksumSha256: SOURCE_CHECKSUM,
          baseGeometryRevision: 2,
          baseGeometryChecksumSha256: geometryChecksum,
          baseLineSegmentsChecksumSha256: lineSegmentsChecksum,
        },
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(adaptKrakenNativePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageGeometryProposalMock).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'source-conflict', code: 'SOURCE_REVISION_CHANGED' },
    { kind: 'geometry-conflict', code: 'GEOMETRY_REVISION_CHANGED' },
    { kind: 'projection-conflict', code: 'LINE_SEGMENTS_CHANGED' },
  ])('maps a $kind proposal fence failure without canonical writes', async ({
    kind,
    code,
  }) => {
    findFirstMock.mockResolvedValueOnce({ id: PAGE_ID });
    savePageGeometryProposalMock.mockResolvedValueOnce({ kind });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      path: `/letters/pages/${PAGE_ID}/geometry-proposals/rotation`,
      body: {
        nativePageLayout: createRotationNativePageLayout(),
        runId: DETECTOR_RUN_ID,
        source: {
          primarySourceRevision: 4,
          sourceChecksumSha256: SOURCE_CHECKSUM,
          baseGeometryRevision: 2,
          baseGeometryChecksumSha256: geometryChecksum,
          baseLineSegmentsChecksumSha256: lineSegmentsChecksum,
        },
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ code });
    expect(savePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('returns only the newest proposal matching current page geometry', async () => {
    getCurrentPageGeometryProposalMock.mockResolvedValueOnce({
      kind: 'found',
      value: {
        id: '33333333-3333-4333-8333-333333333333',
        artifactChecksumSha256: '9'.repeat(64),
        artifact: {
          schemaVersion: 1,
          kind: 'rotation-recovery',
          pageId: PAGE_UUID,
          candidates: [{ id: 'rotation-candidate-1' }],
        },
        createdBy: 'admin',
        createdAt: new Date('2026-07-31T14:00:00.000Z'),
      },
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
      path:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
    });

    expect(response.statusCode).toBe(200);
    expect(getCurrentPageGeometryProposalMock).toHaveBeenCalledWith(
      PAGE_UUID,
    );
    expect(response.body).toEqual({
      proposal: {
        id: '33333333-3333-4333-8333-333333333333',
        artifactChecksumSha256: '9'.repeat(64),
        createdBy: 'admin',
        createdAt: '2026-07-31T14:00:00.000Z',
        artifact: {
          schemaVersion: 1,
          kind: 'rotation-recovery',
          pageId: PAGE_UUID,
          candidates: [{ id: 'rotation-candidate-1' }],
        },
      },
    });
    expect(savePageLayoutV2Mock).not.toHaveBeenCalled();
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('returns an explicit empty response when no exact-current proposal exists', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
      path:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ proposal: null });
  });

  it('fails closed when current editable geometry is corrupt', async () => {
    getCurrentPageGeometryProposalMock.mockResolvedValueOnce({
      kind: 'corrupt-current-geometry',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
      path:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      code: 'CURRENT_PAGE_GEOMETRY_CORRUPT',
    });
  });

  it('fails closed when current page source identity is corrupt', async () => {
    getCurrentPageGeometryProposalMock.mockResolvedValueOnce({
      kind: 'corrupt-current-source',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
      path:
        `/letters/pages/${PAGE_UUID}/geometry-proposals/rotation/current`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      code: 'CURRENT_PAGE_SOURCE_CORRUPT',
    });
  });

  it('returns a stored PageLayout only after schema and checksum validation', async () => {
    const stored = { schemaVersion: 2, layoutId: 'stored' };
    const parsed = createCanonicalPageLayout();
    findFirstMock.mockResolvedValueOnce({
      id: PAGE_ID,
      checksumSha256: SOURCE_CHECKSUM,
      pageLayout: stored,
      pageLayoutChecksumSha256: 'd'.repeat(64),
    });
    validateStoredPageLayoutMock.mockReturnValueOnce({
      status: 'valid',
      layout: parsed,
      checksumSha256: 'd'.repeat(64),
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/page-layout`,
      path: `/letters/pages/${PAGE_ID}/page-layout`,
    });

    expect(response.statusCode).toBe(200);
    expect(validateStoredPageLayoutMock).toHaveBeenCalledWith({
      id: PAGE_ID,
      checksumSha256: SOURCE_CHECKSUM,
      pageLayout: stored,
      pageLayoutChecksumSha256: 'd'.repeat(64),
    });
    expect(response.body).toEqual({
      pageLayout: parsed,
      pageLayoutChecksumSha256: 'd'.repeat(64),
    });
  });

  it('fails closed when a stored PageLayout is malformed', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: PAGE_ID,
      checksumSha256: SOURCE_CHECKSUM,
      pageLayout: { malformed: true },
      pageLayoutChecksumSha256: 'f'.repeat(64),
    });
    validateStoredPageLayoutMock.mockReturnValueOnce({
      status: 'invalid',
      reason: 'layout schema validation failed',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/page-layout`,
      path: `/letters/pages/${PAGE_ID}/page-layout`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('schema validation'),
    });
  });

  it('fails closed when a valid stored PageLayout does not match its checksum', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: PAGE_ID,
      checksumSha256: SOURCE_CHECKSUM,
      pageLayout: { schemaVersion: 2, layoutId: 'stored' },
      pageLayoutChecksumSha256: 'f'.repeat(64),
    });
    validateStoredPageLayoutMock.mockReturnValueOnce({
      status: 'invalid',
      reason: 'layout integrity checksum mismatch',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/page-layout`,
      path: `/letters/pages/${PAGE_ID}/page-layout`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('integrity'),
    });
  });

  it('returns an explicit empty PageLayout response before native detection', async () => {
    findFirstMock.mockResolvedValueOnce({
      id: PAGE_ID,
      checksumSha256: SOURCE_CHECKSUM,
      pageLayout: null,
      pageLayoutChecksumSha256: null,
    });
    validateStoredPageLayoutMock.mockReturnValueOnce({ status: 'absent' });

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/page-layout`,
      path: `/letters/pages/${PAGE_ID}/page-layout`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      pageLayout: null,
      pageLayoutChecksumSha256: null,
    });
    expect(validateStoredPageLayoutMock).toHaveBeenCalled();
  });

  it('returns stored line segments for a page', async () => {
    const segments = [{
      id: 'line-1',
      line: 1,
      geometryType: 'baseline',
      baseline: [[1, 2], [3, 4]],
      bbox: [1, 2, 3, 4],
      ocrText: 'line',
    }];
    getPageGeometryEnvelopeMock.mockResolvedValueOnce(
      createGeometryEnvelope({ lineSegments: segments }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      createGeometryEnvelope({ lineSegments: segments }),
    );
  });

  it('returns empty array when page has no line segments', async () => {
    getPageGeometryEnvelopeMock.mockResolvedValueOnce(createGeometryEnvelope());

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(createGeometryEnvelope());
  });

  it('fails closed when stored line segments do not satisfy the geometry contract', async () => {
    getPageGeometryEnvelopeMock.mockRejectedValueOnce(
      new Error('invalid stored geometry'),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'GET',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('schema validation'),
      code: 'STORED_LINE_SEGMENTS_INVALID',
    });
  });

  it('saves line segments only against the source revision and checksum the editor loaded', async () => {
    findFirstMock.mockResolvedValueOnce(createStoredPage());
    const checksum = 'a'.repeat(64);
    const lineSegments = [{
      line: 1,
      baseline: [[1, 2], [3, 4]],
      bbox: [1, 2, 3, 4],
      ocrText: 'line',
    }];

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments,
        primarySourceRevision: 4,
        sourceChecksum: checksum,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(savePageLineSegmentsMock).toHaveBeenCalledWith(
      PAGE_ID,
      lineSegments,
      {
        primarySourceRevision: 4,
        sourceChecksum: checksum,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
      'admin',
    );
    expect(response.body).toEqual(createGeometryEnvelope());
  });

  it('rejects a stale line-segment write without restoring old geometry', async () => {
    savePageLineSegmentsMock.mockResolvedValueOnce({
      kind: 'source-conflict',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments: [],
        primarySourceRevision: 3,
        sourceChecksum: 'b'.repeat(64),
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('Page source changed'),
      code: 'SOURCE_REVISION_CHANGED',
    });
  });

  it('distinguishes a same-source geometry race from source replacement', async () => {
    savePageLineSegmentsMock.mockResolvedValueOnce({
      kind: 'geometry-conflict',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments: [],
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        expectedGeometryRevision: 1,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('another editor'),
      code: 'GEOMETRY_REVISION_CHANGED',
    });
  });

  it('distinguishes a same-geometry projection race from a geometry edit', async () => {
    savePageLineSegmentsMock.mockResolvedValueOnce({
      kind: 'projection-conflict',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments: [],
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('line-segment data changed'),
      code: 'LINE_SEGMENTS_CHANGED',
    });
  });

  it('tells an old editor to reload when it omits the geometry revision', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments: [],
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: 'GEOMETRY_REVISION_CHANGED',
    });
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('tells an old editor to reload when it omits the full projection checksum', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments: [],
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        expectedGeometryRevision: 2,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      code: 'LINE_SEGMENTS_CHANGED',
    });
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('rejects client-supplied geometry actor provenance', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments: [],
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
        createdBy: 'forged-reviewer',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'revision',
      body: {
        lineSegments: [],
        sourceChecksum: 'b'.repeat(64),
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
    },
    {
      label: 'checksum',
      body: {
        lineSegments: [],
        primarySourceRevision: 3,
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
    },
  ])('tells an old editor to reload when its line-segment request omits the source $label', async ({ body }) => {
    findFirstMock.mockResolvedValueOnce(createStoredPage());

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('reload'),
    });
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('keeps malformed supplied line-segment source revisions as validation errors', async () => {
    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/line-segments`,
      path: `/letters/pages/${PAGE_ID}/line-segments`,
      body: {
        lineSegments: [],
        primarySourceRevision: -1,
        sourceChecksum: 'b'.repeat(64),
        expectedGeometryRevision: 2,
        expectedLineSegmentsChecksumSha256: lineSegmentsChecksum,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
  });

  it('rejects stale page trust writes through the same source fence', async () => {
    updatePageSegmentTrustMock.mockResolvedValueOnce({
      kind: 'source-conflict',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/segment-trust`,
      path: `/letters/pages/${PAGE_ID}/segment-trust`,
      body: {
        trustState: 'trusted',
        primarySourceRevision: 3,
        sourceChecksum: 'c'.repeat(64),
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: geometryChecksum,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('binds page trust to the exact loaded geometry and server actor', async () => {
    updatePageSegmentTrustMock.mockResolvedValueOnce({
      kind: 'saved',
      envelope: createGeometryEnvelope({
        reviewState: {
          trustState: 'trusted',
          approvedGeometryRevision: 2,
          approvedGeometryChecksumSha256: geometryChecksum,
          approvedBy: 'admin',
          approvedAt: '2026-07-30T12:00:00.000Z',
        },
      }),
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/segment-trust`,
      path: `/letters/pages/${PAGE_ID}/segment-trust`,
      body: {
        trustState: 'trusted',
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: geometryChecksum,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updatePageSegmentTrustMock).toHaveBeenCalledWith(
      PAGE_ID,
      'trusted',
      {
        primarySourceRevision: 4,
        sourceChecksum: 'a'.repeat(64),
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: geometryChecksum,
      },
      'admin',
    );
    expect(response.body).toMatchObject({
      reviewState: {
        trustState: 'trusted',
        approvedGeometryRevision: 2,
        approvedBy: 'admin',
      },
    });
  });

  it.each([
    {
      label: 'revision',
      body: {
        trustState: 'trusted',
        sourceChecksum: 'c'.repeat(64),
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: geometryChecksum,
      },
    },
    {
      label: 'checksum',
      body: {
        trustState: 'trusted',
        primarySourceRevision: 3,
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: geometryChecksum,
      },
    },
  ])('tells an old editor to reload when its page-trust request omits the source $label', async ({ body }) => {
    findFirstMock.mockResolvedValueOnce(createStoredPage());

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/pages/${PAGE_ID}/segment-trust`,
      path: `/letters/pages/${PAGE_ID}/segment-trust`,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('reload'),
    });
    expect(updatePageSegmentTrustMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'letter revision and page expectations',
      body: { trustState: 'trusted' },
    },
    {
      label: 'page checksum',
      body: {
        trustState: 'trusted',
        primarySourceRevision: 4,
        pages: [{
          pageId: PAGE_ID,
          expectedGeometryRevision: 2,
          expectedGeometryChecksumSha256: geometryChecksum,
        }],
      },
    },
  ])('tells an old editor to reload when bulk page trust omits its $label', async ({ body }) => {
    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/${LETTER_ID}/segment-trust`,
      path: `/letters/${LETTER_ID}/segment-trust`,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('reload'),
    });
    expect(findManyMock).not.toHaveBeenCalled();
    expect(updateLetterSegmentTrustMock).not.toHaveBeenCalled();
  });

  it('passes the complete loaded page set to the fenced bulk trust update', async () => {
    const sourceChecksum = 'd'.repeat(64);
    findManyMock.mockResolvedValueOnce([{ id: PAGE_UUID }]);

    const response = await invokeRouter(lettersRouter, {
      method: 'PATCH',
      url: `/letters/${LETTER_ID}/segment-trust`,
      path: `/letters/${LETTER_ID}/segment-trust`,
      body: {
        trustState: 'trusted',
        primarySourceRevision: 4,
        pages: [{
          pageId: PAGE_UUID,
          sourceChecksum,
          expectedGeometryRevision: 2,
          expectedGeometryChecksumSha256: geometryChecksum,
        }],
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateLetterSegmentTrustMock).toHaveBeenCalledWith(
      LETTER_ID,
      'trusted',
      4,
      [{
        pageId: PAGE_UUID,
        sourceChecksum,
        expectedGeometryRevision: 2,
        expectedGeometryChecksumSha256: geometryChecksum,
      }],
      'admin',
    );
  });

  it('updates transcript text through the letter update route and returns the refreshed DTO', async () => {
    updateLetterMock.mockResolvedValueOnce(true);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(createLetterDto());

    const response = await invokeRouter(lettersRouter, {
      method: 'PUT',
      url: `/letters/${LETTER_ID}`,
      path: `/letters/${LETTER_ID}`,
      body: {
        primarySourceRevision: 4,
        transcriptionText: 'Edited line one\nEdited line two',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateLetterMock).toHaveBeenCalledWith(
      LETTER_ID,
      {
        primarySourceRevision: 4,
        transcriptionText: 'Edited line one\nEdited line two',
      },
      'admin',
    );
    expect(dbUpdateMock).not.toHaveBeenCalled();
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(createLetterDto());
  });

  it('creates transcript versions only for the source revision the editor loaded', async () => {
    createVersionMock.mockResolvedValueOnce({
      kind: 'created',
      version: {
        versionNumber: 3,
        createdAt: '2026-07-24T12:00:00.000Z',
      },
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/versions`,
      path: `/letters/${LETTER_ID}/versions`,
      body: {
        primarySourceRevision: 4,
        fieldType: 'transcript',
        content: 'Edited line one\nEdited line two',
        source: 'human',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(createVersionMock).toHaveBeenCalledWith(LETTER_ID, {
      primarySourceRevision: 4,
      fieldType: 'transcript',
      content: { text: 'Edited line one\nEdited line two' },
      source: 'human',
    });
    expect(response.body).toEqual({
      versionNumber: 3,
      createdAt: '2026-07-24T12:00:00.000Z',
    });
  });

  it('returns a conflict instead of recording a delayed version of superseded content', async () => {
    createVersionMock.mockResolvedValueOnce({ kind: 'content_changed' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/versions`,
      path: `/letters/${LETTER_ID}/versions`,
      body: {
        primarySourceRevision: 4,
        fieldType: 'transcript',
        content: 'Superseded transcript',
        source: 'human',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Letter content changed before its version could be saved',
      requestId: expect.any(String),
    });
  });

  it('accepts a recognized partial metadata version candidate during rollout', async () => {
    createVersionMock.mockResolvedValueOnce({
      kind: 'created',
      version: {
        versionNumber: 4,
        createdAt: '2026-07-24T12:00:00.000Z',
      },
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/versions`,
      path: `/letters/${LETTER_ID}/versions`,
      body: {
        primarySourceRevision: 4,
        fieldType: 'metadata',
        content: { hook: 'Current hook' },
        source: 'human',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(createVersionMock).toHaveBeenCalledWith(LETTER_ID, {
      primarySourceRevision: 4,
      fieldType: 'metadata',
      content: { hook: 'Current hook' },
      source: 'human',
    });
  });

  it.each([
    ['metadata-shaped content for transcript', 'transcript', { sender: 'Ada Lovelace' }],
    ['transcript-shaped content for metadata', 'metadata', 'Transcript text'],
    ['an empty metadata candidate', 'metadata', {}],
    ['metadata with no recognized fields', 'metadata', { futureMetadataField: 'value' }],
    ['metadata with a non-string sender', 'metadata', { sender: 42 }],
    ['metadata with an invalid date', 'metadata', { extractedDate: 'August 10, 1947' }],
    ['metadata with an invalid emotional tone', 'metadata', { emotionalTone: 'not-a-tone' }],
    [
      'metadata with an invalid relationship',
      'metadata',
      { senderRecipientRelationship: 'not-a-relationship' },
    ],
    ['metadata with a non-array topic value', 'metadata', { primaryTopics: 'family/children' }],
  ])('returns 400 for %s', async (_caseName, fieldType, content) => {
    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/versions`,
      path: `/letters/${LETTER_ID}/versions`,
      body: {
        primarySourceRevision: 4,
        fieldType,
        content,
        source: 'human',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);
    expect(createVersionMock).not.toHaveBeenCalled();
  });

  it('returns a stable conflict without fetching a DTO for invalid stored version content', async () => {
    restoreVersionMock.mockResolvedValueOnce({ kind: 'invalid_content' });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/versions/2/restore?fieldType=metadata`,
      path: `/letters/${LETTER_ID}/versions/2/restore`,
      query: { fieldType: 'metadata' },
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(restoreVersionMock).toHaveBeenCalledWith(LETTER_ID, 2, 'metadata', 4);
    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Stored version content is invalid and cannot be restored',
      requestId: expect.any(String),
    });
    expect(fetchLetterWithRelatedAndTransformMock).not.toHaveBeenCalled();
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

    getLetterByIdMock.mockResolvedValueOnce({
      id: LETTER_ID,
      primarySourceRevision: 4,
    });
    executeRetagForLetterMock.mockResolvedValueOnce({ status: 'updated' });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(refreshedLetter);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/retag`,
      path: `/letters/${LETTER_ID}/retag`,
      body: {
        primarySourceRevision: 4,
        field: 'sender',
        oldSender: 'A. Lovelace',
        newSender: 'Ada Lovelace',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(getLetterByIdMock).toHaveBeenCalledWith(LETTER_ID);
    expect(executeRetagForLetterMock).toHaveBeenCalledWith(LETTER_ID, {
      primarySourceRevision: 4,
      field: 'sender',
      oldSender: 'A. Lovelace',
      newSender: 'Ada Lovelace',
    });
    expect(fetchLetterWithRelatedAndTransformMock).toHaveBeenCalledWith(LETTER_ID);
    expect(response.body).toEqual(refreshedLetter);
  });

  it('returns a conflict when a metadata re-tag is superseded in flight', async () => {
    getLetterByIdMock.mockResolvedValueOnce({
      id: LETTER_ID,
      primarySourceRevision: 4,
    });
    executeRetagForLetterMock.mockResolvedValueOnce({
      status: 'skipped',
      reason: 'revision_changed_before_save',
    });

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/retag`,
      path: `/letters/${LETTER_ID}/retag`,
      body: {
        primarySourceRevision: 4,
        field: 'sender',
        oldSender: 'A. Lovelace',
        newSender: 'Ada Lovelace',
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Letter metadata changed; reload before updating its references',
      requestId: expect.any(String),
    });
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
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(regenerateTranscriptionMock).toHaveBeenCalledWith(LETTER_ID, true, 4);
    expect(response.body).toEqual({
      letter: createLetterDto(),
      regenerated: {
        mainTranscript: true,
        extras: true,
        extrasCount: 2,
      },
    });
  });

  it('returns canonical transcription metrics with the refreshed letter DTO', async () => {
    transcribeLetterOnlyMock.mockResolvedValueOnce({ pageCount: 2, textLength: 42 });
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(createLetterDto());

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/transcribe-letter`,
      path: `/letters/${LETTER_ID}/transcribe-letter`,
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(transcribeLetterOnlyMock).toHaveBeenCalledWith(LETTER_ID, 4);
    expect(response.body).toEqual({
      letter: createLetterDto(),
      transcribed: {
        pageCount: 2,
        textLength: 42,
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
      body: { primarySourceRevision: 4 },
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

  it('returns a request-correlated 409 when direct transcription loses its claim', async () => {
    transcribeLetterOnlyMock.mockRejectedValueOnce(
      Object.assign(new Error('Transcription conflicted with another job update'), { status: 409 }),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/transcribe-letter`,
      path: `/letters/${LETTER_ID}/transcribe-letter`,
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Transcription conflicted with another job update',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
  });

  it('preserves the stable source-conflict code from direct transcription', async () => {
    transcribeLetterOnlyMock.mockRejectedValueOnce(
      sourceRevisionChanged('Letter source changed while transcription was running'),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/transcribe-letter`,
      path: `/letters/${LETTER_ID}/transcribe-letter`,
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: 'Letter source changed while transcription was running',
      code: 'SOURCE_REVISION_CHANGED',
      requestId: expect.any(String),
    });
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
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(transcribeExtrasMock).toHaveBeenCalledWith(LETTER_ID, 4);
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

  it('returns a request-correlated 409 when extra-content ownership is contested', async () => {
    transcribeExtrasMock.mockRejectedValueOnce(
      Object.assign(
        new Error('Extra content transcription conflicted with another job update'),
        { status: 409 },
      ),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/transcribe-extras`,
      path: `/letters/${LETTER_ID}/transcribe-extras`,
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: 'Extra content transcription conflicted with another job update',
      requestId: expect.any(String),
    });
    expect(response.headers['x-request-id']).toBe(
      (response.body as { requestId: string }).requestId,
    );
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
      body: {
        extraContent: 'Typed by an admin',
        primarySourceRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateExtraContentMock).toHaveBeenCalledWith(
      LETTER_ID,
      'Typed by an admin',
      4,
    );
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
      body: {
        photoDescriptionContext: 'Likely Jimmy and Molly',
        primarySourceRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(describePhotoMock).toHaveBeenCalledWith(
      LETTER_ID,
      'Likely Jimmy and Molly',
      4,
    );
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

  it('keeps a photo-description write race distinct from a page-source conflict', async () => {
    describePhotoMock.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'Photo description changed before its generated result could be saved; review the latest description and try again',
        ),
        { status: 409 },
      ),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/describe-photo`,
      path: `/letters/${LETTER_ID}/describe-photo`,
      body: {
        photoDescriptionContext: 'Likely Jimmy and Molly',
        primarySourceRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error:
        'Photo description changed before its generated result could be saved; review the latest description and try again',
      requestId: expect.any(String),
    });
  });

  it('preserves the source-conflict code when photo generation loses to replacement', async () => {
    describePhotoMock.mockRejectedValueOnce(
      sourceRevisionChanged(
        'Photo source changed before its generated description could be saved; reload and try again',
      ),
    );

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: `/letters/${LETTER_ID}/describe-photo`,
      path: `/letters/${LETTER_ID}/describe-photo`,
      body: {
        photoDescriptionContext: 'Likely Jimmy and Molly',
        primarySourceRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error:
        'Photo source changed before its generated description could be saved; reload and try again',
      code: 'SOURCE_REVISION_CHANGED',
      requestId: expect.any(String),
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
      body: {
        photoDescription: 'A corrected porch snapshot description.',
        primarySourceRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updatePhotoDescriptionMock).toHaveBeenCalledWith(LETTER_ID, {
      photoDescription: 'A corrected porch snapshot description.',
      photoDescriptionContext: undefined,
    }, 4);
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
      body: {
        extraContentTranscript: 'Legacy payload text',
        primarySourceRevision: 4,
      },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(updateExtraContentMock).toHaveBeenCalledWith(
      LETTER_ID,
      'Legacy payload text',
      4,
    );
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
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(verifyExtraContentMock).toHaveBeenCalledWith(LETTER_ID, 4, 'admin');
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
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(verifyPhotoDescriptionMock).toHaveBeenCalledWith(LETTER_ID, 4, 'admin');
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
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(unverifyExtraContentMock).toHaveBeenCalledWith(LETTER_ID, 4);
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
      body: { primarySourceRevision: 4 },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(404);
    expect(unverifyPhotoDescriptionMock).toHaveBeenCalledWith(LETTER_ID, 4);
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
      method: 'POST',
      path: `/letters/${LETTER_ID}/process`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/regenerate-transcription`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/transcribe-letter`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/transcribe-extras`,
      body: {},
    },
    {
      method: 'PATCH',
      path: `/letters/${LETTER_ID}/identity`,
      body: { sender: 'Stale sender' },
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/retag`,
      body: {
        field: 'sender',
        oldSender: 'Old sender',
        newSender: 'Stale sender',
      },
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/versions`,
      body: {
        fieldType: 'transcript',
        content: 'Stale transcript',
        source: 'human',
      },
    },
    {
      method: 'PUT',
      path: `/letters/${LETTER_ID}/extra-content`,
      body: { extraContent: 'Stale enclosure text' },
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/describe-photo`,
      body: { photoDescriptionContext: 'Stale context' },
    },
    {
      method: 'PUT',
      path: `/letters/${LETTER_ID}/photo-description`,
      body: { photoDescription: 'Stale description' },
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/verify-transcript`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/unverify-transcript`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/verify-metadata`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/unverify-metadata`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/verify-extra-content`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/unverify-extra-content`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/verify-photo-description`,
      body: {},
    },
    {
      method: 'POST',
      path: `/letters/${LETTER_ID}/unverify-photo-description`,
      body: {},
    },
  ])('requires a page-source revision for $method $path', async ({
    method,
    path,
    body,
  }) => {
    const response = await invokeRouter(lettersRouter, {
      method,
      url: path,
      path,
      body,
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: expect.stringContaining('source version is missing'),
      code: 'SOURCE_REVISION_CHANGED',
      requestId: expect.any(String),
    });
  });

  it.each([
    {
      name: 'verifies transcript through the admin letters route',
      path: `/letters/${LETTER_ID}/verify-transcript`,
      serviceMock: verifyTranscriptMock,
      dto: createVerifiedLetterDto({ metadataVerifiedAt: null, metadataVerifiedBy: null }),
      body: { primarySourceRevision: 7 },
      expectedArgs: [LETTER_ID, 7, 'admin'],
    },
    {
      name: 'removes transcript verification through the admin letters route',
      path: `/letters/${LETTER_ID}/unverify-transcript`,
      serviceMock: unverifyTranscriptMock,
      dto: createLetterDto({ transcriptVerifiedAt: null, transcriptVerifiedBy: null }),
      body: { primarySourceRevision: 7 },
      expectedArgs: [LETTER_ID, 7],
    },
    {
      name: 'verifies metadata through the admin letters route',
      path: `/letters/${LETTER_ID}/verify-metadata`,
      serviceMock: verifyMetadataMock,
      dto: createVerifiedLetterDto({ transcriptVerifiedAt: null, transcriptVerifiedBy: null }),
      body: { primarySourceRevision: 7 },
      expectedArgs: [LETTER_ID, 7, 'admin'],
    },
    {
      name: 'removes metadata verification through the admin letters route',
      path: `/letters/${LETTER_ID}/unverify-metadata`,
      serviceMock: unverifyMetadataMock,
      dto: createLetterDto({ metadataVerifiedAt: null, metadataVerifiedBy: null }),
      body: { primarySourceRevision: 7 },
      expectedArgs: [LETTER_ID, 7],
    },
  ])('$name', async ({ path, serviceMock, dto, body, expectedArgs }) => {
    serviceMock.mockResolvedValueOnce(true);
    fetchLetterWithRelatedAndTransformMock.mockResolvedValueOnce(dto);

    const response = await invokeRouter(lettersRouter, {
      method: 'POST',
      url: path,
      path,
      body,
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
