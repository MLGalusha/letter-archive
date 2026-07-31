import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  transcriptAlignmentReviewInputSchema,
} from '../../benchmarks/transcript-alignment/schemas.js';
import {
  defaultTranscriptAlignmentStore,
  TranscriptAlignmentStore,
} from '../../benchmarks/transcript-alignment/store.js';
import { validateBody } from '../../middleware/validate.js';
import { AppError } from '../../utils/response-helpers.js';
import { layoutBenchmarkFeatureEnabled } from './layout-benchmark.js';

export interface TranscriptAlignmentRouterOptions {
  store?: TranscriptAlignmentStore;
  enabled?: () => boolean;
  reviewerId?: (request: Request) => string;
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function authenticatedReviewerId(request: Request): string {
  const reviewerId = request.user?.userId;
  if (!reviewerId) {
    throw new AppError(401, 'Authentication required');
  }
  return reviewerId;
}

function publicRouteError(error: unknown): unknown {
  if (error instanceof AppError || error instanceof z.ZodError) {
    return error;
  }
  // Native filesystem errors can include absolute paths. Keep those details
  // in server logs while returning a stable, non-path-bearing API error.
  return new AppError(
    500,
    'Transcript-alignment artifact operation failed',
  );
}

export function createTranscriptAlignmentRouter(
  options: TranscriptAlignmentRouterOptions = {},
) {
  const router = Router();
  const store = options.store ?? defaultTranscriptAlignmentStore;
  const enabled = options.enabled ?? layoutBenchmarkFeatureEnabled;
  const reviewerIdFor = options.reviewerId ?? authenticatedReviewerId;

  router.use((_req, res, next) => {
    if (!enabled()) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  });

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await store.listAlignmentRuns());
    } catch (error) {
      next(publicRouteError(error));
    }
  });

  router.get('/runs/:runId/scorecard', async (req, res, next) => {
    try {
      res.json(await store.getAlignmentScorecard(
        routeParam(req.params.runId),
        reviewerIdFor(req),
      ));
    } catch (error) {
      next(publicRouteError(error));
    }
  });

  router.get('/runs/:runId/pages/:pageKey', async (req, res, next) => {
    try {
      res.json(await store.getAlignmentPage(
        routeParam(req.params.runId),
        routeParam(req.params.pageKey),
        reviewerIdFor(req),
      ));
    } catch (error) {
      next(publicRouteError(error));
    }
  });

  router.put(
    '/runs/:runId/pages/:pageKey/reviews/:transcriptId',
    validateBody(transcriptAlignmentReviewInputSchema),
    async (req, res, next) => {
      try {
        res.json(await store.saveAlignmentReview(
          routeParam(req.params.runId),
          routeParam(req.params.pageKey),
          routeParam(req.params.transcriptId),
          reviewerIdFor(req),
          req.body as z.infer<typeof transcriptAlignmentReviewInputSchema>,
        ));
      } catch (error) {
        next(publicRouteError(error));
      }
    },
  );

  return router;
}

export default createTranscriptAlignmentRouter();
