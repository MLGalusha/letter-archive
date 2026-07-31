import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  closeDatabase,
  collections,
  db,
  letterPages,
  letters,
  pageGeometryProposals,
  sql,
} from '../../db/index.js';
import {
  normalizeLineSegments,
  pageGeometryChecksum,
  pageLineSegmentsChecksum,
} from '../../schemas/page-geometry.js';
import {
  adaptKrakenNativePageLayoutV2,
  pageLayoutChecksum,
} from '../kraken-page-layout-adapter.js';
import { invokeRouter } from '../../test/express-test-utils.js';
import contentRouter from '../../routes/admin/letters/content.js';

const runPostgresIntegration =
  process.env.RUN_POSTGRES_INTEGRATION === '1';
const sha = (character: string): string => character.repeat(64);
const sourceChecksumSha256 = sha('a');
const geometryRevision = 2;
const primarySourceRevision = 4;

const baseLineSegments = normalizeLineSegments([{
  id: 'base-line-1',
  line: 1,
  geometryType: 'baseline',
  providerId: 'base-provider-1',
  providerOrdinal: 0,
  providerTextDirection: 'horizontal-lr',
  baseline: [[10, 30], [180, 32]],
  bbox: [8, 10, 185, 45],
  boundary: [
    { x: 8, y: 10 },
    { x: 185, y: 10 },
    { x: 185, y: 45 },
    { x: 8, y: 45 },
  ],
  geometryProvenance: {
    source: 'machine',
    operation: 'detected',
    parentSegmentIds: [],
  },
  ocrText: 'canonical body line',
  segmentClass: 'body',
}]);
const geometryChecksumSha256 =
  pageGeometryChecksum(baseLineSegments);
const lineSegmentsChecksumSha256 =
  pageLineSegmentsChecksum(baseLineSegments);
const nativeLineId = `line-sha256-${sha('1')}`;

function rotationProfile(appendedRotatedLineCount: 0 | 1) {
  return {
    name: 'sideways-recovery-v1',
    evidenceContract: 'native-and-source-projected-v2',
    rotationsDegrees: [0, 90, 270],
    passOutcomes: [
      { rotationDegrees: 0, status: 'succeeded' },
      { rotationDegrees: 90, status: 'succeeded' },
      { rotationDegrees: 270, status: 'succeeded' },
    ],
    mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
    coordinateTransform: 'pil-pixel-centers-to-source-v1',
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
      clusterCount: appendedRotatedLineCount,
      includedClusterCount: appendedRotatedLineCount,
      rejectedClusterCount: 0,
      appendedRotatedLineCount,
    },
  };
}

function createNativePageLayout(
  rotated: boolean,
  candidateKind: 'baseline' | 'bbox' = 'baseline',
) {
  const providerTextDirection = rotated
    ? 'vertical-lr'
    : undefined;
  const isRotatedBbox = rotated && candidateKind === 'bbox';
  return {
    schemaVersion: 2,
    kind: 'PageLayout',
    source: {
      name: 'postgres-proposal-fixture.jpg',
      coordinateSpace: 'normalized-image-pixels',
      original: {
        sha256: sourceChecksumSha256,
        width: 200,
        height: 300,
        mode: 'RGB',
        exifOrientation: 1,
      },
      normalized: {
        sha256: sha('b'),
        rasterSha256: sha('d'),
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
        sha256: sha('c'),
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
        ...(rotated
          ? { rotationProfile: rotationProfile(1) }
          : {}),
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
            sha256: sha('e'),
          },
          constraints: {
            name: 'constraints-runtime.txt',
            sha256: sha('f'),
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
      type: isRotatedBbox ? 'bbox' : 'baselines',
      textDirection: 'horizontal-lr',
      scriptDetection: false,
      language: null,
      readingOrder: {
        source: 'segmentation.lines',
        lineIds: [nativeLineId],
      },
      alternateReadingOrders: [],
      regions: [],
      lines: [{
        id: nativeLineId,
        providerId: 'provider-line-id',
        identityVersion: rotated ? 3 : 1,
        idSource: rotated
          ? 'derived-source-raster-model-rotation-provider-geometry-v3'
          : 'derived-source-raster-model-provider-order-geometry-v2',
        providerOrdinal: 0,
        text: null,
        baseDirection: null,
        tags: null,
        providerRegionIds: [],
        regionIds: [],
        unresolvedProviderRegionIds: [],
        language: null,
        ...(providerTextDirection
          ? {
            providerTextDirection,
            rotationEvidence: {
              evidenceContract: 'native-and-source-projected-v2',
              mergePolicy:
                'baseline-plus-nonoverlapping-vertical-zones',
              clusterIndex: 0,
              supportCount: 1,
              sourceRotationsDegrees: [90],
              sourcePassStatuses: ['succeeded'],
              representativeRotationDegrees: 90,
              representativeProviderOrdinal: 0,
              memberProviderIds: ['provider-line-id'],
              readingOrderSource: 'unresolved-rotated-proposal',
            },
          }
          : {}),
        geometry: isRotatedBbox
          ? {
            type: 'bbox',
            bbox: [25, 30, 55, 230],
            textDirection: 'vertical-lr',
          }
          : {
            type: 'baselines',
            baseline: rotated
              ? [
                { x: 40, y: 40 },
                { x: 42, y: 220 },
              ]
              : [
                { x: 10, y: 30 },
                { x: 180, y: 32 },
              ],
            boundary: rotated
              ? [
                { x: 25, y: 30 },
                { x: 55, y: 30 },
                { x: 55, y: 230 },
                { x: 25, y: 230 },
                { x: 25, y: 30 },
              ]
              : [
                { x: 8, y: 10 },
                { x: 185, y: 10 },
                { x: 185, y: 45 },
                { x: 8, y: 45 },
                { x: 8, y: 10 },
              ],
          },
        displayExtent: {
          bbox: rotated
            ? [25, 30, 55, 230]
            : [8, 10, 185, 45],
          source: isRotatedBbox
            ? 'native-bbox'
            : 'derived-boundary-aabb',
          derived: !isRotatedBbox,
        },
      }],
    },
  };
}

interface Fixture {
  collectionId: string;
  letterId: string;
  pageId: string;
  requestBody: {
    nativePageLayout: ReturnType<typeof createNativePageLayout>;
    runId: string;
    source: {
      primarySourceRevision: number;
      sourceChecksumSha256: string;
      baseGeometryRevision: number;
      baseGeometryChecksumSha256: string;
      baseLineSegmentsChecksumSha256: string;
    };
  };
}

async function createFixture(
  candidateKind: 'baseline' | 'bbox' = 'baseline',
): Promise<Fixture> {
  const collectionId = randomUUID();
  const letterId = randomUUID();
  const pageId = randomUUID();
  const runId = `run-${randomUUID()}`;
  const canonicalLayout = adaptKrakenNativePageLayoutV2(
    createNativePageLayout(false),
    {
      pageId,
      expectedSourceChecksumSha256: sourceChecksumSha256,
      runId: `canonical-${randomUUID()}`,
    },
  );

  await db.insert(collections).values({
    id: collectionId,
    collectionCode: `pg-proposal-${randomUUID()}`,
  });
  await db.insert(letters).values({
    id: letterId,
    collectionId,
    dateRaw: '19000101',
    type: 'L',
    typeSequence: 1,
    primarySourceRevision,
  });
  await db.insert(letterPages).values({
    id: pageId,
    letterId,
    pageNumber: 1,
    storagePath: `test/page-geometry-proposals/${pageId}.jpg`,
    originalFilename: `${pageId}.jpg`,
    checksumSha256: sourceChecksumSha256,
    pageLayout: canonicalLayout,
    pageLayoutChecksumSha256: pageLayoutChecksum(canonicalLayout),
    lineSegments: baseLineSegments,
    geometryRevision,
    geometryChecksumSha256,
    segmentTrustState: 'unverified',
    width: 200,
    height: 300,
  });

  return {
    collectionId,
    letterId,
    pageId,
    requestBody: {
      nativePageLayout: createNativePageLayout(true, candidateKind),
      runId,
      source: {
        primarySourceRevision,
        sourceChecksumSha256,
        baseGeometryRevision: geometryRevision,
        baseGeometryChecksumSha256: geometryChecksumSha256,
        baseLineSegmentsChecksumSha256:
          lineSegmentsChecksumSha256,
      },
    },
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await db.delete(letterPages).where(eq(letterPages.id, fixture.pageId));
  await db.delete(letters).where(eq(letters.id, fixture.letterId));
  await db.delete(collections).where(
    eq(collections.id, fixture.collectionId),
  );
}

async function invokeProposalPatch(fixture: Fixture) {
  const url =
    `/pages/${fixture.pageId}/geometry-proposals/rotation`;
  return invokeRouter(contentRouter, {
    method: 'PATCH',
    url,
    path: url,
    body: fixture.requestBody,
    headers: { 'content-type': 'application/json' },
    timeoutMs: 5_000,
  });
}

async function pageRowBytes(pageId: string): Promise<string> {
  const [row] = await sql<{ page_row: string }[]>`
    SELECT to_jsonb(page_row)::text AS page_row
    FROM letter_pages AS page_row
    WHERE id = ${pageId}::uuid
  `;
  if (!row) throw new Error(`Missing fixture page ${pageId}`);
  return row.page_row;
}

describe.runIf(runPostgresIntegration)(
  'page geometry proposal PATCH with real PostgreSQL',
  () => {
    afterAll(async () => {
      await closeDatabase();
    });

    it('deduplicates simultaneous identical submissions to one immutable row', async () => {
      const fixture = await createFixture();
      try {
        const [first, second] = await Promise.all([
          invokeProposalPatch(fixture),
          invokeProposalPatch(fixture),
        ]);

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(200);
        expect([
          (first.body as { status: string }).status,
          (second.body as { status: string }).status,
        ].sort()).toEqual(['already-exists', 'saved']);

        const rows = await db.query.pageGeometryProposals.findMany({
          where: eq(pageGeometryProposals.pageId, fixture.pageId),
        });
        expect(rows).toHaveLength(1);
        expect(
          (first.body as { proposalId: string }).proposalId,
        ).toBe(rows[0].id);
        expect(
          (second.body as { proposalId: string }).proposalId,
        ).toBe(rows[0].id);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it('leaves the complete canonical page row byte-for-byte unchanged', async () => {
      const fixture = await createFixture();
      try {
        const before = await pageRowBytes(fixture.pageId);
        const response = await invokeProposalPatch(fixture);
        const after = await pageRowBytes(fixture.pageId);

        expect(response.statusCode).toBe(200);
        expect(response.body).toMatchObject({
          ok: true,
          status: 'saved',
          candidateCount: 1,
        });
        expect(after).toBe(before);
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it('stores a valid rotated bbox candidate without an optional baseline', async () => {
      const fixture = await createFixture('bbox');
      try {
        const response = await invokeProposalPatch(fixture);

        expect(response.statusCode).toBe(200);
        expect(response.body).toMatchObject({
          ok: true,
          status: 'saved',
          candidateCount: 1,
        });

        const rows = await db.query.pageGeometryProposals.findMany({
          where: eq(pageGeometryProposals.pageId, fixture.pageId),
        });
        expect(rows).toHaveLength(1);
        const artifact = rows[0].artifact as {
          candidates: Array<Record<string, unknown>>;
        };
        expect(artifact.candidates).toHaveLength(1);
        expect(artifact.candidates[0]).toMatchObject({
          geometryType: 'bbox',
          bbox: [25, 30, 55, 230],
          providerTextDirection: 'vertical-lr',
        });
        expect(artifact.candidates[0]).not.toHaveProperty('baseline');
      } finally {
        await cleanupFixture(fixture);
      }
    });

    it('fails closed when the owning source revision changes during submission', async () => {
      const fixture = await createFixture();
      let releaseOwnerLock!: () => void;
      let signalOwnerLocked!: () => void;
      const ownerLocked = new Promise<void>((resolve) => {
        signalOwnerLocked = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseOwnerLock = resolve;
      });

      try {
        const sourceEdit = sql.begin(async (transaction) => {
          await transaction.unsafe(
            `SELECT id
             FROM letters
             WHERE id = $1::uuid
             FOR UPDATE`,
            [fixture.letterId],
          );
          signalOwnerLocked();
          await release;
          await transaction.unsafe(
            `UPDATE letters
             SET primary_source_revision =
               primary_source_revision + 1
             WHERE id = $1::uuid`,
            [fixture.letterId],
          );
        });
        await ownerLocked;

        const proposal = invokeProposalPatch(fixture);
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
        releaseOwnerLock();
        await sourceEdit;

        const response = await proposal;
        expect(response.statusCode).toBe(409);
        expect(response.body).toMatchObject({
          code: 'SOURCE_REVISION_CHANGED',
        });

        const rows = await db.query.pageGeometryProposals.findMany({
          where: eq(pageGeometryProposals.pageId, fixture.pageId),
        });
        expect(rows).toHaveLength(0);
      } finally {
        releaseOwnerLock?.();
        await cleanupFixture(fixture);
      }
    });
  },
);
