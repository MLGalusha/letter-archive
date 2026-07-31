import { describe, expect, it } from 'vitest';
import {
  pageLayoutRotationProfileSchema,
} from '../page-layout-v2.js';

function succeeded(rotationDegrees: 0 | 90 | 270) {
  return {
    rotationDegrees,
    status: 'succeeded' as const,
  };
}

function failed(rotationDegrees: 0 | 90 | 270) {
  return {
    rotationDegrees,
    status: 'failed' as const,
    error: {
      type: 'TopologyException',
      message: `The ${rotationDegrees}-degree provider pass failed`,
    },
  };
}

function rotationProfile() {
  return {
    name: 'sideways-recovery-v1',
    evidenceContract: 'native-and-source-projected-v2',
    rotationsDegrees: [0, 90, 270],
    passOutcomes: [
      succeeded(0),
      failed(90),
      succeeded(270),
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
      appendedRotatedLineCount: 1,
    },
  };
}

describe('PageLayout rotation pass outcomes', () => {
  it('accepts an audited partial recovery when the baseline and one side pass succeed', () => {
    const parsed = pageLayoutRotationProfileSchema.parse(rotationProfile());

    expect(parsed.passOutcomes).toEqual([
      succeeded(0),
      failed(90),
      succeeded(270),
    ]);
  });

  it('rejects pass outcomes that are not ordered 0, 90, then 270 degrees', () => {
    const value = rotationProfile();
    value.passOutcomes = [
      succeeded(0),
      succeeded(270),
      failed(90),
    ];

    expect(pageLayoutRotationProfileSchema.safeParse(value).success).toBe(
      false,
    );
  });

  it('rejects a failed unrotated baseline pass', () => {
    const value = rotationProfile();
    value.passOutcomes = [
      failed(0),
      succeeded(90),
      succeeded(270),
    ];

    expect(pageLayoutRotationProfileSchema.safeParse(value).success).toBe(
      false,
    );
  });

  it('rejects a recovery where both sideways passes failed', () => {
    const value = rotationProfile();
    value.passOutcomes = [
      succeeded(0),
      failed(90),
      failed(270),
    ];

    expect(pageLayoutRotationProfileSchema.safeParse(value).success).toBe(
      false,
    );
  });

  it('keeps success and failure records structurally distinct and bounded', () => {
    const successWithError = rotationProfile();
    successWithError.passOutcomes[2] = {
      ...succeeded(270),
      error: {
        type: 'Unexpected',
        message: 'Succeeded passes must not carry errors',
      },
    } as never;
    expect(
      pageLayoutRotationProfileSchema.safeParse(successWithError).success,
    ).toBe(false);

    const emptyFailure = rotationProfile();
    emptyFailure.passOutcomes[1] = {
      rotationDegrees: 90,
      status: 'failed',
      error: {
        type: '',
        message: '',
      },
    };
    expect(
      pageLayoutRotationProfileSchema.safeParse(emptyFailure).success,
    ).toBe(false);

    const oversizedFailure = rotationProfile();
    oversizedFailure.passOutcomes[1] = {
      rotationDegrees: 90,
      status: 'failed',
      error: {
        type: 'TopologyException',
        message: 'x'.repeat(501),
      },
    };
    expect(
      pageLayoutRotationProfileSchema.safeParse(oversizedFailure).success,
    ).toBe(false);
  });
});
