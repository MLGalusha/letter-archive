import { readFile } from 'node:fs/promises';
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  annotationUpdateSchema,
  evaluationDecisionInputSchema,
  pageListQuerySchema,
  scorecardQuerySchema,
  type LayoutAnnotation,
  type LayoutRunManifest,
} from '../../benchmarks/layout/schemas.js';
import { buildScorecard } from '../../benchmarks/layout/scoring.js';
import {
  preparedRasterComparisonKey,
  preparedRastersMatch,
  type PreparedRasterFingerprint,
} from '../../benchmarks/layout/raster-fingerprint.js';
import {
  defaultLayoutBenchmarkStore,
  LayoutBenchmarkStore,
  type CohortPageRecord,
  type RunArtifactKind,
} from '../../benchmarks/layout/store.js';
import { validateBody, validateQuery } from '../../middleware/validate.js';
import { AppError } from '../../utils/response-helpers.js';

const ADMIN_ROOT = '/admin/layout-benchmark';
const IMAGE_ROOT = '/images/layout-benchmark';

const artifactKindSchema = z.enum([
  'prepared',
  'overlay',
  'raw',
  'error',
  'pageMask',
  'engineInput',
  'inputStage',
]);

export interface LayoutBenchmarkRouterOptions {
  store?: LayoutBenchmarkStore;
  enabled?: () => boolean;
  reviewerId?: (request: Request) => string;
}

export function layoutBenchmarkFeatureEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production'
    || process.env.LAYOUT_BENCHMARK_ENABLED === 'true'
  );
}

function authenticatedReviewerId(request: Request): string {
  const reviewerId = request.user?.userId;
  if (!reviewerId) {
    throw new AppError(401, 'Authentication required');
  }
  return reviewerId;
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function preparedKey(
  run: LayoutRunManifest,
  page: LayoutRunManifest['pages'][number],
  rasterFingerprint?: PreparedRasterFingerprint,
): string | null {
  if (!page.prepared) return null;
  const rasterKey = preparedRasterComparisonKey({
    ...page.prepared,
    rasterFingerprint: rasterFingerprint ?? page.prepared.rasterFingerprint,
  });
  return rasterKey
    ? `${run.preprocessing.profileSha256}:${rasterKey}`
    : null;
}

function runPageSummary(
  run: LayoutRunManifest,
  page: LayoutRunManifest['pages'][number],
  rasterFingerprint?: PreparedRasterFingerprint,
) {
  const path = `${ADMIN_ROOT}/runs/${encodeURIComponent(run.runId)}/pages/${encodeURIComponent(page.pageKey)}`;
  const imagePath = `${IMAGE_ROOT}/runs/${encodeURIComponent(run.runId)}/pages/${encodeURIComponent(page.pageKey)}`;
  return {
    runId: run.runId,
    engineId: run.engine.id,
    state: run.state,
    status: page.status,
    durationMs: page.durationMs,
    peakRssBytes: page.peakRssBytes,
    resourceMeasurement: page.resourceMeasurement,
    preprocessingProfileSha256: run.preprocessing.profileSha256,
    preparedComparisonKey: preparedKey(run, page, rasterFingerprint),
    prepared: page.prepared ? {
      sha256: page.prepared.sha256,
      width: page.prepared.width,
      height: page.prepared.height,
      rasterFingerprint: rasterFingerprint ?? page.prepared.rasterFingerprint ?? null,
      url: `${imagePath}/prepared`,
    } : null,
    layoutUrl: page.artifacts.normalized ? `${path}/layout` : null,
    overlayUrl: page.artifacts.overlay ? `${imagePath}/overlay` : null,
    pageMaskUrl: page.artifacts.pageMask ? `${imagePath}/pageMask` : null,
    engineInputUrl: page.artifacts.engineInput ? `${imagePath}/engineInput` : null,
    rawUrl: page.artifacts.raw ? `${path}/artifacts/raw` : null,
    errorUrl: page.artifacts.error ? `${path}/artifacts/error` : null,
    inputStageUrl: page.artifacts.inputStage
      ? `${path}/artifacts/inputStage`
      : null,
    counts: page.counts,
    warnings: page.warnings,
    error: page.error,
  };
}

function pageSummary(
  page: CohortPageRecord,
  runs: LayoutRunManifest[],
  annotation: LayoutAnnotation | null,
  rasterFingerprints: ReadonlyMap<string, PreparedRasterFingerprint> = new Map(),
) {
  const selectedRuns = runs.flatMap((run) => {
    const runPage = run.pages.find((candidate) => candidate.pageKey === page.pageKey);
    return runPage ? [runPageSummary(
      run,
      runPage,
      rasterFingerprints.get(run.runId),
    )] : [];
  });
  return {
    pageKey: page.pageKey,
    letterKey: page.letterKey,
    collectionCode: page.collectionCode,
    dateRaw: page.dateRaw,
    type: page.type,
    typeSequence: page.typeSequence,
    pageNumber: page.pageNumber,
    originalFilename: page.originalFilename,
    challengeTags: page.challengeTags,
    groundTruthStatus: annotation?.status ?? 'unannotated',
    source: {
      sha256: page.checksumSha256,
      encodedWidth: page.width,
      encodedHeight: page.height,
      coordinateSpace: 'encoded-source-pixels',
      url: `${IMAGE_ROOT}/pages/${encodeURIComponent(page.pageKey)}/source`,
    },
    groundTruth: {
      status: annotation?.status ?? 'unannotated',
      url: `${ADMIN_ROOT}/ground-truth/${encodeURIComponent(page.pageKey)}`,
    },
    runs: selectedRuns,
  };
}

function runSummary(run: LayoutRunManifest) {
  const diagnosticValue = run.engine.configuration.values.diagnostic;
  const diagnostic = (
    diagnosticValue
    && typeof diagnosticValue === 'object'
    && !Array.isArray(diagnosticValue)
    && typeof diagnosticValue.equivalentToDefaultProfile === 'boolean'
  ) ? {
      equivalentToDefaultProfile: diagnosticValue.equivalentToDefaultProfile,
      comparisonProfile: typeof diagnosticValue.comparisonProfile === 'string'
        ? diagnosticValue.comparisonProfile
        : null,
      purpose: typeof diagnosticValue.purpose === 'string'
        ? diagnosticValue.purpose
        : typeof diagnosticValue.reason === 'string'
          ? diagnosticValue.reason
          : null,
      capReachedIsQualityFailure: diagnosticValue.capReachedIsQualityFailure === true,
    } : null;
  return {
    runId: run.runId,
    state: run.state,
    engineId: run.engine.id,
    engineVersion: run.engine.package.version,
    adapterVersion: run.engine.adapterVersion,
    preprocessingProfileId: run.preprocessing.profileId,
    preprocessingProfileSha256: run.preprocessing.profileSha256,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    selected: run.summary.selected,
    succeeded: run.summary.succeeded,
    failed: run.summary.failed,
    durationMs: run.summary.durationMs,
    diagnostic,
  };
}

export function createLayoutBenchmarkRouter(
  options: LayoutBenchmarkRouterOptions = {},
) {
  const router = Router();
  const store = options.store ?? defaultLayoutBenchmarkStore;
  const enabled = options.enabled ?? layoutBenchmarkFeatureEnabled;
  const reviewerIdFor = options.reviewerId ?? authenticatedReviewerId;

  router.use((_req, res, next) => {
    if (!enabled()) {
      // Hide the local research surface entirely in production unless an
      // operator deliberately enables it.
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  });

  router.get('/', async (req, res, next) => {
    try {
      const reviewerId = reviewerIdFor(req);
      const [cohort, runListing, evaluation] = await Promise.all([
        store.loadCohort(),
        store.listRuns(),
        store.getEvaluation(reviewerId),
      ]);
      const progress = await store.evaluationProgress(evaluation);
      const challengeTags = [...new Set(
        cohort.letters.flatMap((letter) => (
          letter.pages.flatMap((page) => page.challengeTags)
        )),
      )].sort();
      res.json({
        schemaVersion: 1,
        cohort: {
          id: cohort.cohortId,
          description: cohort.description,
          createdAt: cohort.createdAt,
          letterCount: cohort.coverage.letterCount,
          pageCount: cohort.coverage.pageCount,
          collectionCodes: cohort.coverage.collectionCodesAtSelection,
          challengeTags,
        },
        runs: {
          valid: runListing.runs.length,
          invalid: runListing.invalidRuns.length,
          completed: runListing.runs.filter((run) => run.state === 'completed').length,
          completedWithFailures: runListing.runs.filter(
            (run) => run.state === 'completed_with_failures',
          ).length,
        },
        reviewer: {
          id: reviewerId,
          displayEmail: req.user?.email ?? req.adminUser?.email ?? null,
          ...progress,
        },
        capabilities: {
          groundTruthWrite: true,
          evaluationWrite: true,
          runArtifactsReadOnly: true,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/pages',
    validateQuery(pageListQuerySchema),
    async (req, res, next) => {
      try {
        const query = req.query as unknown as z.infer<typeof pageListQuerySchema>;
        const [cohort, pages, runListing] = await Promise.all([
          store.loadCohort(),
          store.listCohortPages(),
          store.listRuns(),
        ]);
        const annotations = new Map<string, LayoutAnnotation | null>();
        await Promise.all(pages.map(async (page) => {
          annotations.set(page.pageKey, await store.getAnnotation(page.pageKey));
        }));
        let summaries = pages.map((page) => pageSummary(
          page,
          runListing.runs,
          annotations.get(page.pageKey) ?? null,
        ));
        if (query.collectionCode) {
          summaries = summaries.filter((page) => page.collectionCode === query.collectionCode);
        }
        if (query.challengeTag) {
          summaries = summaries.filter((page) => page.challengeTags.includes(query.challengeTag!));
        }
        if (query.groundTruthStatus) {
          summaries = summaries.filter(
            (page) => page.groundTruthStatus === query.groundTruthStatus,
          );
        }
        if (query.runId) {
          summaries = summaries.filter((page) => {
            const run = page.runs.find((candidate) => candidate.runId === query.runId);
            if (!query.runStatus) return Boolean(run);
            if (query.runStatus === 'not_selected') return !run;
            return run?.status === query.runStatus;
          });
        }
        res.json({
          cohortId: cohort.cohortId,
          total: pages.length,
          filteredTotal: summaries.length,
          pages: summaries,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/pages/:pageKey', async (req, res, next) => {
    try {
      const [page, runListing, annotation] = await Promise.all([
        store.getCohortPage(req.params.pageKey),
        store.listRuns(),
        store.getAnnotation(req.params.pageKey),
      ]);
      const rasterFingerprints = new Map<string, PreparedRasterFingerprint>();
      for (const run of runListing.runs) {
        const runPage = run.pages.find(
          (candidate) => candidate.pageKey === page.pageKey,
        );
        if (!runPage?.prepared) continue;
        rasterFingerprints.set(
          run.runId,
          await store.getPreparedRasterFingerprint(
            run.runId,
            page.pageKey,
          ),
        );
      }
      const summary = pageSummary(
        page,
        runListing.runs,
        annotation,
        rasterFingerprints,
      );
      const groups = new Map<string, {
        preprocessingProfileSha256: string;
        preparedSha256: string;
        rasterFingerprint: PreparedRasterFingerprint;
        width: number;
        height: number;
        runIds: string[];
      }>();
      summary.runs.forEach((run) => {
        if (
          !run.prepared
          || !run.prepared.rasterFingerprint
          || run.status !== 'succeeded'
        ) return;
        const key = run.preparedComparisonKey!;
        const group = groups.get(key) ?? {
          preprocessingProfileSha256: run.preprocessingProfileSha256,
          preparedSha256: run.prepared.sha256,
          rasterFingerprint: run.prepared.rasterFingerprint,
          width: run.prepared.width,
          height: run.prepared.height,
          runIds: [],
        };
        group.runIds.push(run.runId);
        groups.set(key, group);
      });
      const comparableRunIds = new Set(
        [...groups.values()]
          .filter((group) => group.runIds.length > 1)
          .flatMap((group) => group.runIds),
      );
      const successfulPreparedRuns = summary.runs.filter(
        (run) => run.status === 'succeeded' && run.prepared,
      );
      res.json({
        page: summary,
        comparisonGroups: [...groups.values()],
        incomparableRuns: summary.runs
          .filter((run) => !comparableRunIds.has(run.runId))
          .map((run) => ({
            runId: run.runId,
            reason: run.status !== 'succeeded'
              ? 'run_failed'
              : !run.prepared
                ? 'prepared_input_unavailable'
                : successfulPreparedRuns.some((candidate) => (
                  candidate.runId !== run.runId
                  && preparedRastersMatch(
                    candidate.prepared,
                    run.prepared,
                  )
                  && candidate.preprocessingProfileSha256
                    !== run.preprocessingProfileSha256
                ))
                  ? 'preprocessing_profile_mismatch'
                : 'no_other_run_shares_prepared_raster_and_dimensions',
          })),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/runs', async (_req, res, next) => {
    try {
      const listing = await store.listRuns();
      res.json({
        runs: listing.runs.map(runSummary),
        invalidRuns: listing.invalidRuns,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/runs/:runId', async (req, res, next) => {
    try {
      const run = await store.getRun(req.params.runId);
      res.json({
        run,
        links: {
          pages: run.pages.map((page) => {
            const summary = runPageSummary(run, page);
            return {
              pageKey: page.pageKey,
              preparedUrl: summary.prepared?.url ?? null,
              layoutUrl: summary.layoutUrl,
              overlayUrl: summary.overlayUrl,
              pageMaskUrl: summary.pageMaskUrl,
              engineInputUrl: summary.engineInputUrl,
              rawUrl: summary.rawUrl,
              errorUrl: summary.errorUrl,
              inputStageUrl: summary.inputStageUrl,
            };
          }),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/runs/:runId/pages/:pageKey/layout', async (req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(await store.getNormalizedLayout(req.params.runId, req.params.pageKey));
    } catch (error) {
      next(error);
    }
  });

  router.get('/runs/:runId/pages/:pageKey/artifacts/:kind', async (req, res, next) => {
    try {
      const kind = artifactKindSchema.parse(req.params.kind) as RunArtifactKind;
      const artifact = await store.resolveRunArtifact(
        req.params.runId,
        req.params.pageKey,
        kind,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (kind === 'raw') {
        const filename = artifact.filename.replace(/[^A-Za-z0-9._-]/g, '_');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      } else {
        res.setHeader('Content-Type', artifact.contentType);
      }
      res.setHeader('Content-Length', String(artifact.sizeBytes));
      res.send(await readFile(artifact.absolutePath));
    } catch (error) {
      next(error);
    }
  });

  router.get('/evaluations/me', async (req, res, next) => {
    try {
      const evaluation = await store.getEvaluation(reviewerIdFor(req));
      res.json({
        evaluation,
        progress: await store.evaluationProgress(evaluation),
      });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/evaluations/me/pages/:pageKey',
    validateBody(evaluationDecisionInputSchema),
    async (req, res, next) => {
      try {
        const result = await store.createEvaluationDecision(
          reviewerIdFor(req),
          routeParam(req.params.pageKey),
          req.body as z.infer<typeof evaluationDecisionInputSchema>,
        );
        res.json({
          decision: result.decision,
          evaluation: result.evaluation,
          progress: await store.evaluationProgress(result.evaluation),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/ground-truth/:pageKey', async (req, res, next) => {
    try {
      const annotation = await store.getAnnotation(req.params.pageKey);
      res.json({ exists: annotation !== null, annotation });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    '/ground-truth/:pageKey',
    validateBody(annotationUpdateSchema),
    async (req, res, next) => {
      try {
        const annotation = await store.saveAnnotation(
          routeParam(req.params.pageKey),
          reviewerIdFor(req),
          req.body as z.infer<typeof annotationUpdateSchema>,
        );
        res.json({ annotation });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/scorecards',
    validateQuery(scorecardQuerySchema),
    async (req, res, next) => {
      try {
        const query = req.query as unknown as z.infer<typeof scorecardQuerySchema>;
        res.json(await buildScorecard(
          store,
          query.runIds,
          reviewerIdFor(req),
          {
            lineTolerancePx: query.lineTolerancePx,
            lineIouThreshold: query.lineIouThreshold,
            orientationToleranceDegrees: query.orientationToleranceDegrees,
          },
        ));
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export default createLayoutBenchmarkRouter();
