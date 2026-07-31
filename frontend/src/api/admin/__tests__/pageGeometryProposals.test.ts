import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiGet } from '../../client';
import {
  getCurrentRotationGeometryProposal,
  requireCurrentRotationGeometryProposalResponse,
  type CurrentRotationGeometryProposalResponse,
} from '../pageGeometryProposals';

vi.mock('../../client', () => ({
  apiGet: vi.fn(),
}));

const CHECKSUM_A = 'a'.repeat(64);
const CHECKSUM_B = 'b'.repeat(64);
const CHECKSUM_C = 'c'.repeat(64);
const CHECKSUM_D = 'd'.repeat(64);
const PAGE_ID = '00000000-0000-4000-8000-000000000001';

function validResponse(): CurrentRotationGeometryProposalResponse {
  return {
    proposal: {
      id: 'proposal-1',
      artifactChecksumSha256: CHECKSUM_D,
      createdBy: 'admin-1',
      createdAt: '2026-07-31T12:00:00.000Z',
      artifact: {
        schemaVersion: 1,
        kind: 'rotation-recovery',
        pageId: PAGE_ID,
        source: {
          primarySourceRevision: 4,
          sourceChecksumSha256: CHECKSUM_A,
          baseGeometryRevision: 7,
          baseGeometryChecksumSha256: CHECKSUM_B,
          baseLineSegmentsChecksumSha256: CHECKSUM_C,
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
            {
              rotationDegrees: 270,
              status: 'failed',
              error: {
                type: 'DetectorError',
                message: 'No usable lines',
              },
            },
          ],
          mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
          coordinateTransform: 'pil-pixel-centers-to-source-v1',
          selectionSummary: {
            rawInputLineCount: 12,
            inputLineCount: 10,
            clusterCount: 3,
            includedClusterCount: 1,
            rejectedClusterCount: 2,
            appendedRotatedLineCount: 1,
          },
        },
        run: {
          id: 'rotation-run-1',
        },
        candidates: [{
          id: 'sideways-1',
          line: -1,
          geometryType: 'baseline',
          providerTextDirection: 'vertical-rl',
          rotationEvidence: {
            evidenceContract: 'native-and-source-projected-v2',
            mergePolicy: 'baseline-plus-nonoverlapping-vertical-zones',
            clusterIndex: 0,
            supportCount: 2,
            sourceRotationsDegrees: [90],
            sourcePassStatuses: ['succeeded'],
            representativeRotationDegrees: 90,
            representativeProviderOrdinal: 2,
            memberProviderIds: ['provider-sideways-1'],
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
          boundary: [
            { x: 90, y: 110 },
            { x: 120, y: 110 },
            { x: 120, y: 270 },
            { x: 90, y: 270 },
          ],
        }],
      },
    },
  };
}

describe('current rotation geometry proposal API', () => {
  const apiGetMock = vi.mocked(apiGet);

  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it('requests and validates the current page proposal', async () => {
    const response = validResponse();
    apiGetMock.mockResolvedValue(response);
    const controller = new AbortController();

    await expect(getCurrentRotationGeometryProposal(
      PAGE_ID,
      controller.signal,
    )).resolves.toEqual(response);

    expect(apiGetMock).toHaveBeenCalledWith(
      `/admin/letters/pages/${PAGE_ID}/geometry-proposals/rotation/current`,
      undefined,
      controller.signal,
    );
  });

  it('accepts a page with no current proposal', () => {
    expect(requireCurrentRotationGeometryProposalResponse({
      proposal: null,
    })).toEqual({ proposal: null });
  });

  it('accepts optional creator metadata without requiring it', () => {
    const response = validResponse();
    if (response.proposal) delete response.proposal.createdBy;

    expect(
      requireCurrentRotationGeometryProposalResponse(response),
    ).toEqual(response);
  });

  it('rejects candidates outside the proposal image', () => {
    const response = validResponse();
    if (response.proposal) {
      response.proposal.artifact.candidates[0].bbox[2] = 900;
    }

    expect(() => (
      requireCurrentRotationGeometryProposalResponse(response)
    )).toThrow('candidates were invalid');
  });

  it('rejects a selection summary that could hide missing candidates', () => {
    const response = validResponse();
    if (response.proposal) {
      response.proposal.artifact.rotationProfile.selectionSummary
        .appendedRotatedLineCount = 2;
    }

    expect(() => (
      requireCurrentRotationGeometryProposalResponse(response)
    )).toThrow('selection summary was invalid');
  });
});
