import { describe, expect, it } from 'vitest';
import {
  assertPageGeometryProposalArtifactChecksum,
  pageGeometryProposalArtifactChecksum,
  pageGeometryProposalV1Schema,
  type PageGeometryProposalV1,
} from '../page-geometry-proposal.js';

const sha = (character: string): string => character.repeat(64);

function candidate(id = 'rotation:90:line-1') {
  return {
    id,
    line: -1,
    geometryType: 'baseline' as const,
    providerId: `provider:${id}`,
    providerTextDirection: 'vertical-lr' as const,
    rotationEvidence: {
      evidenceContract: 'native-and-source-projected-v2' as const,
      mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones' as const,
      clusterIndex: 1,
      supportCount: 2,
      sourceRotationsDegrees: [90, 270] as [90, 270],
      sourcePassStatuses: ['succeeded', 'succeeded'] as [
        'succeeded',
        'succeeded',
      ],
      representativeRotationDegrees: 90 as const,
      representativeProviderOrdinal: 4,
      memberProviderIds: ['provider:90:4', 'provider:270:7'],
      readingOrderSource: 'unresolved-rotated-proposal' as const,
    },
    baseline: [[100, 200], [100, 500]] as Array<[number, number]>,
    bbox: [80, 190, 130, 510] as [number, number, number, number],
    boundary: [
      { x: 80, y: 190 },
      { x: 130, y: 190 },
      { x: 130, y: 510 },
      { x: 80, y: 510 },
    ],
    geometryProvenance: {
      source: 'machine' as const,
      operation: 'detected' as const,
      parentSegmentIds: [],
    },
    ocrText: '',
  };
}

function rotationProfile() {
  return {
    name: 'sideways-recovery-v1' as const,
    evidenceContract: 'native-and-source-projected-v2' as const,
    rotationsDegrees: [0, 90, 270] as [0, 90, 270],
    passOutcomes: [
      { rotationDegrees: 0 as const, status: 'succeeded' as const },
      { rotationDegrees: 90 as const, status: 'succeeded' as const },
      { rotationDegrees: 270 as const, status: 'succeeded' as const },
    ] as [
      { rotationDegrees: 0; status: 'succeeded' },
      { rotationDegrees: 90; status: 'succeeded' },
      { rotationDegrees: 270; status: 'succeeded' },
    ],
    mergePolicy:
      'baseline-plus-nonoverlapping-vertical-zones' as const,
    coordinateTransform: 'pil-pixel-centers-to-source-v1' as const,
    selectionParameters: {
      verticalAxisToleranceDegrees: 15 as const,
      strongBaselineLongEdgeRatio: 0.025 as const,
      zoneJoinPaddingLongEdgeRatio: 0.06 as const,
      zoneMemberPaddingLongEdgeRatio: 0.02 as const,
      minimumStrongProposalClustersPerZone: 2 as const,
      minimumProposalClustersPerZone: 3 as const,
      baselineInterferencePaddingLongEdgeRatio: 0 as const,
      baselineInterferenceHorizontalAxisToleranceDegrees: 20 as const,
      maximumHorizontalBaselineCentroidRatioPerZone: 0.1 as const,
      minimumHorizontalBaselineCentroidAllowancePerZone: 2 as const,
    },
    selectionSummary: {
      rawInputLineCount: 40,
      inputLineCount: 38,
      clusterCount: 25,
      includedClusterCount: 2,
      rejectedClusterCount: 23,
      appendedRotatedLineCount: 1,
    },
  };
}

function artifact(): PageGeometryProposalV1 {
  const profile = rotationProfile();
  return {
    schemaVersion: 1,
    kind: 'rotation-recovery',
    pageId: '40e6b19f-1982-4c5a-aa32-2b5990377629',
    source: {
      primarySourceRevision: 3,
      sourceChecksumSha256: sha('a'),
      baseGeometryRevision: 5,
      baseGeometryChecksumSha256: sha('b'),
      baseLineSegmentsChecksumSha256: sha('c'),
      image: {
        width: 1200,
        height: 1600,
        checksumSha256: sha('f'),
        rasterChecksumSha256: sha('0'),
        rasterChecksumAlgorithm: 'sha256-rgb8-v1',
        coordinateSpace: {
          unit: 'pixel',
          origin: 'top-left',
          xAxis: 'right',
          yAxis: 'down',
        },
        source: {
          width: 1200,
          height: 1600,
          checksumSha256: sha('a'),
          mode: 'RGB',
          exifOrientation: 1,
        },
        normalization: {
          operation: 'identity',
          applied: false,
          exifReadError: false,
        },
      },
    },
    provenance: {
      producer: {
        name: 'letter-archive-rotation-recovery',
        version: '1.0.0',
        api: 'kraken-task-api',
        providerRunId: 'rotation-run-1',
      },
      model: {
        name: 'blla.mlmodel',
        version: '7.0.3',
        checksumSha256: sha('d'),
        kind: 'segmentation',
      },
      config: {
        name: 'kraken-segmentation-task',
        version: '1',
        checksumSha256: sha('e'),
        parameters: {
          rotationProfile: profile,
        },
      },
    },
    rotationProfile: profile,
    run: {
      id: 'rotation-run-1',
    },
    candidates: [candidate()],
  };
}

describe('page geometry proposal artifact', () => {
  it('accepts an exact content-addressable rotation recovery proposal', () => {
    const parsed = pageGeometryProposalV1Schema.parse(artifact());
    const checksum = pageGeometryProposalArtifactChecksum(parsed);

    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(() => (
      assertPageGeometryProposalArtifactChecksum(parsed, checksum)
    )).not.toThrow();
  });

  it('detects artifact tampering through the content checksum', () => {
    const original = artifact();
    const checksum = pageGeometryProposalArtifactChecksum(original);
    const tampered = structuredClone(original);
    tampered.candidates[0].bbox[0] += 1;

    expect(() => (
      assertPageGeometryProposalArtifactChecksum(tampered, checksum)
    )).toThrow(/checksum mismatch/);
  });

  it('rejects duplicate stable candidate IDs', () => {
    const value = artifact();
    value.candidates.push(candidate());

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });

  it('rejects geometry outside the original image coordinate space', () => {
    const value = artifact();
    value.candidates[0].boundary![2].x = 1201;

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    {
      name: 'a zero-length baseline',
      mutate: (value: ReturnType<typeof candidate>) => {
        value.baseline = [[100, 200], [100, 200]];
      },
    },
    {
      name: 'a collinear boundary',
      mutate: (value: ReturnType<typeof candidate>) => {
        value.boundary = [
          { x: 80, y: 190 },
          { x: 90, y: 190 },
          { x: 100, y: 190 },
        ];
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const value = artifact();
    mutate(value.candidates[0] as ReturnType<typeof candidate>);

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    {
      name: 'human-created geometry',
      mutate: (value: ReturnType<typeof candidate>) => {
        value.geometryProvenance = {
          source: 'human-created',
          operation: 'create-box',
          parentSegmentIds: [],
        } as never;
      },
    },
    {
      name: 'machine geometry with a parent',
      mutate: (value: ReturnType<typeof candidate>) => {
        (value.geometryProvenance.parentSegmentIds as string[])
          .push('existing:line');
      },
    },
    {
      name: 'unrotated evidence',
      mutate: (value: ReturnType<typeof candidate>) => {
        value.rotationEvidence.representativeRotationDegrees = 0 as never;
      },
    },
  ])('rejects $name', ({ mutate }) => {
    const value = artifact();
    mutate(value.candidates[0] as ReturnType<typeof candidate>);

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    'excluded',
    'segmentClass',
    'isMapped',
    'mappedText',
    'providerOrdinal',
  ] as const)('rejects the review/transcript field %s', (field) => {
    const value = artifact();
    const mutableCandidate = value.candidates[0] as unknown as Record<
      string,
      unknown
    >;
    mutableCandidate[field] = (
      field === 'excluded' || field === 'isMapped'
    )
      ? false
      : field === 'providerOrdinal'
        ? 4
        : 'body';

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });

  it('rejects a selection summary that does not match the candidates', () => {
    const value = artifact();
    value.rotationProfile.selectionSummary.appendedRotatedLineCount = 2;

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });

  it('rejects rotation evidence outside the configured run profile', () => {
    const value = artifact();
    value.candidates[0].rotationEvidence!.sourceRotationsDegrees = [180];
    value.candidates[0].rotationEvidence!.sourcePassStatuses = ['succeeded'];
    value.candidates[0].rotationEvidence!.memberProviderIds = ['provider:180:4'];
    value.candidates[0].rotationEvidence!.supportCount = 1;
    value.candidates[0].rotationEvidence!.representativeRotationDegrees = 180;

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });

  it('rejects candidate evidence from a recorded failed pass', () => {
    const value = artifact();
    value.rotationProfile.passOutcomes[1] = {
      rotationDegrees: 90,
      status: 'failed',
      error: {
        type: 'TopologyException',
        message: 'The provider could not construct valid polygons',
      },
    };
    value.provenance.config.parameters = {
      rotationProfile: value.rotationProfile,
    };

    expect(pageGeometryProposalV1Schema.safeParse(value).success).toBe(false);
  });
});
