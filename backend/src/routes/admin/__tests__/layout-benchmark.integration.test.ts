import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Router } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCohort, makeRun, PAGE_KEY } from '../../../benchmarks/layout/__tests__/test-fixtures.js';
import type { LayoutEvaluation } from '../../../benchmarks/layout/schemas.js';
import type { CohortPageRecord, LayoutBenchmarkStore } from '../../../benchmarks/layout/store.js';
import { invokeRouter } from '../../../test/express-test-utils.js';
import { createLayoutBenchmarkImageRouter } from '../layout-benchmark-images.js';
import { createLayoutBenchmarkRouter } from '../layout-benchmark.js';

function pageRecord(): CohortPageRecord {
  const cohort = makeCohort();
  return {
    ...cohort.letters[0].pages[0],
    ...cohort.letters[0].identity,
    pageKey: PAGE_KEY,
    letterKey: '001-18881103-L01',
  };
}

function emptyEvaluation(): LayoutEvaluation {
  return {
    schemaVersion: 1,
    cohortId: 'test-cohort',
    reviewerId: 'reviewer-1',
    createdAt: '2026-07-28T12:00:00.000Z',
    updatedAt: '2026-07-28T12:00:00.000Z',
    decisions: [],
  };
}

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

describe('layout benchmark admin routes', () => {
  let temporaryDirectory: string | null = null;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = null;
    }
  });

  it('is hidden when the production feature gate is not explicitly enabled', async () => {
    const router = createLayoutBenchmarkRouter({
      enabled: () => false,
      store: {} as LayoutBenchmarkStore,
    });

    const response = await invokeRouter(router, { method: 'GET', url: '/' });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ error: 'Not found' });
  });

  it('derives reviewer identity from auth and returns measurable overview progress', async () => {
    const getEvaluation = vi.fn(async () => emptyEvaluation());
    const store = {
      loadCohort: async () => makeCohort(),
      listRuns: async () => ({ runs: [makeRun()], invalidRuns: [] }),
      getEvaluation,
      evaluationProgress: async () => ({
        totalPages: 1,
        reviewedPages: 0,
        decisionCount: 0,
        percent: 0,
        comparisons: [],
      }),
    } as unknown as LayoutBenchmarkStore;
    const router = authenticated(createLayoutBenchmarkRouter({
      store,
      enabled: () => true,
    }));

    const response = await invokeRouter(router, { method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(getEvaluation).toHaveBeenCalledWith('reviewer-1');
    expect(response.body).toMatchObject({
      cohort: { pageCount: 1, letterCount: 1 },
      runs: { valid: 1, invalid: 0 },
      reviewer: {
        id: 'reviewer-1',
        displayEmail: 'reviewer@example.test',
        reviewedPages: 0,
        totalPages: 1,
      },
      capabilities: { runArtifactsReadOnly: true },
    });
  });

  it('returns stable page fields and cookie-authenticated aligned image URLs', async () => {
    const run = makeRun();
    const artifactPrefix = `pages/${PAGE_KEY}`;
    run.pages[0].artifacts.pageMask = `${artifactPrefix}/page-mask.png`;
    run.pages[0].artifacts.engineInput = `${artifactPrefix}/engine-input.png`;
    run.pages[0].artifacts.inputStage = `${artifactPrefix}/input-stage.v1.json`;
    const store = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      listRuns: async () => ({ runs: [run], invalidRuns: [] }),
      getAnnotation: async () => null,
    } as unknown as LayoutBenchmarkStore;
    const router = authenticated(createLayoutBenchmarkRouter({
      store,
      enabled: () => true,
    }));

    const response = await invokeRouter(router, { method: 'GET', url: '/pages' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      total: 1,
      filteredTotal: 1,
      pages: [{
        pageKey: PAGE_KEY,
        letterKey: '001-18881103-L01',
        pageNumber: 1,
        originalFilename: '001-18881103-L01-01.jpg',
        groundTruthStatus: 'unannotated',
        source: {
          coordinateSpace: 'encoded-source-pixels',
          url: `/images/layout-benchmark/pages/${PAGE_KEY}/source`,
        },
        runs: [{
          runId: 'run-a',
          status: 'succeeded',
          prepared: {
            url: `/images/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/prepared`,
          },
          overlayUrl: `/images/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/overlay`,
          pageMaskUrl: `/images/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/pageMask`,
          engineInputUrl: `/images/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/engineInput`,
          inputStageUrl: `/admin/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/artifacts/inputStage`,
        }],
      }],
    });
  });

  it('includes page-mask evidence URLs in run-detail page links', async () => {
    const run = makeRun();
    const artifactPrefix = `pages/${PAGE_KEY}`;
    run.pages[0].artifacts.pageMask = `${artifactPrefix}/page-mask.png`;
    run.pages[0].artifacts.engineInput = `${artifactPrefix}/engine-input.png`;
    run.pages[0].artifacts.inputStage = `${artifactPrefix}/input-stage.v1.json`;
    const router = authenticated(createLayoutBenchmarkRouter({
      store: {
        getRun: async () => run,
      } as unknown as LayoutBenchmarkStore,
      enabled: () => true,
    }));

    const response = await invokeRouter(router, {
      method: 'GET',
      url: '/runs/run-a',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      links: {
        pages: [{
          pageKey: PAGE_KEY,
          pageMaskUrl: `/images/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/pageMask`,
          engineInputUrl: `/images/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/engineInput`,
          inputStageUrl: `/admin/layout-benchmark/runs/run-a/pages/${PAGE_KEY}/artifacts/inputStage`,
        }],
      },
    });
  });

  it('surfaces sanitized diagnostic profile metadata in run summaries', async () => {
    const diagnosticRun = makeRun('diagnostic-run', 'kraken7');
    diagnosticRun.engine.configuration.values.diagnostic = {
      equivalentToDefaultProfile: false,
      comparisonProfile: 'kraken7-orli-cpu',
      purpose: 'Line-cap smoke validation',
      capReachedIsQualityFailure: true,
      internalOnlyValue: 'not exposed',
    };
    const store = {
      listRuns: async () => ({ runs: [diagnosticRun], invalidRuns: [] }),
    } as unknown as LayoutBenchmarkStore;
    const router = authenticated(createLayoutBenchmarkRouter({
      store,
      enabled: () => true,
    }));

    const response = await invokeRouter(router, { method: 'GET', url: '/runs' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      runs: [{
        runId: 'diagnostic-run',
        diagnostic: {
          equivalentToDefaultProfile: false,
          comparisonProfile: 'kraken7-orli-cpu',
          purpose: 'Line-cap smoke validation',
          capReachedIsQualityFailure: true,
        },
      }],
    });
    expect(JSON.stringify(response.body)).not.toContain('internalOnlyValue');
  });

  it('uses a diagnostic reason as the plain-purpose fallback in run summaries', async () => {
    const diagnosticRun = makeRun('reason-only-diagnostic', 'kraken7');
    diagnosticRun.engine.configuration.values.diagnostic = {
      equivalentToDefaultProfile: false,
      reason: 'Tests page isolation plus sideways-line recovery.',
      internalOnlyValue: 'not exposed',
    };
    const store = {
      listRuns: async () => ({ runs: [diagnosticRun], invalidRuns: [] }),
    } as unknown as LayoutBenchmarkStore;
    const router = authenticated(createLayoutBenchmarkRouter({
      store,
      enabled: () => true,
    }));

    const response = await invokeRouter(router, { method: 'GET', url: '/runs' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      runs: [{
        runId: 'reason-only-diagnostic',
        diagnostic: {
          equivalentToDefaultProfile: false,
          purpose: 'Tests page isolation plus sideways-line recovery.',
        },
      }],
    });
    expect(JSON.stringify(response.body)).not.toContain('internalOnlyValue');
  });

  it('does not group identical prepared bytes across different preprocessing profiles', async () => {
    const leftRun = makeRun('run-a', 'engine-a');
    const rightRun = makeRun('run-b', 'engine-b');
    rightRun.preprocessing.profileSha256 = '0'.repeat(64);
    const store = {
      getCohortPage: async () => pageRecord(),
      listRuns: async () => ({ runs: [leftRun, rightRun], invalidRuns: [] }),
      getAnnotation: async () => null,
      getPreparedRasterFingerprint: async (runId: string) => {
        const run = runId === leftRun.runId ? leftRun : rightRun;
        return run.pages[0].prepared!.rasterFingerprint!;
      },
    } as unknown as LayoutBenchmarkStore;
    const router = authenticated(createLayoutBenchmarkRouter({
      store,
      enabled: () => true,
    }));

    const response = await invokeRouter(router, {
      method: 'GET',
      url: `/pages/${PAGE_KEY}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as {
      comparisonGroups: unknown[];
      incomparableRuns: Array<{ runId: string; reason: string }>;
    };
    expect(body.comparisonGroups).toHaveLength(2);
    expect(body.incomparableRuns).toEqual([
      { runId: 'run-a', reason: 'preprocessing_profile_mismatch' },
      { runId: 'run-b', reason: 'preprocessing_profile_mismatch' },
    ]);
  });

  it('rejects unmeasurable repair payloads before writing evaluation state', async () => {
    const createDecision = vi.fn();
    const router = authenticated(createLayoutBenchmarkRouter({
      enabled: () => true,
      store: { createEvaluationDecision: createDecision } as unknown as LayoutBenchmarkStore,
    }));

    const response = await invokeRouter(router, {
      method: 'PUT',
      url: `/evaluations/me/pages/${PAGE_KEY}`,
      body: {
        leftRunId: 'run-a',
        rightRunId: 'run-b',
        preference: 'left',
        assessments: {
          left: {
            flags: [],
            repairs: {
              missedLinesAdded: 1,
              falseLinesRemoved: 0,
              splitLinesJoined: 0,
              mergedLinesSplit: 0,
              orientationCorrections: 0,
              readingOrderCorrections: 0,
              regionCorrections: 0,
              other: 0,
              total: 0,
            },
          },
          right: {
            flags: [],
            repairs: {
              missedLinesAdded: 0,
              falseLinesRemoved: 0,
              splitLinesJoined: 0,
              mergedLinesSplit: 0,
              orientationCorrections: 0,
              readingOrderCorrections: 0,
              regionCorrections: 0,
              other: 0,
              total: 0,
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(createDecision).not.toHaveBeenCalled();
  });

  it('serves prepared images with private nosniff headers through the image boundary', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'layout-route-image-'));
    const imagePath = join(temporaryDirectory, 'prepared.png');
    await mkdir(temporaryDirectory, { recursive: true });
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const router = createLayoutBenchmarkImageRouter({
      enabled: () => true,
      authorize: (_req, _res, next) => next(),
      store: {
        resolveRunArtifact: async () => ({
          absolutePath: imagePath,
          contentType: 'image/png',
          sizeBytes: 4,
          filename: 'prepared.png',
        }),
      } as unknown as LayoutBenchmarkStore,
    });

    const response = await invokeRouter(router, {
      method: 'GET',
      url: `/runs/run-a/pages/${PAGE_KEY}/prepared`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-type': 'image/png',
    });
    expect(Buffer.isBuffer(response.body)).toBe(true);
  });

  it.each(['raw.xml', 'raw.json'])(
    'forces provider artifact %s to download as inert text',
    async (filename) => {
      temporaryDirectory = await mkdtemp(join(tmpdir(), 'layout-route-raw-'));
      const artifactPath = join(temporaryDirectory, filename);
      const payload = filename.endsWith('.xml')
        ? '<PcGts><Page/></PcGts>'
        : '{"provider":"test"}';
      await writeFile(artifactPath, payload, 'utf8');
      const resolveRunArtifact = vi.fn(async () => ({
        absolutePath: artifactPath,
        contentType: filename.endsWith('.xml')
          ? 'application/xml; charset=utf-8'
          : 'application/json; charset=utf-8',
        sizeBytes: Buffer.byteLength(payload),
        filename,
      }));
      const router = authenticated(createLayoutBenchmarkRouter({
        enabled: () => true,
        store: {
          resolveRunArtifact,
        } as unknown as LayoutBenchmarkStore,
      }));

      const response = await invokeRouter(router, {
        method: 'GET',
        url: `/runs/run-a/pages/${PAGE_KEY}/artifacts/raw`,
      });

      expect(response.statusCode).toBe(200);
      expect(resolveRunArtifact).toHaveBeenCalledWith(
        'run-a',
        PAGE_KEY,
        'raw',
      );
      expect(response.headers).toMatchObject({
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'content-security-policy': "default-src 'none'; sandbox",
        'content-length': String(Buffer.byteLength(payload)),
      });
      expect(response.body).toEqual(Buffer.from(payload));
    },
  );
});
