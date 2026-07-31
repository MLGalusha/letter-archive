import { Router } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { TranscriptAlignmentStore } from '../../../benchmarks/transcript-alignment/store.js';
import {
  TranscriptAlignmentArtifactChangedError,
} from '../../../benchmarks/transcript-alignment/store.js';
import {
  BenchmarkValidationError,
} from '../../../benchmarks/layout/store.js';
import { invokeRouter } from '../../../test/express-test-utils.js';
import { createTranscriptAlignmentRouter } from '../transcript-alignment.js';

const RUN_ID = 'alignment-run-a';
const PAGE_KEY = '001-18881103-L01-01';
const TRANSCRIPT_ID = '001-18881103-L01-transcript-line-0001';
const ARTIFACT_SHA256 = 'a'.repeat(64);

function authenticated(router: ReturnType<typeof Router>) {
  const wrapper = Router();
  wrapper.use((req, _res, next) => {
    req.user = {
      userId: 'reviewer-1',
      email: 'reviewer@example.test',
    };
    next();
  });
  wrapper.use(router);
  return wrapper;
}

describe('transcript-alignment admin routes', () => {
  it('is hidden when the local research feature gate is disabled', async () => {
    const router = createTranscriptAlignmentRouter({
      enabled: () => false,
      store: {} as TranscriptAlignmentStore,
    });

    const response = await invokeRouter(router, {
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: 'Not found' });
  });

  it('returns the sanitized alignment run listing', async () => {
    const listAlignmentRuns = vi.fn(async () => ({
      schemaVersion: 1 as const,
      runs: [],
      invalidRuns: [],
    }));
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { listAlignmentRuns } as unknown as TranscriptAlignmentStore,
    }));

    const response = await invokeRouter(router, {
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      schemaVersion: 1,
      runs: [],
      invalidRuns: [],
    });
  });

  it('binds page reads to the authenticated admin reviewer', async () => {
    const getAlignmentPage = vi.fn(async () => ({ page: { pageKey: PAGE_KEY } }));
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { getAlignmentPage } as unknown as TranscriptAlignmentStore,
    }));

    const response = await invokeRouter(router, {
      method: 'GET',
      url: `/runs/${RUN_ID}/pages/${PAGE_KEY}`,
    });

    expect(response.statusCode).toBe(200);
    expect(getAlignmentPage).toHaveBeenCalledWith(
      RUN_ID,
      PAGE_KEY,
      'reviewer-1',
    );
  });

  it('returns a reviewer-scoped current-artifact scorecard', async () => {
    const getAlignmentScorecard = vi.fn(async () => ({
      schemaVersion: 1,
      runId: RUN_ID,
      mappings: {
        total: 10,
        reviewed: 4,
        exactAccuracy: 0.75,
      },
    }));
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { getAlignmentScorecard } as unknown as TranscriptAlignmentStore,
    }));

    const response = await invokeRouter(router, {
      method: 'GET',
      url: `/runs/${RUN_ID}/scorecard`,
    });

    expect(response.statusCode).toBe(200);
    expect(getAlignmentScorecard).toHaveBeenCalledWith(
      RUN_ID,
      'reviewer-1',
    );
    expect(response.body).toMatchObject({
      runId: RUN_ID,
      mappings: {
        reviewed: 4,
        exactAccuracy: 0.75,
      },
    });
  });

  it('validates and records a measured transcript-line review', async () => {
    const saveAlignmentReview = vi.fn(async () => ({
      review: {
        verdict: 'incorrect',
        correctSegmentIds: [`${PAGE_KEY}-line-0002`],
        activeSeconds: 8,
        repairActions: 1,
        updatedAt: '2026-07-29T12:00:00.000Z',
      },
      progress: {
        reviewedCount: 1,
        totalCount: 10,
        percent: 10,
      },
    }));
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { saveAlignmentReview } as unknown as TranscriptAlignmentStore,
    }));
    const body = {
      expectedArtifactSha256: ARTIFACT_SHA256,
      verdict: 'incorrect',
      correctSegmentIds: [`${PAGE_KEY}-line-0002`],
      activeSeconds: 8,
      repairActions: 1,
    };

    const response = await invokeRouter(router, {
      method: 'PUT',
      url: `/runs/${RUN_ID}/pages/${PAGE_KEY}/reviews/${TRANSCRIPT_ID}`,
      body,
    });

    expect(response.statusCode).toBe(200);
    expect(saveAlignmentReview).toHaveBeenCalledWith(
      RUN_ID,
      PAGE_KEY,
      TRANSCRIPT_ID,
      'reviewer-1',
      {
        ...body,
        failureModes: [],
      },
    );
    expect(response.body).toMatchObject({
      review: { verdict: 'incorrect' },
      progress: { reviewedCount: 1 },
    });
  });

  it('rejects invalid measurement values before touching the store', async () => {
    const saveAlignmentReview = vi.fn();
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { saveAlignmentReview } as unknown as TranscriptAlignmentStore,
    }));

    const response = await invokeRouter(router, {
      method: 'PUT',
      url: `/runs/${RUN_ID}/pages/${PAGE_KEY}/reviews/${TRANSCRIPT_ID}`,
      body: {
        expectedArtifactSha256: 'a'.repeat(64),
        verdict: 'incorrect',
        activeSeconds: -1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(saveAlignmentReview).not.toHaveBeenCalled();
  });

  it('requires the artifact checksum before dispatching a review write', async () => {
    const saveAlignmentReview = vi.fn();
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { saveAlignmentReview } as unknown as TranscriptAlignmentStore,
    }));

    const response = await invokeRouter(router, {
      method: 'PUT',
      url: `/runs/${RUN_ID}/pages/${PAGE_KEY}/reviews/${TRANSCRIPT_ID}`,
      body: { verdict: 'correct' },
    });

    expect(response.statusCode).toBe(400);
    expect(saveAlignmentReview).not.toHaveBeenCalled();
  });

  it('returns a stable conflict code for a stale artifact review', async () => {
    const staleSha256 = 'a'.repeat(64);
    const currentSha256 = 'b'.repeat(64);
    const saveAlignmentReview = vi.fn(async () => {
      throw new TranscriptAlignmentArtifactChangedError(
        staleSha256,
        currentSha256,
      );
    });
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { saveAlignmentReview } as unknown as TranscriptAlignmentStore,
    }));

    const response = await invokeRouter(router, {
      method: 'PUT',
      url: `/runs/${RUN_ID}/pages/${PAGE_KEY}/reviews/${TRANSCRIPT_ID}`,
      body: {
        expectedArtifactSha256: staleSha256,
        verdict: 'correct',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: 'Transcript-alignment artifact changed; reload before saving review',
      code: 'ALIGNMENT_ARTIFACT_CHANGED',
      details: {
        expectedArtifactSha256: staleSha256,
        currentArtifactSha256: currentSha256,
      },
    });
  });

  it('returns a validation error for a contradictory incorrect verdict', async () => {
    const saveAlignmentReview = vi.fn(async () => {
      throw new BenchmarkValidationError(
        'An incorrect verdict must change the proposed segment assignment',
      );
    });
    const router = authenticated(createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { saveAlignmentReview } as unknown as TranscriptAlignmentStore,
    }));

    const response = await invokeRouter(router, {
      method: 'PUT',
      url: `/runs/${RUN_ID}/pages/${PAGE_KEY}/reviews/${TRANSCRIPT_ID}`,
      body: {
        expectedArtifactSha256: ARTIFACT_SHA256,
        verdict: 'incorrect',
        correctSegmentIds: [`${PAGE_KEY}-line-0001`],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({
      error: 'An incorrect verdict must change the proposed segment assignment',
      code: 'invalid_benchmark_artifact',
    });
  });

  it('requires reviewer authentication for page detail', async () => {
    const getAlignmentPage = vi.fn();
    const router = createTranscriptAlignmentRouter({
      enabled: () => true,
      store: { getAlignmentPage } as unknown as TranscriptAlignmentStore,
    });

    const response = await invokeRouter(router, {
      method: 'GET',
      url: `/runs/${RUN_ID}/pages/${PAGE_KEY}`,
    });

    expect(response.statusCode).toBe(401);
    expect(getAlignmentPage).not.toHaveBeenCalled();
  });
});
