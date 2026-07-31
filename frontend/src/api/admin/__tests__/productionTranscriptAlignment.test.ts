import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}));

vi.mock('../../client', () => ({
  apiGet: apiGetMock,
}));

import {
  getProductionTranscriptAlignment,
  type ProductionTranscriptAlignmentEnvelope,
} from '../productionTranscriptAlignment';

function validEnvelope(): ProductionTranscriptAlignmentEnvelope {
  return {
    schemaVersion: 1,
    algorithm: {
      name: 'content-aware-transcript-alignment',
      version: '1',
      configChecksumSha256: 'config',
    },
    source: {
      letterId: 'letter/id',
      primarySourceRevision: 2,
      transcriptRevision: 3,
      transcriptChecksumSha256: 'transcript',
    },
    pages: [{
      pageId: 'page-1',
      pageNumber: 1,
      sourceChecksumSha256: null,
      geometry: {
        lineSegments: [],
        geometryRevision: 0,
        geometryChecksumSha256: 'geometry',
        lineSegmentsChecksumSha256: 'segments',
        reviewState: {
          trustState: 'unverified',
          approvedGeometryRevision: null,
          approvedGeometryChecksumSha256: null,
          approvedBy: null,
          approvedAt: null,
        },
      },
      recognition: {
        status: 'partial',
        profileChecksumSha256: 'profile',
        exactArtifactChecksumSha256: null,
        sourceArtifactChecksumsSha256: ['source-a', 'source-b'],
        evidenceChecksumSha256: 'evidence',
        validRecordCount: 2,
        alignableSegmentCount: 2,
      },
      inputFingerprintSha256: 'fingerprint',
      status: 'ready',
      statusMessage: null,
      transcriptLines: [],
      mappings: [],
      unassignedSegments: [],
      deferredSegmentIds: [],
    }],
  };
}

describe('production transcript alignment API', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it('loads the production envelope from the encoded letter route', async () => {
    const response = validEnvelope();
    apiGetMock.mockResolvedValue(response);
    const controller = new AbortController();

    await expect(getProductionTranscriptAlignment(
      'letter/id',
      controller.signal,
    )).resolves.toEqual(response);
    expect(apiGetMock).toHaveBeenCalledWith(
      '/admin/letters/letter%2Fid/transcript-alignment',
      undefined,
      controller.signal,
    );
  });

  it('rejects recognition provenance that cannot identify its evidence', async () => {
    const response = validEnvelope();
    response.pages[0].recognition = {
      ...response.pages[0].recognition,
      evidenceChecksumSha256: null,
    };
    apiGetMock.mockResolvedValue(response);

    await expect(
      getProductionTranscriptAlignment('letter/id'),
    ).rejects.toThrow('incomplete');
  });

  it('rejects duplicate recognition source artifacts', async () => {
    const response = validEnvelope();
    response.pages[0].recognition.sourceArtifactChecksumsSha256 = [
      'source-a',
      'source-a',
    ];
    apiGetMock.mockResolvedValue(response);

    await expect(
      getProductionTranscriptAlignment('letter/id'),
    ).rejects.toThrow('incomplete');
  });

  it('rejects a page without a usable geometry revision fence', async () => {
    const response = validEnvelope();
    response.pages[0].geometry.geometryRevision = -1;
    apiGetMock.mockResolvedValue(response);

    await expect(
      getProductionTranscriptAlignment('letter/id'),
    ).rejects.toThrow('incomplete');
  });
});
