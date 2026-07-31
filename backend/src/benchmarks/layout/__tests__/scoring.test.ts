import { describe, expect, it } from 'vitest';
import {
  buildScorecard,
  effectiveLineTolerancePx,
  matchGeometry,
} from '../scoring.js';
import { preparedRastersMatch } from '../raster-fingerprint.js';
import type {
  LayoutAnnotation,
  LayoutEvaluation,
  LayoutRunManifest,
} from '../schemas.js';
import type { CohortPageRecord, LayoutBenchmarkStore } from '../store.js';
import {
  makeAnnotationUpdate,
  makeCohort,
  makeLayout,
  makeRun,
  PAGE_KEY,
} from './test-fixtures.js';

function rectangle(id: string, y: number, height = 10) {
  return {
    id,
    boundary: [
      { x: 0, y },
      { x: 100, y },
      { x: 100, y: y + height },
      { x: 0, y: y + height },
    ],
    baseline: [
      { x: 0, y: y + height - 2 },
      { x: 100, y: y + height - 2 },
    ],
  };
}

function annotation(): LayoutAnnotation {
  const update = makeAnnotationUpdate();
  return {
    schemaVersion: 1,
    cohortId: 'test-cohort',
    pageKey: PAGE_KEY,
    ...update,
    audit: {
      createdAt: '2026-07-28T12:00:00.000Z',
      createdBy: 'reviewer-1',
      updatedAt: '2026-07-28T12:00:00.000Z',
      updatedBy: 'reviewer-1',
    },
  };
}

function evaluation(): LayoutEvaluation {
  return {
    schemaVersion: 1,
    cohortId: 'test-cohort',
    reviewerId: 'reviewer-1',
    createdAt: '2026-07-28T12:00:00.000Z',
    updatedAt: '2026-07-28T12:01:00.000Z',
    decisions: [{
      pageKey: PAGE_KEY,
      comparisonKey: 'run-a__run-b',
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preference: 'left',
      assessments: {
        left: {
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
        right: {
          flags: ['missed_line'],
          repairs: {
            missedLinesAdded: 1,
            falseLinesRemoved: 0,
            splitLinesJoined: 0,
            mergedLinesSplit: 0,
            orientationCorrections: 0,
            readingOrderCorrections: 0,
            regionCorrections: 0,
            other: 0,
            total: 1,
          },
        },
      },
      elapsedMs: 12_000,
      confidence: 4,
      reviewedAt: '2026-07-28T12:00:00.000Z',
      updatedAt: '2026-07-28T12:01:00.000Z',
    }],
  };
}

function pageRecord(): CohortPageRecord {
  const cohort = makeCohort();
  return {
    ...cohort.letters[0].pages[0],
    ...cohort.letters[0].identity,
    pageKey: PAGE_KEY,
    letterKey: '001-18881103-L01',
  };
}

function preparedRasterMethods(
  getRun: (runId: string) => LayoutRunManifest,
) {
  const preparedFor = (runId: string, pageKey: string) => (
    getRun(runId).pages.find((page) => page.pageKey === pageKey)?.prepared
  );
  return {
    getPreparedRasterFingerprint: async (runId: string, pageKey: string) => {
      const fingerprint = preparedFor(runId, pageKey)?.rasterFingerprint;
      if (!fingerprint) throw new Error('Test run has no raster fingerprint');
      return fingerprint;
    },
    preparedRunPagesMatch: async (
      leftRunId: string,
      rightRunId: string,
      pageKey: string,
    ) => preparedRastersMatch(
      preparedFor(leftRunId, pageKey),
      preparedFor(rightRunId, pageKey),
    ),
  };
}

describe('layout benchmark scoring', () => {
  it('scales the matching tolerance consistently across prepared resolutions', () => {
    expect(effectiveLineTolerancePx(20, 1_200, 1_600)).toBe(20);
    expect(effectiveLineTolerancePx(20, 3_000, 4_000)).toBe(50);
    expect(effectiveLineTolerancePx(20, 600, 800)).toBe(10);
  });

  it('performs one-to-one tolerant matching and exposes split topology', () => {
    const truth = [rectangle('truth', 10)];
    const splitPredictions = [
      rectangle('top-half', 9, 5),
      rectangle('bottom-half', 15, 5),
    ];

    const result = matchGeometry(truth, splitPredictions, 10, 0.3);

    expect(result.matches).toHaveLength(1);
    expect(result.rightOnly).toHaveLength(1);
    expect(result.split).toBe(1);
    expect(result.merge).toBe(0);
  });

  it('does not label nearby identical lines as split or merge topology', () => {
    const lines = [
      rectangle('line-1', 10, 20),
      rectangle('line-2', 35, 20),
    ];

    const result = matchGeometry(lines, lines, 20, 0.1);

    expect(result.matches).toHaveLength(2);
    expect(result.leftOnly).toHaveLength(0);
    expect(result.rightOnly).toHaveLength(0);
    expect(result.split).toBe(0);
    expect(result.merge).toBe(0);
  });

  it('reports accuracy, proxy agreement, runtime, reviewer timing, and repairs', async () => {
    const runA = makeRun('run-a', 'engine-a');
    const runB = makeRun('run-b', 'engine-b');
    const layoutA = makeLayout('run-a', 'engine-a');
    const layoutB = makeLayout('run-b', 'engine-b');
    layoutB.lines = [layoutB.lines[0]];
    layoutB.regions[0].lineIds = ['l1'];
    runB.pages[0].counts.lines = 1;
    const layouts = new Map([
      ['run-a', layoutA],
      ['run-b', layoutB],
    ]);
    const runs = new Map([
      ['run-a', runA],
      ['run-b', runB],
    ]);
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => evaluation(),
      getRun: async (runId: string) => runs.get(runId)!,
      ...preparedRasterMethods((runId) => runs.get(runId)!),
      getAnnotation: async () => annotation(),
      getNormalizedLayout: async (runId: string) => layouts.get(runId)!,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a', 'run-b'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.runs[0].accuracy.line).toMatchObject({
      tp: 2,
      fp: 0,
      fn: 0,
      f1: 1,
    });
    expect(scorecard.runs[0].accuracy.region).toMatchObject({
      tp: 1,
      fp: 0,
      fn: 0,
      f1: 1,
      classEvaluated: 1,
      classMatches: 1,
      classMismatches: 0,
      classAgreement: 1,
    });
    expect(scorecard.runs[0].accuracy.pageBoundary).toEqual({
      method: 'rasterized-polygon-iou',
      rasterLongEdgePx: 256,
      evaluatedPages: 1,
      unavailablePages: 0,
      meanIoU: 1,
    });
    expect(scorecard.runs[0].accuracy.pages[0]).toMatchObject({
      region: { tp: 1, fp: 0, fn: 0, f1: 1, classAgreement: 1 },
      pageBoundary: { available: true, iou: 1, reason: null },
    });
    expect(scorecard.runs[0].accuracy.orientation).toEqual({
      evaluated: 2,
      correct: 2,
      accuracy: 1,
    });
    expect(scorecard.runs[0].accuracy.readingOrder).toEqual({
      evaluatedPairs: 1,
      correctPairs: 1,
      accuracy: 1,
    });
    expect(scorecard.runs[1].accuracy.line).toMatchObject({
      tp: 1,
      fn: 1,
    });
    expect(scorecard.pairwise[0]).toMatchObject({
      metricKind: 'proxy_agreement_not_accuracy',
      aggregate: {
        comparablePages: 1,
        incomparablePages: 0,
        lines: { matched: 1, leftOnly: 1, rightOnly: 0 },
        regions: {
          matched: 1,
          classEvaluated: 1,
          classMatches: 1,
          classMismatches: 0,
          classAgreement: 1,
        },
        pageBoundary: {
          evaluatedPages: 1,
          unavailablePages: 0,
          meanIoU: 1,
        },
      },
    });
    expect(scorecard.pairwise[0].pages[0]).toMatchObject({
      pageBoundary: {
        available: true,
        leftAvailable: true,
        rightAvailable: true,
        iou: 1,
        reason: null,
      },
      regions: {
        classEvaluated: 1,
        classMatches: 1,
        classMismatches: 0,
        classAgreement: 1,
      },
    });
    expect(scorecard.human).toMatchObject({
      reviewedPages: 1,
      preferences: { left: 1 },
      byRun: [
        { runId: 'run-a', repairs: { total: 0 } },
        { runId: 'run-b', repairs: { missedLinesAdded: 1, total: 1 } },
      ],
      timing: { count: 1, medianMs: 12_000, p95Ms: 12_000 },
    });
    expect(scorecard.runs[0].runtime).toMatchObject({
      selected: 1,
      succeeded: 1,
      pageDuration: { medianMs: 1_000, p95Ms: 1_000 },
    });
  });

  it('treats reversed baseline directions as the same physical orientation', async () => {
    const run = makeRun('run-a', 'engine-a');
    const layout = makeLayout('run-a', 'engine-a');
    const groundTruth = annotation();
    layout.lines[0].orientationDegrees = 90;
    groundTruth.lines[0].orientationDegrees = -90;

    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async () => run,
      ...preparedRasterMethods(() => run),
      getAnnotation: async () => groundTruth,
      getNormalizedLayout: async () => layout,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.runs[0].accuracy.orientation).toEqual({
      evaluated: 2,
      correct: 2,
      accuracy: 1,
    });
  });

  it('excludes PAGE_BOUNDARY_UNAVAILABLE frame fallbacks from boundary accuracy and agreement', async () => {
    const runA = makeRun('run-a', 'engine-a');
    const runB = makeRun('run-b', 'engine-b');
    const layoutA = makeLayout('run-a', 'engine-a');
    const layoutB = makeLayout('run-b', 'engine-b');
    layoutA.warnings.push({
      code: 'PAGE_BOUNDARY_UNAVAILABLE',
      message: 'Provider supplied no page boundary; image frame used.',
    });
    const runs = new Map([['run-a', runA], ['run-b', runB]]);
    const layouts = new Map([['run-a', layoutA], ['run-b', layoutB]]);
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async (runId: string) => runs.get(runId)!,
      ...preparedRasterMethods((runId) => runs.get(runId)!),
      getAnnotation: async () => annotation(),
      getNormalizedLayout: async (runId: string) => layouts.get(runId)!,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a', 'run-b'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.runs[0].accuracy.pageBoundary).toMatchObject({
      evaluatedPages: 0,
      unavailablePages: 1,
      meanIoU: null,
    });
    expect(scorecard.runs[0].accuracy.pages[0]).toMatchObject({
      pageBoundary: {
        available: false,
        iou: null,
        reason: 'provider_boundary_unavailable',
      },
    });
    expect(scorecard.runs[1].accuracy.pageBoundary).toMatchObject({
      evaluatedPages: 1,
      unavailablePages: 0,
      meanIoU: 1,
    });
    expect(scorecard.pairwise[0].aggregate.pageBoundary).toMatchObject({
      evaluatedPages: 0,
      unavailablePages: 1,
      meanIoU: null,
    });
    expect(scorecard.pairwise[0].pages[0]).toMatchObject({
      comparable: true,
      pageBoundary: {
        available: false,
        leftAvailable: false,
        rightAvailable: true,
        iou: null,
        reason: 'left_provider_boundary_unavailable',
      },
    });
  });

  it('scores ordinary region geometry separately from matched-region classes', async () => {
    const runA = makeRun('run-a', 'engine-a');
    const runB = makeRun('run-b', 'engine-b');
    const layoutA = makeLayout('run-a', 'engine-a');
    const layoutB = makeLayout('run-b', 'engine-b');
    layoutB.regions[0].class = 'marginalia';
    layoutB.regions.push({
      ...layoutB.regions[0],
      id: 'spurious-region',
      class: 'illustration',
      boundary: [
        { x: 5, y: 120 },
        { x: 95, y: 120 },
        { x: 95, y: 180 },
        { x: 5, y: 180 },
      ],
      lineIds: [],
    });
    layoutB.pageBoundary = [
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 50, y: 200 },
    ];
    const runs = new Map([['run-a', runA], ['run-b', runB]]);
    const layouts = new Map([['run-a', layoutA], ['run-b', layoutB]]);
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async (runId: string) => runs.get(runId)!,
      ...preparedRasterMethods((runId) => runs.get(runId)!),
      getAnnotation: async () => annotation(),
      getNormalizedLayout: async (runId: string) => layouts.get(runId)!,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a', 'run-b'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.runs[0].accuracy.region).toMatchObject({
      tp: 1,
      fp: 0,
      fn: 0,
      f1: 1,
      classMatches: 1,
      classMismatches: 0,
      classAgreement: 1,
    });
    expect(scorecard.runs[1].accuracy.region).toMatchObject({
      tp: 1,
      fp: 1,
      fn: 0,
      precision: 0.5,
      recall: 1,
      f1: 0.666667,
      classMatches: 0,
      classMismatches: 1,
      classAgreement: 0,
    });
    expect(scorecard.runs[1].accuracy.pageBoundary).toMatchObject({
      evaluatedPages: 1,
      unavailablePages: 0,
      meanIoU: 0.5,
    });
    expect(scorecard.pairwise[0].aggregate.regions).toMatchObject({
      matched: 1,
      leftOnly: 0,
      rightOnly: 1,
      agreementF1: 0.666667,
      classMatches: 0,
      classMismatches: 1,
      classAgreement: 0,
    });
    expect(scorecard.pairwise[0].aggregate.pageBoundary).toMatchObject({
      evaluatedPages: 1,
      unavailablePages: 0,
      meanIoU: 0.5,
    });
  });

  it('counts target-class detections contained by a large foreign-page exclusion', async () => {
    const run = makeRun('run-a', 'engine-a');
    const layout = makeLayout('run-a', 'engine-a');
    layout.lines.push({
      ...layout.lines[0],
      id: 'foreign-detection',
      boundary: [
        { x: 20, y: 120 },
        { x: 80, y: 120 },
        { x: 80, y: 130 },
        { x: 20, y: 130 },
      ],
      baseline: [{ x: 20, y: 128 }, { x: 80, y: 128 }],
      regionId: null,
      readingOrder: null,
    });
    layout.regions.push({
      ...layout.regions[0],
      id: 'predicted-foreign-region',
      class: 'foreign_page',
      boundary: [
        { x: 10, y: 110 },
        { x: 90, y: 110 },
        { x: 90, y: 150 },
        { x: 10, y: 150 },
      ],
      readingOrder: null,
      lineIds: ['foreign-by-parent'],
    });
    layout.lines.push({
      ...layout.lines[0],
      id: 'foreign-by-parent',
      class: 'text',
      boundary: [
        { x: 20, y: 135 },
        { x: 80, y: 135 },
        { x: 80, y: 145 },
        { x: 20, y: 145 },
      ],
      baseline: [{ x: 20, y: 143 }, { x: 80, y: 143 }],
      regionId: 'predicted-foreign-region',
      readingOrder: null,
    });
    layout.regions.push({
      ...layout.regions[0],
      id: 'false-foreign-region',
      class: 'foreign_page',
      boundary: [
        { x: 10, y: 60 },
        { x: 90, y: 60 },
        { x: 90, y: 90 },
        { x: 10, y: 90 },
      ],
      readingOrder: null,
      lineIds: ['false-exclusion'],
    });
    layout.lines.push({
      ...layout.lines[0],
      id: 'false-exclusion',
      class: 'text',
      boundary: [
        { x: 20, y: 70 },
        { x: 80, y: 70 },
        { x: 80, y: 80 },
        { x: 20, y: 80 },
      ],
      baseline: [{ x: 20, y: 78 }, { x: 80, y: 78 }],
      regionId: 'false-foreign-region',
      readingOrder: null,
    });
    run.pages[0].counts.lines = 5;
    run.pages[0].counts.regions = 3;
    const groundTruth = annotation();
    groundTruth.regions.push({
      id: 'foreign-page',
      class: 'foreign_page',
      boundary: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 0, y: 200 },
      ],
      orientationDegrees: 0,
      readingOrder: null,
      lineIds: [],
    });
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async () => run,
      ...preparedRasterMethods(() => run),
      getAnnotation: async () => groundTruth,
      getNormalizedLayout: async () => layout,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.runs[0].accuracy.line.fp).toBe(1);
    expect(scorecard.runs[0].accuracy.foreignPage).toMatchObject({
      exclusionRegions: 1,
      targetFalsePositives: 1,
      correctlyClassifiedLines: 1,
      falseExcludedTargetLines: 1,
      correctlyClassifiedRegions: 1,
      falseExcludedRegions: 1,
    });
  });

  it('uses polygon overlap for skewed foreign-page exclusions instead of AABB overlap', async () => {
    const run = makeRun('run-a', 'engine-a');
    const layout = makeLayout('run-a', 'engine-a');
    layout.lines.push(
      {
        ...layout.lines[0],
        id: 'inside-exclusion-polygon',
        boundary: [
          { x: 10, y: 120 },
          { x: 30, y: 120 },
          { x: 30, y: 140 },
          { x: 10, y: 140 },
        ],
        baseline: [{ x: 10, y: 138 }, { x: 30, y: 138 }],
        regionId: null,
        readingOrder: null,
      },
      {
        ...layout.lines[0],
        id: 'outside-exclusion-polygon',
        boundary: [
          { x: 70, y: 170 },
          { x: 90, y: 170 },
          { x: 90, y: 190 },
          { x: 70, y: 190 },
        ],
        baseline: [{ x: 70, y: 188 }, { x: 90, y: 188 }],
        regionId: null,
        readingOrder: null,
      },
    );
    run.pages[0].counts.lines = 4;
    const groundTruth = annotation();
    groundTruth.regions.push({
      id: 'skewed-foreign-page',
      class: 'foreign_page',
      boundary: [
        { x: 0, y: 100 },
        { x: 100, y: 100 },
        { x: 0, y: 200 },
      ],
      orientationDegrees: 0,
      readingOrder: null,
      lineIds: [],
    });
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async () => run,
      ...preparedRasterMethods(() => run),
      getAnnotation: async () => groundTruth,
      getNormalizedLayout: async () => layout,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    // Both candidates are fully inside the exclusion's axis-aligned bounding
    // box. Only the first is inside the actual triangular page polygon.
    expect(scorecard.runs[0].accuracy.foreignPage).toMatchObject({
      exclusionRegions: 1,
      targetFalsePositives: 1,
    });
  });

  it('samples narrow foreign-page candidates in local space on full-resolution scans', async () => {
    const run = makeRun('run-a', 'engine-a', {
      preparedWidth: 3_000,
      preparedHeight: 4_000,
    });
    const layout = makeLayout('run-a', 'engine-a');
    layout.image.width = 3_000;
    layout.image.height = 4_000;
    layout.pageBoundary = [
      { x: 0, y: 0 },
      { x: 3_000, y: 0 },
      { x: 3_000, y: 4_000 },
      { x: 0, y: 4_000 },
    ];
    layout.lines.push({
      ...layout.lines[0],
      id: 'two-pixel-high-candidate',
      boundary: [
        { x: 100, y: 110 },
        { x: 2_500, y: 110 },
        { x: 2_500, y: 112 },
        { x: 100, y: 112 },
      ],
      baseline: [{ x: 100, y: 111 }, { x: 2_500, y: 111 }],
      regionId: null,
      readingOrder: null,
    });
    run.pages[0].counts.lines = 3;
    const groundTruth = annotation();
    groundTruth.image.width = 3_000;
    groundTruth.image.height = 4_000;
    groundTruth.pageBoundary = structuredClone(layout.pageBoundary);
    groundTruth.regions.push({
      id: 'narrow-foreign-page',
      class: 'foreign_page',
      boundary: [
        { x: 0, y: 100 },
        { x: 3_000, y: 100 },
        { x: 3_000, y: 130 },
        { x: 0, y: 130 },
      ],
      orientationDegrees: 0,
      readingOrder: null,
      lineIds: [],
    });
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async () => run,
      ...preparedRasterMethods(() => run),
      getAnnotation: async () => groundTruth,
      getNormalizedLayout: async () => layout,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    // A page-wide 256px raster has ~15.6px cells here and can entirely miss
    // this 2px-high polygon. Candidate-local sampling must still classify it.
    expect(scorecard.runs[0].accuracy.foreignPage).toMatchObject({
      exclusionRegions: 1,
      targetFalsePositives: 1,
    });
  });

  it('makes coverage unavailable for baseline-derived line envelopes', async () => {
    const markDerivedByWarning = (layout: ReturnType<typeof makeLayout>) => {
      layout.warnings.push({
        code: 'LINE_BOUNDARY_DERIVED_FROM_BASELINE',
        message: 'Display corridors were derived from provider baselines.',
      });
    };
    const markDerivedByProvenance = (layout: ReturnType<typeof makeLayout>) => {
      layout.lines[0].provenance = {
        ...layout.lines[0].provenance,
        attributes: {
          ...layout.lines[0].provenance.attributes,
          boundarySource: 'baseline-envelope',
        },
      };
    };

    for (const markDerived of [markDerivedByWarning, markDerivedByProvenance]) {
      const runA = makeRun('run-a', 'engine-a');
      const runB = makeRun('run-b', 'engine-b');
      const layoutA = makeLayout('run-a', 'engine-a');
      const layoutB = makeLayout('run-b', 'engine-b');
      markDerived(layoutA);
      const runs = new Map([['run-a', runA], ['run-b', runB]]);
      const layouts = new Map([['run-a', layoutA], ['run-b', layoutB]]);
      const fakeStore = {
        loadCohort: async () => makeCohort(),
        listCohortPages: async () => [pageRecord()],
        getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
        getRun: async (runId: string) => runs.get(runId)!,
        ...preparedRasterMethods((runId) => runs.get(runId)!),
        getAnnotation: async () => null,
        getNormalizedLayout: async (runId: string) => layouts.get(runId)!,
      } as unknown as LayoutBenchmarkStore;

      const scorecard = await buildScorecard(
        fakeStore,
        ['run-a', 'run-b'],
        'reviewer-1',
        {
          lineTolerancePx: 10,
          lineIouThreshold: 0.3,
          orientationToleranceDegrees: 10,
        },
      );

      expect(scorecard.pairwise[0].pages[0]).toMatchObject({
        comparable: true,
        coverage: {
          available: false,
          leftAvailable: false,
          rightAvailable: true,
          leftFraction: null,
          rightFraction: null,
          signedDelta: null,
          absoluteDelta: null,
          reason: 'left_line_boundaries_derived_from_baselines',
        },
      });
      expect(scorecard.pairwise[0].aggregate).toMatchObject({
        coverageAvailablePages: 0,
        coverageUnavailablePages: 1,
        coverageUnavailableReasons: {
          left_line_boundaries_derived_from_baselines: 1,
        },
        coverageAbsoluteDeltaTotal: 0,
        meanCoverageAbsoluteDelta: null,
      });
    }
  });

  it('canonicalizes reversed A/B decisions and counts each left/right win exactly once', async () => {
    const runA = makeRun('run-a', 'engine-a');
    const runB = makeRun('run-b', 'engine-b');
    const secondPageKey = '001-18881103-L01-02';
    runA.pages.push({
      ...structuredClone(runA.pages[0]),
      pageKey: secondPageKey,
    });
    runB.pages.push({
      ...structuredClone(runB.pages[0]),
      pageKey: secondPageKey,
    });
    const baseEvaluation = evaluation();
    const first = baseEvaluation.decisions[0];
    const reversed = {
      ...first,
      pageKey: secondPageKey,
      leftRunId: 'run-b',
      rightRunId: 'run-a',
      preference: 'left' as const,
      assessments: {
        left: first.assessments.right,
        right: first.assessments.left,
      },
    };
    const runs = new Map([['run-a', runA], ['run-b', runB]]);
    const layouts = new Map([
      ['run-a', makeLayout('run-a', 'engine-a')],
      ['run-b', makeLayout('run-b', 'engine-b')],
    ]);
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [
        pageRecord(),
        {
          ...pageRecord(),
          pageKey: secondPageKey,
          pageNumber: 2,
          originalFilename: '001-18881103-L01-02.jpg',
        },
      ],
      getEvaluation: async () => ({
        ...baseEvaluation,
        decisions: [first, reversed],
      }),
      getRun: async (runId: string) => runs.get(runId)!,
      ...preparedRasterMethods((runId) => runs.get(runId)!),
      getAnnotation: async () => null,
      getNormalizedLayout: async (runId: string) => layouts.get(runId)!,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a', 'run-b'],
      'reviewer-1',
      {
        lineTolerancePx: 20,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.human.preferences).toMatchObject({ left: 1, right: 1 });
    expect(scorecard.human.runWins).toEqual({ 'run-a': 1, 'run-b': 1 });
    expect(scorecard.human.byComparison[0]).toMatchObject({
      leftRunId: 'run-a',
      rightRunId: 'run-b',
      preferences: { left: 1, right: 1 },
      runWins: { 'run-a': 1, 'run-b': 1 },
    });
    expect(scorecard.human.byRun).toEqual([
      expect.objectContaining({ runId: 'run-a', repairs: expect.objectContaining({ total: 0 }) }),
      expect.objectContaining({ runId: 'run-b', repairs: expect.objectContaining({ total: 2 }) }),
    ]);
  });

  it('marks decoded-raster-mismatched provider pages incomparable instead of scoring them', async () => {
    const runA = makeRun('run-a', 'engine-a');
    const runB = makeRun('run-b', 'engine-b', {
      preparedSha: '9'.repeat(64),
      rasterSha: '8'.repeat(64),
    });
    const runs = new Map([
      ['run-a', runA],
      ['run-b', runB],
    ]);
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async (runId: string) => runs.get(runId)!,
      ...preparedRasterMethods((runId) => runs.get(runId)!),
      getAnnotation: async () => null,
      getNormalizedLayout: async () => {
        throw new Error('must not read misaligned layouts');
      },
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a', 'run-b'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.pairwise[0].aggregate).toMatchObject({
      comparablePages: 0,
      incomparablePages: 1,
      reasons: { prepared_raster_or_dimensions_mismatch: 1 },
    });
    expect(scorecard.pairwise[0].pages[0]).toEqual({
      pageKey: PAGE_KEY,
      comparable: false,
      reason: 'prepared_raster_or_dimensions_mismatch',
    });
  });

  it('rejects preprocessing-profile mismatches and quarantines their saved decisions', async () => {
    const runA = makeRun('run-a', 'engine-a');
    const runB = makeRun('run-b', 'engine-b');
    runB.preprocessing.profileSha256 = '0'.repeat(64);
    const runs = new Map([
      ['run-a', runA],
      ['run-b', runB],
    ]);
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => evaluation(),
      getRun: async (runId: string) => runs.get(runId)!,
      ...preparedRasterMethods((runId) => runs.get(runId)!),
      getAnnotation: async () => null,
      getNormalizedLayout: async () => {
        throw new Error('must not read layouts prepared under different profiles');
      },
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a', 'run-b'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.pairwise[0].aggregate).toMatchObject({
      comparablePages: 0,
      incomparablePages: 1,
      reasons: { preprocessing_profile_mismatch: 1 },
    });
    expect(scorecard.pairwise[0].pages[0]).toEqual({
      pageKey: PAGE_KEY,
      comparable: false,
      reason: 'preprocessing_profile_mismatch',
    });
    expect(scorecard.human).toMatchObject({
      decisionCount: 0,
      excludedDecisionCount: 1,
      excludedReasons: { preprocessing_profile_mismatch: 1 },
    });
  });

  it('reports empty-versus-empty layouts as unavailable evidence instead of perfect agreement', async () => {
    const runA = makeRun('run-a', 'engine-a');
    const runB = makeRun('run-b', 'engine-b');
    runA.pages[0].counts = { lines: 0, regions: 0 };
    runB.pages[0].counts = { lines: 0, regions: 0 };
    const layoutA = makeLayout('run-a', 'engine-a');
    const layoutB = makeLayout('run-b', 'engine-b');
    layoutA.lines = [];
    layoutA.regions = [];
    layoutB.lines = [];
    layoutB.regions = [];
    const runs = new Map([
      ['run-a', runA],
      ['run-b', runB],
    ]);
    const layouts = new Map([
      ['run-a', layoutA],
      ['run-b', layoutB],
    ]);
    const fakeStore = {
      loadCohort: async () => makeCohort(),
      listCohortPages: async () => [pageRecord()],
      getEvaluation: async () => ({ ...evaluation(), decisions: [] }),
      getRun: async (runId: string) => runs.get(runId)!,
      ...preparedRasterMethods((runId) => runs.get(runId)!),
      getAnnotation: async () => null,
      getNormalizedLayout: async (runId: string) => layouts.get(runId)!,
    } as unknown as LayoutBenchmarkStore;

    const scorecard = await buildScorecard(
      fakeStore,
      ['run-a', 'run-b'],
      'reviewer-1',
      {
        lineTolerancePx: 10,
        lineIouThreshold: 0.3,
        orientationToleranceDegrees: 10,
      },
    );

    expect(scorecard.pairwise[0].pages[0]).toMatchObject({
      comparable: true,
      lines: { agreementF1: null },
      regions: { agreementF1: null },
    });
    expect(scorecard.pairwise[0].aggregate).toMatchObject({
      lines: { agreementF1: null },
      regions: { agreementF1: null },
    });
  });
});
