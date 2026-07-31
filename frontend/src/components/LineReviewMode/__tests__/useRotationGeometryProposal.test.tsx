// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentRotationGeometryProposal,
  type CurrentRotationGeometryProposal,
} from '../../../api/admin/pageGeometryProposals';
import {
  useRotationGeometryProposal,
  type RotationProposalIdentity,
} from '../useRotationGeometryProposal';

vi.mock('../../../api/admin/pageGeometryProposals', () => ({
  getCurrentRotationGeometryProposal: vi.fn(),
}));

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const CHECKSUM_C = 'c'.repeat(64);
const CHECKSUM_D = 'd'.repeat(64);
const PAGE_A = '00000000-0000-4000-8000-000000000001';
const PAGE_B = '00000000-0000-4000-8000-000000000002';

function identity(
  pageId: string,
  overrides: Partial<RotationProposalIdentity> = {},
): RotationProposalIdentity {
  return {
    pageId,
    primarySourceRevision: 4,
    sourceChecksumSha256: CHECKSUM_A,
    geometryRevision: 7,
    geometryChecksumSha256: CHECKSUM_B,
    lineSegmentsChecksumSha256: CHECKSUM_C,
    ...overrides,
  };
}

function proposal(
  pageId: string,
  overrides: {
    sourceChecksumSha256?: string;
    geometryRevision?: number;
    geometryChecksumSha256?: string;
    lineSegmentsChecksumSha256?: string;
  } = {},
): CurrentRotationGeometryProposal {
  return {
    id: `proposal-${pageId}`,
    artifactChecksumSha256: CHECKSUM_D,
    createdAt: '2026-07-31T12:00:00.000Z',
    artifact: {
      schemaVersion: 1,
      kind: 'rotation-recovery',
      pageId,
      source: {
        primarySourceRevision: 4,
        sourceChecksumSha256:
          overrides.sourceChecksumSha256 ?? CHECKSUM_A,
        baseGeometryRevision: overrides.geometryRevision ?? 7,
        baseGeometryChecksumSha256:
          overrides.geometryChecksumSha256 ?? CHECKSUM_B,
        baseLineSegmentsChecksumSha256:
          overrides.lineSegmentsChecksumSha256 ?? CHECKSUM_C,
        image: {
          width: 500,
          height: 700,
          checksumSha256: CHECKSUM_A,
        },
      },
      rotationProfile: {
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
        selectionSummary: {
          rawInputLineCount: 1,
          inputLineCount: 1,
          clusterCount: 1,
          includedClusterCount: 1,
          rejectedClusterCount: 0,
          appendedRotatedLineCount: 1,
        },
      },
      run: { id: 'run-1' },
      candidates: [{
        id: 'candidate-1',
        line: -1,
        geometryType: 'baseline',
        providerTextDirection: 'vertical-rl',
        rotationEvidence: {
          evidenceContract: 'native-and-source-projected-v2',
          mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
          clusterIndex: 0,
          supportCount: 1,
          sourceRotationsDegrees: [90],
          sourcePassStatuses: ['succeeded'],
          representativeRotationDegrees: 90,
          representativeProviderOrdinal: 0,
          memberProviderIds: ['provider-1'],
          readingOrderSource: 'unresolved-rotated-proposal',
        },
        baseline: [[100, 120], [100, 260]],
        bbox: [90, 110, 120, 270],
        geometryProvenance: {
          source: 'machine',
          operation: 'detected',
          parentSegmentIds: [],
        },
        ocrText: '',
      }],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useRotationGeometryProposal', () => {
  const getProposalMock = vi.mocked(
    getCurrentRotationGeometryProposal,
  );

  beforeEach(() => {
    getProposalMock.mockReset();
  });

  it('accepts only a proposal for the exact current geometry identity', async () => {
    getProposalMock.mockResolvedValue({
      proposal: proposal(PAGE_A),
    });
    const { result } = renderHook(() => (
      useRotationGeometryProposal(identity(PAGE_A))
    ));

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.proposal?.artifact.pageId).toBe(PAGE_A);
  });

  it('fails closed when the server returns an older geometry proposal', async () => {
    getProposalMock.mockResolvedValue({
      proposal: proposal(PAGE_A, {
        geometryRevision: 6,
      }),
    });
    const { result } = renderHook(() => (
      useRotationGeometryProposal(identity(PAGE_A))
    ));

    await waitFor(() => {
      expect(result.current.status).toBe('stale');
    });
    expect(result.current.proposal).toBeNull();
  });

  it('does not request without a complete checksum-bound identity', () => {
    const { result } = renderHook(() => (
      useRotationGeometryProposal(identity(PAGE_A, {
        sourceChecksumSha256: '',
      }))
    ));

    expect(result.current.status).toBe('idle');
    expect(result.current.proposal).toBeNull();
    expect(getProposalMock).not.toHaveBeenCalled();
  });

  it('does not let a slow prior page response leak across page switches', async () => {
    const pageARequest = deferred<{
      proposal: CurrentRotationGeometryProposal | null;
    }>();
    const pageBRequest = deferred<{
      proposal: CurrentRotationGeometryProposal | null;
    }>();
    getProposalMock.mockImplementation((pageId) => (
      pageId === PAGE_A ? pageARequest.promise : pageBRequest.promise
    ));

    const { result, rerender } = renderHook(
      ({ pageId }) => useRotationGeometryProposal(identity(pageId)),
      {
        initialProps: { pageId: PAGE_A },
      },
    );

    rerender({ pageId: PAGE_B });
    await act(async () => {
      pageBRequest.resolve({ proposal: proposal(PAGE_B) });
      await pageBRequest.promise;
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(result.current.proposal?.artifact.pageId).toBe(PAGE_B);
    });

    await act(async () => {
      pageARequest.resolve({ proposal: proposal(PAGE_A) });
      await pageARequest.promise;
    });
    expect(result.current.proposal?.artifact.pageId).toBe(PAGE_B);
  });
});
