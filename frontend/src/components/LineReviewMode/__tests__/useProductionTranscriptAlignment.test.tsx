// @vitest-environment jsdom

import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProductionTranscriptAlignment,
  type ProductionTranscriptAlignmentEnvelope,
} from '../../../api/admin/productionTranscriptAlignment';
import { useProductionTranscriptAlignment } from '../useProductionTranscriptAlignment';

vi.mock('../../../api/admin/productionTranscriptAlignment', () => ({
  getProductionTranscriptAlignment: vi.fn(),
}));

function envelope(
  letterId: string,
  primarySourceRevision: number,
  transcriptRevision = 0,
  transcriptChecksumSha256 = 'transcript',
): ProductionTranscriptAlignmentEnvelope {
  return {
    schemaVersion: 1,
    algorithm: {
      name: 'content-aware-transcript-alignment',
      version: 'test',
      configChecksumSha256: 'config',
    },
    source: {
      letterId,
      primarySourceRevision,
      transcriptRevision,
      transcriptChecksumSha256,
    },
    pages: [],
  };
}

function envelopeWithPageGeometry(
  geometryRevision: number,
  geometryChecksumSha256 = 'geometry',
  lineSegmentsChecksumSha256 = 'segments',
): ProductionTranscriptAlignmentEnvelope {
  const result = envelope('letter-a', 1);
  result.pages = [{
    pageId: 'page-1',
    pageNumber: 1,
    sourceChecksumSha256: null,
    geometry: {
      lineSegments: [],
      geometryRevision,
      geometryChecksumSha256,
      lineSegmentsChecksumSha256,
      reviewState: {
        trustState: 'unverified',
        approvedGeometryRevision: null,
        approvedGeometryChecksumSha256: null,
        approvedBy: null,
        approvedAt: null,
      },
    },
    recognition: {
      status: 'missing',
      profileChecksumSha256: 'profile',
      exactArtifactChecksumSha256: null,
      sourceArtifactChecksumsSha256: [],
      evidenceChecksumSha256: null,
      validRecordCount: 0,
      alignableSegmentCount: 0,
    },
    inputFingerprintSha256: 'fingerprint',
    status: 'geometry-missing',
    statusMessage: null,
    transcriptLines: [],
    mappings: [],
    unassignedSegments: [],
    deferredSegmentIds: [],
  }];
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function StrictModeWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

describe('useProductionTranscriptAlignment', () => {
  const getAlignmentMock = vi.mocked(getProductionTranscriptAlignment);

  beforeEach(() => {
    getAlignmentMock.mockReset();
  });

  it('ignores a stale response after the letter identity changes', async () => {
    const first = deferred<ProductionTranscriptAlignmentEnvelope>();
    const second = deferred<ProductionTranscriptAlignmentEnvelope>();
    getAlignmentMock.mockImplementation((letterId) => (
      letterId === 'letter-a' ? first.promise : second.promise
    ));

    const { result, rerender } = renderHook(
      ({ letterId, sourceRevision }) => useProductionTranscriptAlignment(
        letterId,
        sourceRevision,
        0,
        'transcript',
      ),
      {
        initialProps: {
          letterId: 'letter-a',
          sourceRevision: 1,
        },
      },
    );

    rerender({
      letterId: 'letter-b',
      sourceRevision: 2,
    });
    await act(async () => {
      second.resolve(envelope('letter-b', 2));
      await second.promise;
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(result.current.envelope?.source.letterId).toBe('letter-b');
    });

    await act(async () => {
      first.resolve(envelope('letter-a', 1));
      await first.promise;
    });
    expect(result.current.envelope?.source.letterId).toBe('letter-b');
  });

  it('rejects an envelope from an older transcript revision', async () => {
    getAlignmentMock.mockResolvedValue(
      envelope('letter-a', 1, 3, 'old-transcript'),
    );

    const { result } = renderHook(() => useProductionTranscriptAlignment(
      'letter-a',
      1,
      4,
      'current-transcript',
    ));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.envelope).toBeNull();
    expect(result.current.error?.message).toContain('older letter source');
  });

  it('loads and refreshes after StrictMode setup-cleanup-setup', async () => {
    getAlignmentMock.mockResolvedValue(envelope('letter-a', 1));
    const { result } = renderHook(
      () => useProductionTranscriptAlignment(
        'letter-a',
        1,
        0,
        'transcript',
      ),
      {
        wrapper: StrictModeWrapper,
        reactStrictMode: true,
      },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.envelope?.algorithm.version).toBe('test');
    expect(getAlignmentMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    const refreshed = envelope('letter-a', 1);
    refreshed.algorithm.version = 'refreshed';
    getAlignmentMock.mockResolvedValueOnce(refreshed);

    await act(async () => {
      await expect(result.current.refresh()).resolves.toBe(true);
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.envelope?.algorithm.version).toBe('refreshed');
  });

  it('fails closed without the revision-bound transcript identity', async () => {
    const { result } = renderHook(() => useProductionTranscriptAlignment(
      'letter-a',
      1,
    ));

    expect(result.current.status).toBe('error');
    expect(result.current.envelope).toBeNull();
    expect(result.current.error?.message).toContain(
      'transcript revision and checksum',
    );
    expect(getAlignmentMock).not.toHaveBeenCalled();

    await act(async () => {
      await expect(result.current.refresh()).resolves.toBe(false);
    });
    expect(getAlignmentMock).not.toHaveBeenCalled();
  });

  it('rejects an alignment response from an older local geometry revision', async () => {
    getAlignmentMock.mockResolvedValue(envelopeWithPageGeometry(4));
    const geometryExpectations = [{
      pageId: 'page-1',
      geometryRevision: 5,
      geometryChecksumSha256: 'newer-geometry',
      lineSegmentsChecksumSha256: 'newer-segments',
    }];

    const { result } = renderHook(() => useProductionTranscriptAlignment(
      'letter-a',
      1,
      0,
      'transcript',
      geometryExpectations,
    ));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.envelope).toBeNull();
    expect(result.current.error?.message).toContain(
      'older page geometry',
    );
  });

  it('rejects a different geometry checksum at the same revision', async () => {
    getAlignmentMock.mockResolvedValue(envelopeWithPageGeometry(
      5,
      'stale-geometry',
      'stale-segments',
    ));
    const geometryExpectations = [{
      pageId: 'page-1',
      geometryRevision: 5,
      geometryChecksumSha256: 'current-geometry',
      lineSegmentsChecksumSha256: 'current-segments',
    }];

    const { result } = renderHook(() => useProductionTranscriptAlignment(
      'letter-a',
      1,
      0,
      'transcript',
      geometryExpectations,
    ));

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.envelope).toBeNull();
    expect(result.current.error?.message).toContain(
      'conflicts with current page geometry',
    );
  });

  it('does not let a slower older-geometry request replace a newer revision', async () => {
    const older = deferred<ProductionTranscriptAlignmentEnvelope>();
    const newer = deferred<ProductionTranscriptAlignmentEnvelope>();
    getAlignmentMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const revisionFour = [{
      pageId: 'page-1',
      geometryRevision: 4,
      geometryChecksumSha256: 'geometry-4',
      lineSegmentsChecksumSha256: 'segments-4',
    }];
    const revisionFive = [{
      pageId: 'page-1',
      geometryRevision: 5,
      geometryChecksumSha256: 'geometry-5',
      lineSegmentsChecksumSha256: 'segments-5',
    }];

    const { result, rerender } = renderHook(
      ({ geometryExpectations }) => useProductionTranscriptAlignment(
        'letter-a',
        1,
        0,
        'transcript',
        geometryExpectations,
      ),
      {
        initialProps: { geometryExpectations: revisionFour },
      },
    );

    rerender({ geometryExpectations: revisionFive });
    await act(async () => {
      newer.resolve(envelopeWithPageGeometry(
        5,
        'geometry-5',
        'segments-5',
      ));
      await newer.promise;
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(
        result.current.envelope?.pages[0].geometry.geometryRevision,
      ).toBe(5);
    });

    await act(async () => {
      older.resolve(envelopeWithPageGeometry(
        4,
        'geometry-4',
        'segments-4',
      ));
      await older.promise;
    });
    expect(
      result.current.envelope?.pages[0].geometry.geometryRevision,
    ).toBe(5);
  });
});
