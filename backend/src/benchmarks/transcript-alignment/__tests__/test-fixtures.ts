import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LayoutBenchmarkStore } from '../../layout/store.js';
import type {
  TranscriptAlignmentUnassignedReason,
} from '../schemas.js';
import { TranscriptAlignmentStore } from '../store.js';

export const PAGE_KEY = '001-18881103-L01-01';
export const LETTER_KEY = '001-18881103-L01';
export const SEGMENT_ID = `${PAGE_KEY}-line-0001`;
export const NATIVE_SEGMENT_ID = `line-sha256-${'a'.repeat(64)}`;
export const TRANSCRIPT_ID = `${LETTER_KEY}-transcript-line-0001`;
export const LAYOUT_RUN_ID = 'layout-run-a';
export const RECOGNITION_RUN_ID = 'recognition-run-a';
export const ALIGNMENT_RUN_ID = 'alignment-run-a';

export const SOURCE_SHA = '1'.repeat(64);
export const TRANSCRIPT_SHA = '2'.repeat(64);
export const LAYOUT_SHA = '3'.repeat(64);
export const IMAGE_SHA = '4'.repeat(64);
export const MODEL_SHA = '5'.repeat(64);
const RUN_MANIFEST_SHA = '6'.repeat(64);

export function alignmentArtifactFixture(
  snapshotSha256 = '7'.repeat(64),
  recognitionSha256 = '8'.repeat(64),
  options: {
    segmentId?: string;
    unlocatedCandidate?: boolean;
    unassignedReason?: TranscriptAlignmentUnassignedReason;
  } = {},
) {
  const unlocatedCandidate = options.unlocatedCandidate === true;
  const segmentId = options.segmentId ?? SEGMENT_ID;
  return {
    schemaVersion: 1,
    kind: 'transcript-to-kraken-segment-alignment',
    createdAt: '2026-07-29T12:00:00.000Z',
    letterKey: LETTER_KEY,
    source: {
      snapshotPath: '/private/provenance/source-snapshot.json',
      snapshotSha256,
      transcriptSha256: TRANSCRIPT_SHA,
      recognitions: [{
        pageKey: PAGE_KEY,
        path: '/private/provenance/recognition.json',
        sha256: recognitionSha256,
      }],
    },
    configuration: {
      algorithm: 'k-best-page-scoped-global-monotonic-dp',
      pageScope: 'exact-transcript-page-marker',
      parameters: {
        maxGroupSize: 2,
        topK: 5,
      },
      transitions: ['one-to-one', 'unlocated-transcript-line'],
      confidencePolicy: 'abstain-below-threshold',
    },
    summary: {
      transcriptLineCount: 1,
      recognizedSegmentCount: 1,
      skippedSegmentCount: options.unassignedReason ? 1 : 0,
      averageSimilarity: 0.9,
      totalCost: 0.1,
      secondBestCost: 0.2,
      pathMargin: 0.1,
      exploredPathCount: 2,
      statusCounts: {
        accepted: unlocatedCandidate ? 0 : 1,
        ambiguous: 0,
        unlocated: unlocatedCandidate ? 1 : 0,
      },
      operationCounts: {
        match: unlocatedCandidate ? 0 : 1,
        split: 0,
        merge: 0,
        'skip-segment': options.unassignedReason ? 1 : 0,
        'unlocated-transcript': unlocatedCandidate ? 1 : 0,
      },
    },
    mappings: [{
      transcriptId: TRANSCRIPT_ID,
      pageKey: PAGE_KEY,
      segmentIds: unlocatedCandidate ? [] : [segmentId],
      operation: unlocatedCandidate ? 'unlocated-transcript' : 'match',
      similarity: unlocatedCandidate ? 0 : 0.9,
      confidence: unlocatedCandidate ? 0 : 0.85,
      status: unlocatedCandidate ? 'unlocated' : 'accepted',
      alternatives: unlocatedCandidate ? [] : [{
        segmentIds: [segmentId],
        support: 1,
      }],
      transcriptText: 'Dear friend,',
      sourceLineNumber: 1,
    }],
    operations: [],
    skippedSegmentIds: options.unassignedReason ? [segmentId] : [],
    ...(options.unassignedReason
      ? {
        unassignedSegmentReasons: [{
          segmentId,
          reason: options.unassignedReason,
        }],
      }
      : {}),
    pages: [{
      pageKey: PAGE_KEY,
      mappingCount: 1,
    }],
  } as const;
}

export function snapshotFixture() {
  return {
    schemaVersion: 1,
    kind: 'transcript-alignment-source-snapshot',
    createdAt: '2026-07-29T11:00:00.000Z',
    letters: [{
      letterKey: LETTER_KEY,
      transcript: {
        text: 'Dear friend,',
        sha256: TRANSCRIPT_SHA,
        characterCount: 12,
        sourceStatus: {
          tier: 'modern-confirmed',
          explanation: 'Confirmed by a human.',
          privateDatabaseField: '/private/database/path',
        },
        lines: [{
          id: TRANSCRIPT_ID,
          sourceLineNumber: 1,
          text: 'Dear friend,',
          alignable: true,
          byteStart: 0,
          byteEndExclusive: 12,
          sha256: '9'.repeat(64),
        }],
      },
      pages: [{
        pageKey: PAGE_KEY,
        pageNumber: 1,
        originalFilename: `${PAGE_KEY}.jpg`,
        sourceSha256: SOURCE_SHA,
        width: 100,
        height: 200,
        challengeTags: ['ordinary-horizontal'],
        transcript: {
          text: 'Dear friend,',
          sha256: TRANSCRIPT_SHA,
          characterCount: 12,
          lines: [{
            id: TRANSCRIPT_ID,
            sourceLineNumber: 1,
            text: 'Dear friend,',
            alignable: true,
          }],
        },
        database: {
          storagePath: '/private/storage/source.jpg',
        },
      }],
    }],
  } as const;
}

function recognitionArtifactFixture(
  layoutSha256: string,
  segmentId = SEGMENT_ID,
) {
  return {
    schemaVersion: 1,
    kind: 'kraken-line-recognition',
    pageKey: PAGE_KEY,
    source: {
      layoutPath: '/private/provenance/layout.json',
      layoutSha256,
      imagePath: '/private/provenance/prepared.png',
      imageSha256: IMAGE_SHA,
    },
    model: {
      path: '/private/provenance/model.mlmodel',
      sha256: MODEL_SHA,
      krakenVersion: '7.0.3',
      segmentationType: 'baselines',
    },
    summary: {
      inputLineCount: 1,
      recognizedLineCount: 1,
      nonemptyLineCount: 1,
    },
    records: [{
      segmentId,
      text: 'Dear frlend,',
      meanConfidence: 0.7,
      characterConfidences: [0.7],
    }],
  } as const;
}

function recognitionRunFixture(segmentationType = 'baselines') {
  return {
    schemaVersion: 1,
    kind: 'kraken-cohort-recognition-run',
    runId: RECOGNITION_RUN_ID,
    state: 'completed',
    source: {
      layoutRunId: LAYOUT_RUN_ID,
      layoutRunManifest: '/private/provenance/run.v2.json',
      layoutRunManifestSha256: RUN_MANIFEST_SHA,
    },
    model: {
      path: '/private/provenance/model.mlmodel',
      sha256: MODEL_SHA,
      segmentationType,
    },
    pages: [{
      pageKey: PAGE_KEY,
      status: 'reused',
      output: `pages/${PAGE_KEY}/recognition.v1.json`,
      summary: {
        inputLineCount: 1,
        recognizedLineCount: 1,
        nonemptyLineCount: 1,
      },
      elapsedSeconds: 0.1,
    }],
  } as const;
}

function nativeLayoutFixture(sourceSha256 = SOURCE_SHA) {
  return {
    schemaVersion: 2,
    kind: 'PageLayout',
    source: {
      name: `${PAGE_KEY}.jpg`,
      coordinateSpace: 'normalized-image-pixels',
      original: {
        sha256: sourceSha256,
        width: 100,
        height: 200,
        mode: 'RGB',
        exifOrientation: 1,
      },
      normalized: {
        sha256: IMAGE_SHA,
        rasterSha256: 'b'.repeat(64),
        rasterChecksumAlgorithm: 'sha256-rgb8-v1',
        width: 100,
        height: 200,
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
        effective: {},
      },
      runtime: {
        python: {
          version: '3.12.11',
          implementation: 'CPython',
        },
        platform: {
          system: 'Darwin',
          release: '25.5.0',
          machine: 'arm64',
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
            sha256: 'd'.repeat(64),
          },
          constraints: {
            name: 'constraints-runtime.txt',
            sha256: 'e'.repeat(64),
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
      language: ['eng'],
      readingOrder: {
        source: 'segmentation.lines',
        lineIds: [NATIVE_SEGMENT_ID],
      },
      alternateReadingOrders: [],
      regions: [],
      lines: [{
        id: NATIVE_SEGMENT_ID,
        providerId: null,
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
        language: ['eng'],
        geometry: {
          type: 'baselines',
          baseline: [
            { x: 10, y: 35 },
            { x: 90, y: 35 },
          ],
          boundary: [
            { x: 10, y: 20 },
            { x: 90, y: 20 },
            { x: 90, y: 40 },
            { x: 10, y: 40 },
          ],
        },
        displayExtent: {
          bbox: [10, 20, 90, 40],
          source: 'derived-boundary-aabb',
          derived: true,
        },
      }],
    },
  } as const;
}

async function writeJsonWithSha(
  path: string,
  value: unknown,
): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await writeFile(path, bytes);
  return createHash('sha256').update(bytes).digest('hex');
}

export async function createStoreFixture(
  temporaryDirectory: string,
  options: {
    layoutArtifactFormat?: 'normalized' | 'native';
    nativeLayoutSourceSha?: string;
    recognitionLayoutSha?: string;
    unlocatedCandidate?: boolean;
    unassignedReason?: TranscriptAlignmentUnassignedReason;
  } = {},
) {
  const resultsRoot = join(temporaryDirectory, 'test-results');
  const snapshotsRoot = join(resultsRoot, 'cohorts');
  const alignmentsRoot = join(resultsRoot, 'alignments');
  const recognitionRunsRoot = join(resultsRoot, 'recognition-runs');
  const alignmentLetterRoot = join(
    alignmentsRoot,
    ALIGNMENT_RUN_ID,
    LETTER_KEY,
  );
  const recognitionPageRoot = join(
    recognitionRunsRoot,
    RECOGNITION_RUN_ID,
    'pages',
    PAGE_KEY,
  );
  const layoutPageRoot = join(
    resultsRoot,
    'layout-runs',
    LAYOUT_RUN_ID,
    'pages',
    PAGE_KEY,
  );
  await Promise.all([
    mkdir(snapshotsRoot, { recursive: true }),
    mkdir(alignmentLetterRoot, { recursive: true }),
    mkdir(recognitionPageRoot, { recursive: true }),
    mkdir(layoutPageRoot, { recursive: true }),
  ]);

  const native = options.layoutArtifactFormat === 'native';
  const nativeLayoutPath = join(layoutPageRoot, 'raw.json');
  const nativeLayoutSha256 = native
    ? await writeJsonWithSha(
      nativeLayoutPath,
      nativeLayoutFixture(options.nativeLayoutSourceSha),
    )
    : null;
  const segmentId = native ? NATIVE_SEGMENT_ID : SEGMENT_ID;
  const layoutSha256 = options.recognitionLayoutSha
    ?? nativeLayoutSha256
    ?? LAYOUT_SHA;
  const snapshotSha256 = await writeJsonWithSha(
    join(snapshotsRoot, 'snapshot.v1.json'),
    snapshotFixture(),
  );
  const recognitionSha256 = await writeJsonWithSha(
    join(recognitionPageRoot, 'recognition.v1.json'),
    recognitionArtifactFixture(
      layoutSha256,
      segmentId,
    ),
  );
  await writeJsonWithSha(
    join(recognitionRunsRoot, RECOGNITION_RUN_ID, 'run.v1.json'),
    recognitionRunFixture(),
  );
  await writeJsonWithSha(
    join(alignmentLetterRoot, 'alignment.v1.json'),
    alignmentArtifactFixture(
      snapshotSha256,
      recognitionSha256,
      {
        segmentId,
        unlocatedCandidate: options.unlocatedCandidate,
        unassignedReason: options.unassignedReason,
      },
    ),
  );

  const normalizedPath = `pages/${PAGE_KEY}/normalized-layout.v1.json`;
  const rawPath = `pages/${PAGE_KEY}/raw.json`;
  const layoutStore = {
    getRunPage: async () => ({
      run: {
        integrity: {
          artifacts: {
            ...(native
              ? {
                [rawPath]: {
                  sha256: nativeLayoutSha256!,
                  sizeBytes: 100,
                },
              }
              : {
                [normalizedPath]: {
                  sha256: LAYOUT_SHA,
                  sizeBytes: 100,
                },
              }),
          },
        },
      },
      page: {
        status: 'succeeded',
        prepared: {
          sha256: IMAGE_SHA,
          width: 100,
          height: 200,
        },
        artifacts: {
          ...(native
            ? { raw: rawPath }
            : { normalized: normalizedPath }),
        },
      },
    }),
    getNormalizedLayout: async () => ({
      schemaVersion: 1,
      pageKey: PAGE_KEY,
      runId: LAYOUT_RUN_ID,
      engineId: 'kraken-blla',
      image: {
        width: 100,
        height: 200,
        coordinateSpace: 'prepared-pixels-top-left',
        sourceSha256: SOURCE_SHA,
        preparedSha256: IMAGE_SHA,
      },
      pageBoundary: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 200 },
        { x: 0, y: 200 },
      ],
      regions: [],
      lines: [{
        id: SEGMENT_ID,
        class: 'text',
        boundary: [
          { x: 10, y: 20 },
          { x: 90, y: 20 },
          { x: 90, y: 40 },
          { x: 10, y: 40 },
        ],
        baseline: [
          { x: 10, y: 35 },
          { x: 90, y: 35 },
        ],
        orientationDegrees: 0,
        readingOrder: {
          index: 0,
          scope: 'page',
          source: 'provider',
        },
        confidence: 0.9,
        regionId: null,
        provenance: {
          provider: 'kraken-blla',
          providerId: null,
          rawClass: null,
          attributes: {},
        },
      }],
      warnings: [],
    }),
    resolveRunArtifact: async () => ({
      absolutePath: nativeLayoutPath,
      contentType: 'application/json',
      sizeBytes: 100,
      filename: 'raw.json',
    }),
    getCohortPage: async () => ({
      originalFilename: `${PAGE_KEY}.jpg`,
      pageNumber: 1,
      checksumSha256: SOURCE_SHA,
    }),
  } as unknown as LayoutBenchmarkStore;

  return new TranscriptAlignmentStore({
    backendRoot: temporaryDirectory,
    resultsRoot,
    snapshotsRoot,
    alignmentsRoot,
    recognitionRunsRoot,
    layoutStore,
  });
}
