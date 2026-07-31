import type {
  AnnotationUpdate,
  LayoutCohort,
  LayoutRunManifest,
  NormalizedLayout,
} from '../schemas.js';
import {
  REQUIRED_LAYOUT_BENCHMARK_SOURCE_PATHS,
  sourceSnapshotBundleSha256,
} from '../schemas.js';

export const PAGE_KEY = '001-18881103-L01-01';
export const SOURCE_SHA = 'a'.repeat(64);
export const PREPARED_SHA = 'b'.repeat(64);
export const COHORT_SHA = 'c'.repeat(64);

export function makeCohort(): LayoutCohort {
  return {
    schemaVersion: 1,
    cohortId: 'test-cohort',
    createdAt: '2026-07-28',
    description: 'A hermetic test cohort.',
    sourceDimensionConvention: 'encoded pixels before EXIF normalization',
    preprocessingRequirements: {
      applyExifOrientation: true,
      recordPreparedInputChecksum: true,
      recordPreparedInputDimensions: true,
    },
    coverage: {
      policy: 'at-least-one-complete-L-record-per-collection',
      collectionCodesAtSelection: ['001'],
      letterCount: 1,
      pageCount: 1,
    },
    groundTruth: {
      defaultStatus: 'unannotated',
      artifactDirectory: 'ground-truth',
    },
    letters: [{
      identity: {
        collectionCode: '001',
        dateRaw: '18881103',
        type: 'L',
        typeSequence: 1,
      },
      selection: {
        kind: 'user_requested',
        reason: 'Selected for a test.',
      },
      pages: [{
        pageNumber: 1,
        originalFilename: '001-18881103-L01-01.jpg',
        checksumSha256: SOURCE_SHA,
        width: 100,
        height: 200,
        challengeTags: ['ordinary-horizontal'],
      }],
    }],
  };
}

export function makeRun(
  runId = 'run-a',
  engineId = 'engine-a',
  overrides: {
    cohortSha?: string;
    preparedSha?: string;
    rasterSha?: string;
    preparedWidth?: number;
    preparedHeight?: number;
    sourceSha?: string;
    status?: 'succeeded' | 'failed';
  } = {},
): LayoutRunManifest {
  const status = overrides.status ?? 'succeeded';
  const preparedWidth = overrides.preparedWidth ?? 100;
  const preparedHeight = overrides.preparedHeight ?? 200;
  const pageDirectory = `pages/${PAGE_KEY}`;
  const sourceRelativePath = 'storage/collections/001/18881103/L01/001-18881103-L01-01.jpg';
  const cohortPath = 'benchmarks/layout/cohort.v1.json';
  const engineConfigurationPath = 'benchmarks/layout/config/default.json';
  const preprocessingPath = 'benchmarks/layout/engine-configs/shared-preprocessing.v1.json';
  const sourceSha = overrides.sourceSha ?? SOURCE_SHA;
  const preparedSha = overrides.preparedSha ?? PREPARED_SHA;
  const rasterSha = overrides.rasterSha ?? preparedSha;
  const cohortSha = overrides.cohortSha ?? COHORT_SHA;
  const engineConfigurationSha = 'e'.repeat(64);
  const preprocessingSha = 'f'.repeat(64);
  const preparedPath = `${pageDirectory}/prepared.png`;
  const rawPath = `${pageDirectory}/raw.json`;
  const normalizedPath = `${pageDirectory}/normalized-layout.v1.json`;
  const overlayPath = `${pageDirectory}/overlay.png`;
  const errorPath = `${pageDirectory}/error.json`;
  const sourceSnapshotFiles: Record<string, {
    snapshotPath: string;
    sha256: string;
    sizeBytes: number;
  }> = Object.fromEntries(
    [...new Set([
      ...REQUIRED_LAYOUT_BENCHMARK_SOURCE_PATHS,
      'src/benchmarks/layout/raster-fingerprint.ts',
      cohortPath,
      engineConfigurationPath,
      preprocessingPath,
    ])].map((path) => {
      const sha256 = path === cohortPath
        ? cohortSha
        : path === engineConfigurationPath
          ? engineConfigurationSha
          : path === preprocessingPath
            ? preprocessingSha
            : '4'.repeat(64);
      return [path, {
        snapshotPath: `source-snapshot/${path}`,
        sha256,
        sizeBytes: 0,
      }];
    }),
  );
  const pageArtifacts = status === 'succeeded' ? {
    raw: rawPath,
    normalized: normalizedPath,
    overlay: overlayPath,
  } : {
    error: errorPath,
  };
  const pageArtifactIntegrity: Record<string, {
    sha256: string;
    sizeBytes: number;
  }> = status === 'succeeded' ? {
    [preparedPath]: { sha256: preparedSha, sizeBytes: 0 },
    [rawPath]: { sha256: '1'.repeat(64), sizeBytes: 0 },
    [normalizedPath]: { sha256: '2'.repeat(64), sizeBytes: 0 },
    [overlayPath]: { sha256: preparedSha, sizeBytes: 0 },
  } : {
    [errorPath]: { sha256: '3'.repeat(64), sizeBytes: 0 },
  };
  const artifactIntegrity: Record<string, {
    sha256: string;
    sizeBytes: number;
  }> = {
    ...pageArtifactIntegrity,
    ...Object.fromEntries(
      Object.values(sourceSnapshotFiles).map((snapshot) => [
        snapshot.snapshotPath,
        { sha256: snapshot.sha256, sizeBytes: snapshot.sizeBytes },
      ]),
    ),
  };
  return {
    schemaVersion: 2,
    runId,
    state: status === 'succeeded' ? 'completed' : 'completed_with_failures',
    createdAt: '2026-07-28T12:00:00.000Z',
    completedAt: '2026-07-28T12:00:01.000Z',
    cohort: {
      id: 'test-cohort',
      manifestPath: cohortPath,
      sha256: cohortSha,
      selection: {
        scope: 'full',
        pageKeys: [PAGE_KEY],
      },
    },
    engine: {
      id: engineId,
      adapterVersion: '1.0.0',
      package: { name: engineId, version: '1.2.3' },
      models: [{ name: 'model', sha256: 'd'.repeat(64), sizeBytes: 123 }],
      configuration: {
        profileId: 'default',
        path: engineConfigurationPath,
        sha256: engineConfigurationSha,
        values: { threshold: 0.5 },
      },
      execution: {
        kind: 'venv',
        commandFingerprint: 'command-v1',
        pythonVersion: '3.11.9',
        inferenceProvider: 'cpu',
        dependencies: { pillow: '11.0.0' },
      },
    },
    preprocessing: {
      profileId: 'canonical-v1',
      path: preprocessingPath,
      profileSha256: preprocessingSha,
      library: 'Pillow',
      libraryVersion: '11.0.0',
      exifPolicy: 'transpose',
      colorMode: 'RGB',
      format: 'PNG',
      encoder: { compressLevel: 6 },
    },
    environment: {
      git: { commit: 'deadbeef', dirty: false },
      host: {
        os: 'darwin',
        release: '25.0',
        arch: 'arm64',
        cpuCount: 8,
        memoryBytes: 16_000_000_000,
      },
      platformCaveat: null,
    },
    sourceSnapshot: {
      algorithm: 'sha256',
      bundleSha256: sourceSnapshotBundleSha256(sourceSnapshotFiles),
      files: sourceSnapshotFiles,
    },
    integrity: {
      algorithm: 'sha256',
      artifacts: artifactIntegrity,
    },
    pages: [{
      pageKey: PAGE_KEY,
      status,
      timestamps: {
        startedAt: '2026-07-28T12:00:00.000Z',
        completedAt: '2026-07-28T12:00:01.000Z',
      },
      durationMs: 1_000,
      timings: {
        preparationMs: 100,
        engineMs: 700,
        normalizationMs: 100,
        overlayMs: 100,
        totalMs: 1_000,
        engineUserCpuMs: 650,
        engineSystemCpuMs: 20,
        providerModelLoadMs: 100,
        providerInferenceMs: 600,
      },
      peakRssBytes: 100_000_000,
      resourceMeasurement: { method: 'usr-bin-time', caveat: null },
      source: {
        relativePath: sourceRelativePath,
        filename: '001-18881103-L01-01.jpg',
        sha256: sourceSha,
        width: 100,
        height: 200,
        exifOrientation: 1,
      },
      prepared: status === 'succeeded' ? {
        artifact: preparedPath,
        sha256: preparedSha,
        width: preparedWidth,
        height: preparedHeight,
        rasterFingerprint: {
          algorithm: 'sha256-rgb8-v1',
          sha256: rasterSha,
        },
      } : null,
      artifacts: pageArtifacts,
      counts: status === 'succeeded' ? { regions: 1, lines: 2 } : { regions: 0, lines: 0 },
      warnings: [],
      error: status === 'failed' ? {
        stage: 'engine',
        code: 'test_failure',
        message: 'Detector failed.',
      } : null,
    }],
    summary: {
      selected: 1,
      succeeded: status === 'succeeded' ? 1 : 0,
      failed: status === 'failed' ? 1 : 0,
      durationMs: 1_000,
    },
  };
}

export function makeLayout(
  runId = 'run-a',
  engineId = 'engine-a',
  preparedSha = PREPARED_SHA,
  lineOffset = 0,
): NormalizedLayout {
  const provenance = {
    provider: engineId,
    providerId: null,
    rawClass: null,
    attributes: {},
  };
  return {
    schemaVersion: 1,
    pageKey: PAGE_KEY,
    runId,
    engineId,
    image: {
      width: 100,
      height: 200,
      coordinateSpace: 'prepared-pixels-top-left',
      sourceSha256: SOURCE_SHA,
      preparedSha256: preparedSha,
    },
    pageBoundary: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ],
    regions: [{
      id: 'r1',
      class: 'text',
      boundary: [
        { x: 5, y: 5 },
        { x: 95, y: 5 },
        { x: 95, y: 80 },
        { x: 5, y: 80 },
      ],
      orientationDegrees: 0,
      readingOrder: { index: 0, scope: 'page', source: 'provider' },
      confidence: 0.9,
      lineIds: ['l1', 'l2'],
      provenance,
    }],
    lines: [
      {
        id: 'l1',
        class: 'text',
        boundary: [
          { x: 10, y: 10 + lineOffset },
          { x: 90, y: 10 + lineOffset },
          { x: 90, y: 20 + lineOffset },
          { x: 10, y: 20 + lineOffset },
        ],
        baseline: [
          { x: 10, y: 18 + lineOffset },
          { x: 90, y: 18 + lineOffset },
        ],
        orientationDegrees: 0,
        readingOrder: { index: 0, scope: 'page', source: 'provider' },
        confidence: 0.9,
        regionId: 'r1',
        provenance,
      },
      {
        id: 'l2',
        class: 'text',
        boundary: [
          { x: 10, y: 40 + lineOffset },
          { x: 90, y: 40 + lineOffset },
          { x: 90, y: 50 + lineOffset },
          { x: 10, y: 50 + lineOffset },
        ],
        baseline: [
          { x: 10, y: 48 + lineOffset },
          { x: 90, y: 48 + lineOffset },
        ],
        orientationDegrees: 0,
        readingOrder: { index: 1, scope: 'page', source: 'provider' },
        confidence: 0.8,
        regionId: 'r1',
        provenance,
      },
    ],
    warnings: [],
  };
}

export function makeAnnotationUpdate(): AnnotationUpdate {
  const layout = makeLayout();
  return {
    status: 'complete',
    image: layout.image,
    pageBoundary: layout.pageBoundary,
    regions: layout.regions.map((region) => ({
      id: region.id,
      class: region.class,
      boundary: region.boundary,
      orientationDegrees: region.orientationDegrees,
      readingOrder: region.readingOrder
        ? { ...region.readingOrder, source: 'human' as const }
        : null,
      lineIds: region.lineIds,
    })),
    lines: layout.lines.map((line) => ({
      id: line.id,
      class: line.class,
      boundary: line.boundary,
      baseline: line.baseline,
      orientationDegrees: line.orientationDegrees,
      readingOrder: line.readingOrder
        ? { index: line.readingOrder.index, scope: line.readingOrder.scope, source: 'human' as const }
        : null,
      regionId: line.regionId,
    })),
    notes: null,
  };
}
