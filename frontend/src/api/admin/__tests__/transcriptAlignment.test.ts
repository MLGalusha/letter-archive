// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTranscriptAlignmentIndex,
  getTranscriptAlignmentPage,
  putTranscriptAlignmentReview,
} from '../transcriptAlignment';

describe('transcript alignment API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('loads the local alignment run index through the shared authenticated client', async () => {
    localStorage.setItem('adminToken', 'alignment-admin-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ schemaVersion: 1, runs: [], invalidRuns: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(getTranscriptAlignmentIndex()).resolves.toMatchObject({
      schemaVersion: 1,
      runs: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/layout-benchmark/alignment'),
      expect.objectContaining({
        credentials: 'include',
        headers: { Authorization: 'Bearer alignment-admin-token' },
      }),
    );
  });

  it('encodes run and page identities in the page-detail path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ schemaVersion: 1 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await getTranscriptAlignmentPage('run / one', 'page / two');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/admin/layout-benchmark/alignment/runs/run%20%2F%20one/pages/page%20%2F%20two',
      ),
      expect.any(Object),
    );
  });

  it('saves a reviewer-scoped line judgment with corrected segment evidence', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({
        review: {
          verdict: 'correct',
          correctSegmentIds: ['segment-one'],
          failureModes: [],
          activeSeconds: 2,
          repairActions: 0,
          updatedAt: '2026-07-29T00:00:00.000Z',
        },
        progress: { reviewedCount: 1, totalCount: 4, percent: 25 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await putTranscriptAlignmentReview('run-one', '005-19150813-L01-01', 'line / one', {
      expectedArtifactSha256: 'artifact-sha',
      verdict: 'correct',
      correctSegmentIds: ['segment-one'],
      failureModes: [],
      activeSeconds: 2,
      repairActions: 0,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        '/admin/layout-benchmark/alignment/runs/run-one/pages/005-19150813-L01-01/reviews/line%20%2F%20one',
      ),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          expectedArtifactSha256: 'artifact-sha',
          verdict: 'correct',
          correctSegmentIds: ['segment-one'],
          failureModes: [],
          activeSeconds: 2,
          repairActions: 0,
        }),
      }),
    );
  });
});
