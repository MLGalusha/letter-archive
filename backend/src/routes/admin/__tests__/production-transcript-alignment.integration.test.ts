import { Router } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type {
  ProductionTranscriptAlignmentEnvelope,
} from '../../../schemas/production-transcript-alignment.js';
import { invokeRouter } from '../../../test/express-test-utils.js';
import {
  createProductionTranscriptAlignmentRouter,
} from '../production-transcript-alignment.js';
import {
  ProductionAlignmentGeometryConflictError,
} from '../../../services/transcript-alignment/production-letter.js';

const LETTER_ID = '11111111-1111-4111-8111-111111111111';
const SHA256 = 'a'.repeat(64);
type LoadAlignment = NonNullable<
  Parameters<typeof createProductionTranscriptAlignmentRouter>[0]
>['loadAlignment'];

function envelope(): ProductionTranscriptAlignmentEnvelope {
  return {
    schemaVersion: 1,
    algorithm: {
      name: 'content-aware-transcript-alignment',
      version: 'test',
      configChecksumSha256: SHA256,
    },
    source: {
      letterId: LETTER_ID,
      primarySourceRevision: 2,
      transcriptRevision: 5,
      transcriptChecksumSha256: SHA256,
    },
    pages: [],
  };
}

function mounted(
  loadAlignment: LoadAlignment,
) {
  const router = Router();
  router.use(
    '/letters',
    createProductionTranscriptAlignmentRouter({ loadAlignment }),
  );
  return router;
}

describe('production transcript alignment admin route', () => {
  it('returns the production envelope at the letter-scoped read URL', async () => {
    const loadAlignment = vi.fn(async () => envelope());

    const response = await invokeRouter(mounted(loadAlignment), {
      method: 'GET',
      url: `/letters/${LETTER_ID}/transcript-alignment`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(envelope());
    expect(loadAlignment).toHaveBeenCalledWith(LETTER_ID);
  });

  it('returns 404 when the letter does not exist', async () => {
    const loadAlignment = vi.fn(async () => null);

    const response = await invokeRouter(mounted(loadAlignment), {
      method: 'GET',
      url: `/letters/${LETTER_ID}/transcript-alignment`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({
      error: 'Letter not found',
    });
  });

  it('rejects a malformed letter ID before reading alignment data', async () => {
    const loadAlignment = vi.fn();

    const response = await invokeRouter(mounted(loadAlignment), {
      method: 'GET',
      url: '/letters/not-a-uuid/transcript-alignment',
    });

    expect(response.statusCode).toBe(400);
    expect(loadAlignment).not.toHaveBeenCalled();
  });

  it('returns the explicit geometry conflict when a stable read cannot be obtained', async () => {
    const loadAlignment = vi.fn(async () => {
      throw new ProductionAlignmentGeometryConflictError(LETTER_ID);
    });

    const response = await invokeRouter(mounted(loadAlignment), {
      method: 'GET',
      url: `/letters/${LETTER_ID}/transcript-alignment`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({
      error: 'Page geometry changed while transcript placement was loading',
      code: 'PAGE_GEOMETRY_CHANGED',
    });
  });
});
