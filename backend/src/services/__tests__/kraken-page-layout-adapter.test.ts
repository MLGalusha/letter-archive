import { describe, expect, it } from 'vitest';
import {
  adaptKrakenNativePageLayoutV2,
  krakenNativePageLayoutV2Schema,
  pageLayoutChecksum,
} from '../kraken-page-layout-adapter.js';

const sha = (character: string) => character.repeat(64);
const lineOneId = `line-sha256-${sha('1')}`;
const lineTwoId = `line-sha256-${sha('2')}`;
const regionId = `region-sha256-${sha('3')}`;

function nativeLayout() {
  const firstBoundary = [
    { x: 10, y: 10 },
    { x: 180, y: 12 },
    { x: 180, y: 45 },
    { x: 10, y: 44 },
    { x: 10, y: 10 },
  ];
  const secondBoundary = [
    { x: 12, y: 60 },
    { x: 182, y: 60 },
    { x: 182, y: 88 },
    { x: 12, y: 88 },
    { x: 12, y: 60 },
  ];
  return {
    schemaVersion: 2,
    kind: 'PageLayout',
    source: {
      name: 'fixture.jpg',
      coordinateSpace: 'normalized-image-pixels',
      original: {
        sha256: sha('a'),
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
      type: 'baselines',
      textDirection: 'horizontal-lr',
      scriptDetection: true,
      language: ['eng'],
      readingOrder: {
        source: 'segmentation.lines',
        lineIds: [lineOneId, lineTwoId],
      },
      alternateReadingOrders: [{
        providerOrdinal: 0,
        providerIndices: [1],
        lineIds: [lineTwoId],
        complete: true,
      }],
      regions: [{
        id: regionId,
        providerId: 'provider-region-random',
        identityVersion: 1,
        idSource:
          'derived-source-raster-model-provider-order-geometry-v2',
        class: 'TextRegion',
        providerOrdinal: 0,
        boundary: [
          { x: 0, y: 0 },
          { x: 195, y: 0 },
          { x: 195, y: 100 },
          { x: 0, y: 100 },
          { x: 0, y: 0 },
        ],
        tags: { role: [{ name: 'body' }] },
        language: ['eng'],
      }],
      lines: [
        {
          id: lineOneId,
          providerId: 'provider-line-random',
          identityVersion: 1,
          idSource:
            'derived-source-raster-model-provider-order-geometry-v2',
          providerOrdinal: 0,
          text: null,
          baseDirection: null,
          tags: { type: [{ name: 'body' }] },
          providerRegionIds: ['provider-region-random'],
          regionIds: [regionId],
          unresolvedProviderRegionIds: [],
          language: ['eng'],
          geometry: {
            type: 'baselines',
            baseline: [
              { x: 12, y: 34 },
              { x: 90, y: 38 },
              { x: 178, y: 32 },
            ],
            boundary: firstBoundary,
          },
          displayExtent: {
            bbox: [10, 10, 180, 45],
            source: 'derived-boundary-aabb',
            derived: true,
          },
        },
        {
          id: lineTwoId,
          providerId: 'provider-line-two-random',
          identityVersion: 1,
          idSource:
            'derived-source-raster-model-provider-order-geometry-v2',
          providerOrdinal: 1,
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
              { x: 14, y: 78 },
              { x: 180, y: 78 },
            ],
            boundary: secondBoundary,
          },
          displayExtent: {
            bbox: [12, 60, 182, 88],
            source: 'derived-boundary-aabb',
            derived: true,
          },
        },
      ],
    },
  };
}

function rotationProfile(appendedRotatedLineCount = 1) {
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
      rawInputLineCount: 4,
      inputLineCount: 4,
      clusterCount: 3,
      includedClusterCount: 2,
      rejectedClusterCount: 1,
      appendedRotatedLineCount,
    },
  };
}

function rotationEvidence(rotation: 90 | 270) {
  return {
    evidenceContract: 'native-and-source-projected-v2',
    mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
    clusterIndex: 2,
    supportCount: 1,
    sourceRotationsDegrees: [rotation],
    sourcePassStatuses: ['succeeded'],
    representativeRotationDegrees: rotation,
    representativeProviderOrdinal: 4,
    memberProviderIds: [`rot${rotation}:provider-line-two-random`],
    readingOrderSource: 'unresolved-rotated-proposal',
  };
}

describe('Kraken native PageLayout adapter', () => {
  it('validates and preserves native geometry, regions, order, and provenance', () => {
    const native = nativeLayout();
    expect(krakenNativePageLayoutV2Schema.safeParse(native).success).toBe(true);

    const layout = adaptKrakenNativePageLayoutV2(native, {
      pageId: 'page-1',
      expectedSourceChecksumSha256: sha('a'),
      runId: 'run-1',
    });

    expect(layout).toMatchObject({
      schemaVersion: 2,
      pageId: 'page-1',
      runId: 'run-1',
      lineRepresentation: 'baselines',
      textDirection: 'horizontal-lr',
      scriptDetection: true,
      language: ['eng'],
      image: {
        checksumSha256: sha('b'),
        rasterChecksumSha256: sha('d'),
        rasterChecksumAlgorithm: 'sha256-rgb8-v1',
        source: { checksumSha256: sha('a') },
      },
      provenance: {
        producer: {
          name: 'kraken',
          version: '7.0.3',
          api: 'kraken.tasks.SegmentationTaskModel',
        },
        model: {
          checksumSha256: sha('c'),
          kind: 'kraken-package-resource',
        },
        config: {
          parameters: {
            runtime: {
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
              execution: {
                processMode: 'persistent-worker',
                resolvedDevice: 'cpu',
                resolutionSource: 'model-parameters',
              },
            },
          },
        },
      },
    });
    expect(layout.lines[0]).toMatchObject({
      id: lineOneId,
      providerId: 'provider-line-random',
      providerOrdinal: 0,
      kind: 'baseline',
      text: null,
      regionIds: [regionId],
      baseline: [
        { x: 12, y: 34 },
        { x: 90, y: 38 },
        { x: 178, y: 32 },
      ],
      tags: { type: [{ name: 'body' }] },
    });
    expect(layout.regions[0]).toMatchObject({
      id: regionId,
      providerId: 'provider-region-random',
      lineIds: [lineOneId],
      tags: { role: [{ name: 'body' }] },
    });
    expect(layout.readingOrder.primary.lineIds).toEqual([
      lineOneId,
      lineTwoId,
    ]);
    expect(layout.readingOrder.alternatives[0]).toMatchObject({
      lineIds: [lineTwoId],
      providerMappingComplete: true,
      complete: false,
    });
  });

  it('rejects output generated from a stale or different page source', () => {
    expect(() => adaptKrakenNativePageLayoutV2(nativeLayout(), {
      pageId: 'page-1',
      expectedSourceChecksumSha256: sha('f'),
    })).toThrow(/source checksum/i);
  });

  it('requires concrete runtime provenance in every native result', () => {
    const native = nativeLayout();
    const withoutRuntime = {
      ...native,
      producer: {
        ...native.producer,
        runtime: undefined,
      },
    };

    expect(
      krakenNativePageLayoutV2Schema.safeParse(withoutRuntime).success,
    ).toBe(false);
  });

  it.each([
    [90, 'vertical-lr', 'top-to-bottom'],
    [270, 'vertical-rl', 'bottom-to-top'],
  ] as const)(
    'projects a %s-degree recovery line with explicit source direction and no provider order',
    (rotation, textDirection, expectedDirection) => {
      const native: any = nativeLayout();
      native.producer.config.rotationProfile = rotationProfile();
      Object.assign(native.segmentation.lines[1], {
        identityVersion: 3,
        idSource:
          'derived-source-raster-model-rotation-provider-geometry-v3',
        providerTextDirection: textDirection,
        rotationEvidence: rotationEvidence(rotation),
      });

      expect(krakenNativePageLayoutV2Schema.safeParse(native).success).toBe(true);
      const adapted = adaptKrakenNativePageLayoutV2(native, {
        pageId: 'page-1',
        expectedSourceChecksumSha256: sha('a'),
      });

      expect(adapted.lines[1]).toMatchObject({
        id: lineTwoId,
        providerTextDirection: textDirection,
        direction: expectedDirection,
        rotationEvidence: {
          representativeRotationDegrees: rotation,
          readingOrderSource: 'unresolved-rotated-proposal',
        },
      });
      expect(adapted.lines[1]).not.toHaveProperty('providerOrdinal');
      expect(adapted.lines[1]).not.toHaveProperty('sourceLineNumber');
    },
  );

  it('fails closed on mismatched rotated identity, direction, and profile values', () => {
    const mismatchedIdentity: any = nativeLayout();
    Object.assign(mismatchedIdentity.segmentation.lines[1], {
      identityVersion: 3,
      idSource: 'derived-source-raster-model-provider-order-geometry-v2',
      providerTextDirection: 'vertical-lr',
      rotationEvidence: rotationEvidence(90),
    });
    mismatchedIdentity.producer.config.rotationProfile = rotationProfile();
    expect(
      krakenNativePageLayoutV2Schema.safeParse(mismatchedIdentity).success,
    ).toBe(false);

    const mismatchedDirection: any = nativeLayout();
    Object.assign(mismatchedDirection.segmentation.lines[1], {
      identityVersion: 3,
      idSource:
        'derived-source-raster-model-rotation-provider-geometry-v3',
      providerTextDirection: 'vertical-rl',
      rotationEvidence: rotationEvidence(90),
    });
    mismatchedDirection.producer.config.rotationProfile = rotationProfile();
    expect(
      krakenNativePageLayoutV2Schema.safeParse(mismatchedDirection).success,
    ).toBe(false);

    const driftedProfile: any = nativeLayout();
    driftedProfile.producer.config.rotationProfile = rotationProfile(0);
    driftedProfile.producer.config.rotationProfile.selectionParameters
      .verticalAxisToleranceDegrees = 16;
    expect(
      krakenNativePageLayoutV2Schema.safeParse(driftedProfile).success,
    ).toBe(false);
  });

  it('rejects line evidence sourced from a failed rotation pass', () => {
    const native: any = nativeLayout();
    native.producer.config.rotationProfile = rotationProfile();
    native.producer.config.rotationProfile.passOutcomes[1] = {
      rotationDegrees: 90,
      status: 'failed',
      error: {
        type: 'TopologyException',
        message: 'The 90-degree provider pass could not build valid polygons',
      },
    };
    Object.assign(native.segmentation.lines[1], {
      identityVersion: 3,
      idSource:
        'derived-source-raster-model-rotation-provider-geometry-v3',
      providerTextDirection: 'vertical-lr',
      rotationEvidence: rotationEvidence(90),
    });

    const result = krakenNativePageLayoutV2Schema.safeParse(native);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => /only succeeded passes/i.test(issue.message),
        ),
      ).toBe(true);
    }
  });

  it('keeps each line evidence member restricted to a succeeded pass status', () => {
    const native: any = nativeLayout();
    native.producer.config.rotationProfile = rotationProfile();
    Object.assign(native.segmentation.lines[1], {
      identityVersion: 3,
      idSource:
        'derived-source-raster-model-rotation-provider-geometry-v3',
      providerTextDirection: 'vertical-lr',
      rotationEvidence: {
        ...rotationEvidence(90),
        sourcePassStatuses: ['failed'],
      },
    });

    expect(
      krakenNativePageLayoutV2Schema.safeParse(native).success,
    ).toBe(false);
  });

  it('hashes object keys canonically for stable layout identity', () => {
    expect(pageLayoutChecksum({ beta: 2, alpha: 1 })).toBe(
      pageLayoutChecksum({ alpha: 1, beta: 2 }),
    );
  });
});
