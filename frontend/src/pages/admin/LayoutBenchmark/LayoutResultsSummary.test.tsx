// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type {
  LayoutBenchmarkPageSummary,
  LayoutBenchmarkRunSummary,
  LayoutDurationDistribution,
  LayoutEvaluationDecision,
  LayoutEvaluationResponse,
  LayoutPageAgreement,
  LayoutPairwiseScore,
  LayoutRepairCounts,
  LayoutRunScore,
  LayoutScorecardsResponse,
} from '../../../api/admin/layoutBenchmark';
import LayoutResultsSummary from './LayoutResultsSummary';

const RUN_A: LayoutBenchmarkRunSummary = {
  runId: 'kraken6-full-001',
  state: 'completed_with_failures',
  engineId: 'kraken6',
  engineVersion: '6.0.3',
  adapterVersion: '1.0.0',
  preprocessingProfileId: 'layout-benchmark-v1',
  preprocessingProfileSha256: 'f'.repeat(64),
  createdAt: '2026-07-28T01:00:00.000Z',
  completedAt: '2026-07-28T02:00:00.000Z',
  selected: 66,
  succeeded: 64,
  failed: 2,
  durationMs: 660_000,
};

const RUN_B: LayoutBenchmarkRunSummary = {
  runId: 'kraken7-full-001',
  state: 'completed',
  engineId: 'kraken7',
  engineVersion: '7.0.3',
  adapterVersion: '1.0.0',
  preprocessingProfileId: 'layout-benchmark-v1',
  preprocessingProfileSha256: 'f'.repeat(64),
  createdAt: '2026-07-28T02:00:00.000Z',
  completedAt: '2026-07-28T03:00:00.000Z',
  selected: 66,
  succeeded: 66,
  failed: 0,
  durationMs: 600_000,
};

const EMPTY_REPAIRS: LayoutRepairCounts = {
  missedLinesAdded: 0,
  falseLinesRemoved: 0,
  splitLinesJoined: 0,
  mergedLinesSplit: 0,
  orientationCorrections: 0,
  readingOrderCorrections: 0,
  regionCorrections: 0,
  other: 0,
  total: 0,
};

function distribution(
  count: number,
  medianMs: number,
  p95Ms: number,
): LayoutDurationDistribution {
  return {
    count,
    totalMs: medianMs * count,
    medianMs,
    p95Ms,
    minMs: medianMs - 100,
    maxMs: p95Ms,
  };
}

function runScore(
  run: LayoutBenchmarkRunSummary,
  medianMs: number,
  p95Ms: number,
  peakRssBytes: number,
): LayoutRunScore {
  const successful = distribution(run.succeeded, medianMs, p95Ms);
  const failed = distribution(run.failed, 400, 500);
  const stageTiming = (count: number, median: number, p95: number) => ({
    count,
    totalMs: count * median,
    medianMs: count > 0 ? median : null,
    p95Ms: count > 0 ? p95 : null,
  });
  return {
    runId: run.runId,
    engineId: run.engineId,
    state: run.state,
    accuracy: {
      availableGroundTruthPages: 0,
      selectedAnnotatedPages: 0,
      eligiblePages: 0,
      incomparablePages: 0,
      line: {
        tp: 0,
        fp: 0,
        fn: 0,
        precision: null,
        recall: null,
        f1: null,
        missed: 0,
        spurious: 0,
        split: 0,
        merge: 0,
      },
      region: {
        tp: 0,
        fp: 0,
        fn: 0,
        classEvaluated: 0,
        classMatches: 0,
        classMismatches: 0,
        precision: null,
        recall: null,
        f1: null,
        classAgreement: null,
      },
      pageBoundary: {
        method: 'rasterized-polygon-iou',
        rasterLongEdgePx: 256,
        evaluatedPages: 0,
        unavailablePages: 0,
        meanIoU: null,
      },
      orientation: { evaluated: 0, correct: 0, accuracy: null },
      readingOrder: { evaluatedPairs: 0, correctPairs: 0, accuracy: null },
      foreignPage: {
        exclusionRegions: 0,
        targetFalsePositives: 0,
        correctlyClassifiedLines: 0,
        falseExcludedTargetLines: 0,
        correctlyClassifiedRegions: 0,
        falseExcludedRegions: 0,
      },
      pages: [],
    },
    runtime: {
      selected: run.selected,
      succeeded: run.succeeded,
      failed: run.failed,
      failureRate: run.failed / run.selected,
      totalMs: run.durationMs,
      pageDuration: {
        count: successful.count,
        totalMs: successful.totalMs,
        medianMs,
        p95Ms,
        minMs: successful.minMs,
        maxMs: successful.maxMs,
        attempted: distribution(run.selected, medianMs, p95Ms),
        successful,
        failed,
      },
      stageTimings: {
        preparationMs: stageTiming(run.selected, 120, 160),
        engineMs: stageTiming(run.selected, medianMs, p95Ms),
        inputStageMs: stageTiming(0, 0, 0),
        normalizationMs: stageTiming(run.succeeded, 80, 100),
        overlayMs: stageTiming(run.succeeded, 40, 60),
        totalMs: stageTiming(run.selected, medianMs + 240, p95Ms + 320),
        engineUserCpuMs: stageTiming(run.selected, 4_000, 6_000),
        engineSystemCpuMs: stageTiming(run.selected, 500, 700),
        providerModelLoadMs: stageTiming(1, 2_000, 2_000),
        providerInferenceMs: stageTiming(run.succeeded, medianMs - 500, p95Ms - 500),
      },
      memory: {
        measuredPages: run.succeeded,
        peakRssBytes,
        methods: { 'docker-stats': run.succeeded },
        caveat: 'Compare only like-for-like methods.',
      },
      failures: run.failed > 0
        ? [{ stage: 'engine', code: 'PROVIDER_INFERENCE_FAILED', count: run.failed }]
        : [],
      warnings: run.runId === RUN_A.runId ? { ORIENTATION_FALLBACK: 3 } : {},
    },
  };
}

function scorecards(): LayoutScorecardsResponse {
  return {
    schemaVersion: 1,
    cohortId: 'layout-cohort-v1',
    generatedAt: '2026-07-28T04:00:00.000Z',
    parameters: {},
    metadata: { pairwiseMetrics: 'proxy_agreement_not_accuracy' },
    runs: [
      runScore(RUN_A, 10_000, 15_000, 512 * (1024 ** 2)),
      runScore(RUN_B, 8_000, 12_000, 768 * (1024 ** 2)),
    ],
    pairwise: [{
      leftRunId: RUN_A.runId,
      rightRunId: RUN_B.runId,
      metricKind: 'proxy_agreement_not_accuracy',
      pages: [pageAgreement('001-19000101-L01-01', {
        line: [10, 10, 9],
        region: [2, 2, 2],
        regionClass: [2, 2],
        boundaryIou: 0.9,
      })],
      aggregate: {
        comparablePages: 64,
        incomparablePages: 2,
        reasons: { one_or_both_runs_failed: 2 },
        lines: {
          left: 100,
          right: 100,
          matched: 82,
          leftOnly: 18,
          rightOnly: 18,
          agreementF1: 0.82,
        },
        regions: {
          left: 100,
          right: 100,
          matched: 71,
          leftOnly: 29,
          rightOnly: 29,
          agreementF1: 0.71,
          classEvaluated: 60,
          classMatches: 45,
          classMismatches: 15,
          classAgreement: 0.75,
        },
        pageBoundary: {
          method: 'rasterized-polygon-iou',
          rasterLongEdgePx: 256,
          evaluatedPages: 60,
          unavailablePages: 4,
          meanIoU: 0.9,
        },
        coverageAvailablePages: 64,
        coverageUnavailablePages: 0,
        coverageUnavailableReasons: {},
        coverageAbsoluteDeltaTotal: 2.56,
        meanCoverageAbsoluteDelta: 0.04,
      },
    }],
    human: {
      decisionCount: 40,
      reviewedPages: 40,
      preferences: { left: 12, right: 20, tie: 5, neither: 3 },
      runWins: { [RUN_A.runId]: 12, [RUN_B.runId]: 20 },
      byRun: [
        {
          runId: RUN_A.runId,
          assessedPages: 40,
          assessmentCount: 40,
          flags: { missed_line: 8, wrong_orientation: 2 },
          repairs: {
            ...EMPTY_REPAIRS,
            missedLinesAdded: 10,
            orientationCorrections: 2,
            total: 12,
          },
        },
        {
          runId: RUN_B.runId,
          assessedPages: 40,
          assessmentCount: 40,
          flags: { missed_line: 3 },
          repairs: { ...EMPTY_REPAIRS, missedLinesAdded: 4, total: 4 },
        },
      ],
      timing: {
        count: 40,
        totalMs: 2_000_000,
        medianMs: 45_000,
        p95Ms: 90_000,
      },
      confidence: { count: 40, mean: 4.125 },
      excludedDecisionCount: 0,
      excludedReasons: {},
      byComparison: [],
    },
  };
}

function repairs(total: number): LayoutRepairCounts {
  return {
    ...EMPTY_REPAIRS,
    other: total,
    total,
  };
}

function benchmarkPage(
  pageKey: string,
  collectionCode: string,
  challengeTags: string[],
  options: { rightSelected?: boolean; rightFailed?: boolean } = {},
): LayoutBenchmarkPageSummary {
  const prepared = {
    sha256: 'a'.repeat(64),
    width: 1200,
    height: 1600,
    url: `/prepared/${pageKey}.png`,
  };
  const runs: LayoutBenchmarkPageSummary['runs'] = [{
    runId: RUN_A.runId,
    engineId: RUN_A.engineId,
    preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
    status: 'succeeded',
    prepared,
    layoutUrl: `/layout/${RUN_A.runId}/${pageKey}`,
    overlayUrl: `/overlay/${RUN_A.runId}/${pageKey}`,
    error: null,
  }];
  if (options.rightSelected !== false) {
    runs.push({
      runId: RUN_B.runId,
      engineId: RUN_B.engineId,
      preprocessingProfileSha256: RUN_B.preprocessingProfileSha256,
      status: options.rightFailed ? 'failed' : 'succeeded',
      prepared: options.rightFailed ? null : prepared,
      layoutUrl: options.rightFailed ? null : `/layout/${RUN_B.runId}/${pageKey}`,
      overlayUrl: options.rightFailed ? null : `/overlay/${RUN_B.runId}/${pageKey}`,
      error: options.rightFailed ? {
        stage: 'engine',
        code: 'DETECTOR_FAILED',
        message: 'Detector failed',
      } : null,
    });
  }
  return {
    pageKey,
    letterKey: pageKey.slice(0, -3),
    collectionCode,
    dateRaw: '19000101',
    type: 'L',
    typeSequence: 1,
    pageNumber: 1,
    originalFilename: `${pageKey}.jpg`,
    challengeTags,
    source: {
      sha256: 'b'.repeat(64),
      encodedWidth: 1200,
      encodedHeight: 1600,
      url: `/source/${pageKey}.jpg`,
    },
    groundTruth: {
      status: 'unannotated',
      url: `/ground-truth/${pageKey}`,
    },
    runs,
  };
}

function pageAgreement(
  pageKey: string,
  options: {
    comparable?: boolean;
    line?: [number, number, number];
    region?: [number, number, number];
    regionClass?: [number, number];
    boundaryIou?: number;
  } = {},
): LayoutPageAgreement {
  const comparable = options.comparable !== false;
  if (!comparable) {
    return {
      pageKey,
      comparable: false,
      reason: 'one_or_both_runs_failed',
    };
  }
  const [lineLeft, lineRight, lineMatched] = options.line ?? [0, 0, 0];
  const [regionLeft, regionRight, regionMatched] = options.region ?? [0, 0, 0];
  const [classEvaluated, classMatches] = options.regionClass ?? [0, 0];
  return {
    pageKey,
    comparable: true,
    effectiveLineTolerancePx: 20,
    prepared: {
      sha256: 'a'.repeat(64),
      width: 1200,
      height: 1600,
    },
    lines: {
      left: lineLeft,
      right: lineRight,
      matched: lineMatched,
      leftOnly: lineLeft - lineMatched,
      rightOnly: lineRight - lineMatched,
      splitCandidates: 0,
      mergeCandidates: 0,
      agreementF1: lineLeft + lineRight === 0
        ? null
        : (2 * lineMatched) / (lineLeft + lineRight),
      classAgreement: lineMatched > 0 ? 1 : null,
    },
    regions: {
      left: regionLeft,
      right: regionRight,
      matched: regionMatched,
      leftOnly: regionLeft - regionMatched,
      rightOnly: regionRight - regionMatched,
      agreementF1: regionLeft + regionRight === 0
        ? null
        : (2 * regionMatched) / (regionLeft + regionRight),
      classEvaluated,
      classMatches,
      classMismatches: classEvaluated - classMatches,
      classAgreement: classEvaluated > 0 ? classMatches / classEvaluated : null,
    },
    pageBoundary: {
      method: 'rasterized-polygon-iou',
      rasterLongEdgePx: 256,
      available: options.boundaryIou !== undefined,
      leftAvailable: true,
      rightAvailable: true,
      iou: options.boundaryIou ?? null,
      reason: options.boundaryIou === undefined
        ? 'both_provider_boundaries_unavailable'
        : null,
    },
    coverage: {
      method: 'union-of-line-bounding-boxes',
      available: true,
      leftAvailable: true,
      rightAvailable: true,
      leftFraction: 0.4,
      rightFraction: 0.4,
      signedDelta: 0,
      absoluteDelta: 0,
      reason: null,
    },
    orientationAgreement: {
      evaluated: lineMatched,
      correct: Math.max(0, lineMatched - 1),
      accuracy: lineMatched > 0 ? Math.max(0, lineMatched - 1) / lineMatched : null,
    },
    readingOrderAgreement: {
      evaluatedPairs: lineMatched > 1 ? lineMatched - 1 : 0,
      correctPairs: lineMatched > 2 ? lineMatched - 2 : 0,
      accuracy: lineMatched > 1 ? Math.max(0, lineMatched - 2) / (lineMatched - 1) : null,
    },
  };
}

function pairAggregate(
  comparablePages: number,
  incomparablePages: number,
): LayoutPairwiseScore['aggregate'] {
  return {
    comparablePages,
    incomparablePages,
    reasons: incomparablePages > 0 ? { one_or_both_runs_failed: incomparablePages } : {},
    lines: {
      left: 0,
      right: 0,
      matched: 0,
      leftOnly: 0,
      rightOnly: 0,
      agreementF1: null,
    },
    regions: {
      left: 0,
      right: 0,
      matched: 0,
      leftOnly: 0,
      rightOnly: 0,
      agreementF1: null,
      classEvaluated: 0,
      classMatches: 0,
      classMismatches: 0,
      classAgreement: null,
    },
    pageBoundary: {
      method: 'rasterized-polygon-iou',
      rasterLongEdgePx: 256,
      evaluatedPages: 0,
      unavailablePages: comparablePages,
      meanIoU: null,
    },
    coverageAvailablePages: comparablePages,
    coverageUnavailablePages: 0,
    coverageUnavailableReasons: {},
    coverageAbsoluteDeltaTotal: 0,
    meanCoverageAbsoluteDelta: comparablePages > 0 ? 0 : null,
  };
}

const BREAKDOWN_PAGES = [
  benchmarkPage('001-19000101-L01-01', '001', ['adjacent_page', 'sideways_text']),
  benchmarkPage('001-19000101-L01-02', '001', ['sideways_text']),
  benchmarkPage(
    '014-19000101-L01-01',
    '014',
    ['adjacent_page'],
    { rightFailed: true },
  ),
  benchmarkPage(
    '014-19000101-L01-02',
    '014',
    ['photograph'],
    { rightSelected: false },
  ),
];

function evaluation(): LayoutEvaluationResponse {
  const first: LayoutEvaluationDecision = {
    pageKey: BREAKDOWN_PAGES[0].pageKey,
    comparisonKey: `${RUN_A.runId}::${RUN_B.runId}`,
    leftRunId: RUN_A.runId,
    rightRunId: RUN_B.runId,
    preference: 'left',
    assessments: {
      left: { flags: [], repairs: repairs(2) },
      right: { flags: [], repairs: repairs(1) },
    },
    reviewedAt: '2026-07-28T04:00:00.000Z',
    updatedAt: '2026-07-28T04:00:00.000Z',
  };
  const reversed: LayoutEvaluationDecision = {
    pageKey: BREAKDOWN_PAGES[1].pageKey,
    comparisonKey: `${RUN_A.runId}::${RUN_B.runId}`,
    leftRunId: RUN_B.runId,
    rightRunId: RUN_A.runId,
    preference: 'left',
    assessments: {
      left: { flags: [], repairs: repairs(5) },
      right: { flags: [], repairs: repairs(3) },
    },
    reviewedAt: '2026-07-28T04:02:00.000Z',
    updatedAt: '2026-07-28T04:02:00.000Z',
  };
  return {
    evaluation: {
      schemaVersion: 1,
      cohortId: 'layout-cohort-v1',
      reviewerId: 'reviewer-1',
      createdAt: '2026-07-28T04:00:00.000Z',
      updatedAt: '2026-07-28T04:02:00.000Z',
      decisions: [first, reversed],
    },
    progress: {
      totalPages: 2,
      reviewedPages: 2,
      decisionCount: 2,
      excludedDecisionCount: 0,
      percent: 100,
      comparisons: [],
    },
  };
}

describe('LayoutResultsSummary', () => {
  it('shows aggregate comparability, human outcomes, and explicitly labels proxies', () => {
    render(
      <LayoutResultsSummary
        scorecards={scorecards()}
        leftRun={RUN_A}
        rightRun={RUN_B}
      />,
    );

    expect(screen.getByText('64 pages')).toBeInTheDocument();
    expect(screen.getByText(/2 incomparable/)).toBeInTheDocument();
    expect(screen.getByText(/one or both runs failed 2/)).toBeInTheDocument();
    expect(screen.getByText('A 12 · B 20 · tie 5 · neither 3')).toBeInTheDocument();
    expect(screen.getByText('45 s median')).toBeInTheDocument();
    expect(screen.getByText('82% line F1')).toBeInTheDocument();
    expect(screen.getByText(/71% region F1/)).toBeInTheDocument();
    expect(screen.getByText(/not accuracy/)).toBeInTheDocument();
    const pairEvidence = screen.getByRole('region', { name: 'Pair evidence' });
    expect(within(pairEvidence).getByText('89%')).toBeInTheDocument();
    expect(within(pairEvidence).getByText('88%')).toBeInTheDocument();
    expect(within(pairEvidence).getByText('A 40% · B 40%')).toBeInTheDocument();
    expect(within(pairEvidence).getByText('4%')).toBeInTheDocument();
    expect(screen.getByText('Human ground-truth accuracy is pending.')).toBeInTheDocument();
    expect(screen.getByText(/page-boundary, orientation, reading-order, and foreign-page accuracy/i))
      .toBeInTheDocument();
    expect(screen.getByText(/does not prove either engine is correct/i))
      .toBeInTheDocument();
  });

  it('shows coverage as unavailable when a side uses derived baseline envelopes', () => {
    const measured = scorecards();
    const page = measured.pairwise[0].pages[0];
    if (!page.comparable) throw new Error('Expected a comparable fixture page');
    page.coverage = {
      method: 'union-of-line-bounding-boxes',
      available: false,
      leftAvailable: false,
      rightAvailable: true,
      leftFraction: null,
      rightFraction: null,
      signedDelta: null,
      absoluteDelta: null,
      reason: 'left_line_boundaries_derived_from_baselines',
    };
    measured.pairwise[0].aggregate.coverageAvailablePages = 0;
    measured.pairwise[0].aggregate.coverageUnavailablePages = 1;
    measured.pairwise[0].aggregate.coverageUnavailableReasons = {
      left_line_boundaries_derived_from_baselines: 1,
    };
    measured.pairwise[0].aggregate.coverageAbsoluteDeltaTotal = 0;
    measured.pairwise[0].aggregate.meanCoverageAbsoluteDelta = null;

    render(
      <LayoutResultsSummary
        scorecards={measured}
        leftRun={RUN_A}
        rightRun={RUN_B}
      />,
    );

    const pairEvidence = screen.getByRole('region', { name: 'Pair evidence' });
    expect(within(pairEvidence).getAllByText('Unavailable')).toHaveLength(2);
    expect(within(pairEvidence).getAllByText(
      'Derived baseline envelopes excluded 1 page (A 1 · B 0).',
    )).toHaveLength(2);
    expect(within(pairEvidence).queryByText('A 40% · B 40%')).not.toBeInTheDocument();
  });

  it('compares failures, successful-page timing, memory, flags, and repairs per engine', () => {
    render(
      <LayoutResultsSummary
        scorecards={scorecards()}
        leftRun={RUN_A}
        rightRun={RUN_B}
      />,
    );

    const table = screen.getByRole('table');
    expect(within(table).getByText('64 / 66')).toBeInTheDocument();
    expect(within(table).getByText('succeeded · 2 failed (3%)')).toBeInTheDocument();
    expect(within(table).getByText('10 s')).toBeInTheDocument();
    expect(within(table).getByText('512 MiB')).toBeInTheDocument();
    expect(within(table).getByText('Missed lines 8 · Wrong orientation 2'))
      .toBeInTheDocument();
    expect(within(table).getByText('Lines added 10 · Orientations fixed 2'))
      .toBeInTheDocument();
    expect(within(table).getAllByText('Pending')).toHaveLength(6);
    expect(within(table).getByText(/engine:PROVIDER_INFERENCE_FAILED 2/))
      .toBeInTheDocument();
    expect(within(table).getByText(/ORIENTATION_FALLBACK 3/)).toBeInTheDocument();
    expect(within(table).getByText(/engine 10 s median/)).toBeInTheDocument();
  });

  it('reports line truth when available without implying full-layout accuracy', () => {
    const measured = scorecards();
    measured.runs.forEach((run) => {
      run.accuracy.availableGroundTruthPages = 6;
      run.accuracy.selectedAnnotatedPages = 6;
      run.accuracy.eligiblePages = 5;
      run.accuracy.incomparablePages = 1;
      run.accuracy.line.precision = 0.8;
      run.accuracy.line.recall = 0.75;
      run.accuracy.line.f1 = 0.774;
      run.accuracy.orientation = { evaluated: 10, correct: 8, accuracy: 0.8 };
      run.accuracy.readingOrder = {
        evaluatedPairs: 20,
        correctPairs: 15,
        accuracy: 0.75,
      };
      run.accuracy.foreignPage = {
        exclusionRegions: 2,
        targetFalsePositives: 1,
        correctlyClassifiedLines: 7,
        falseExcludedTargetLines: 2,
        correctlyClassifiedRegions: 2,
        falseExcludedRegions: 1,
      };
    });

    render(
      <LayoutResultsSummary
        scorecards={measured}
        leftRun={RUN_A}
        rightRun={RUN_B}
      />,
    );

    expect(screen.getByText('Human ground-truth accuracy available on up to 6 complete pages.'))
      .toBeInTheDocument();
    expect(screen.getAllByText('77% line F1')).toHaveLength(2);
    expect(screen.getByText(/page-boundary, orientation, reading-order, and foreign-page accuracy/i))
      .toBeInTheDocument();
    expect(screen.getAllByText('80% orientation')).toHaveLength(2);
    expect(screen.getAllByText(/75% reading order/)).toHaveLength(2);
    expect(screen.getAllByText('2 annotated exclusion regions')).toHaveLength(2);
  });

  it('renders empty-versus-empty proxy agreement as unavailable', () => {
    const measured = scorecards();
    const pair = measured.pairwise[0];
    pair.pages = [pageAgreement('001-19000101-L01-01')];
    pair.aggregate.lines = {
      left: 0,
      right: 0,
      matched: 0,
      leftOnly: 0,
      rightOnly: 0,
      agreementF1: null,
    };
    pair.aggregate.regions = {
      left: 0,
      right: 0,
      matched: 0,
      leftOnly: 0,
      rightOnly: 0,
      agreementF1: null,
      classEvaluated: 0,
      classMatches: 0,
      classMismatches: 0,
      classAgreement: null,
    };

    render(
      <LayoutResultsSummary
        scorecards={measured}
        leftRun={RUN_A}
        rightRun={RUN_B}
      />,
    );

    expect(screen.getByText('Unavailable line F1')).toBeInTheDocument();
    const pairEvidence = screen.getByRole('region', { name: 'Pair evidence' });
    expect(within(pairEvidence).getAllByText('Unavailable').length).toBeGreaterThan(0);
  });

  it('quarantines pair metrics and historical decisions when profile SHAs differ', () => {
    const measured = scorecards();
    measured.human.decisionCount = 0;
    measured.human.reviewedPages = 0;
    measured.human.excludedDecisionCount = 2;
    measured.human.excludedReasons = { preprocessing_profile_mismatch: 2 };
    const mismatchedRun = {
      ...RUN_B,
      preprocessingProfileId: 'layout-benchmark-v2',
      preprocessingProfileSha256: 'e'.repeat(64),
    };

    render(
      <LayoutResultsSummary
        scorecards={measured}
        leftRun={RUN_A}
        rightRun={mismatchedRun}
        pages={BREAKDOWN_PAGES}
        evaluation={evaluation()}
      />,
    );

    const quarantine = screen.getByRole('status');
    expect(quarantine).toHaveTextContent('Pair evidence quarantined.');
    expect(quarantine).toHaveTextContent('2 historical decisions');
    expect(quarantine).toHaveTextContent('preprocessing profile mismatch 2');
    expect(screen.getByText('0 pages')).toBeInTheDocument();
    expect(screen.getAllByText('Quarantined')).toHaveLength(6);
    expect(screen.getAllByText(/engine 10 s median/).length).toBeGreaterThan(0);
  });

  it('labels diagnostic profiles as inspection-only and omits quality ranking', () => {
    render(
      <LayoutResultsSummary
        scorecards={scorecards()}
        leftRun={RUN_A}
        rightRun={{
          ...RUN_B,
          diagnostic: {
            equivalentToDefaultProfile: false,
            comparisonProfile: 'kraken7-orli-cpu',
            purpose: 'Bounded smoke validation',
            capReachedIsQualityFailure: true,
          },
        }}
        qualityRankable={false}
      />,
    );

    expect(screen.getByText('Not ranked')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Diagnostic profile excluded from quality ranking.',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'equivalentToDefaultProfile=false',
    );
    expect(screen.getAllByText('Quarantined')).toHaveLength(6);
    expect(screen.getAllByText(/engine 10 s median/).length).toBeGreaterThan(0);
  });

  it('shows a contained error without hiding the selected-pair strip', () => {
    render(
      <LayoutResultsSummary
        scorecards={null}
        leftRun={RUN_A}
        rightRun={RUN_B}
        error="Scorecard could not be read"
      />,
    );

    expect(screen.getByText('Aggregate results')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Scorecard could not be read');
  });

  it('breaks measurements down by collection and overlapping challenge tags', async () => {
    const user = userEvent.setup();
    const measured = scorecards();
    measured.pairwise = [{
      leftRunId: RUN_B.runId,
      rightRunId: RUN_A.runId,
      metricKind: 'proxy_agreement_not_accuracy',
      pages: [
        pageAgreement(BREAKDOWN_PAGES[0].pageKey, {
          line: [10, 10, 8],
          region: [2, 2, 1],
          regionClass: [1, 1],
          boundaryIou: 0.8,
        }),
        pageAgreement(BREAKDOWN_PAGES[1].pageKey, {
          line: [10, 10, 10],
          region: [2, 2, 2],
          regionClass: [2, 1],
          boundaryIou: 1,
        }),
        pageAgreement(BREAKDOWN_PAGES[2].pageKey, { comparable: false }),
        pageAgreement(BREAKDOWN_PAGES[3].pageKey, { comparable: false }),
      ],
      aggregate: pairAggregate(2, 2),
    }];

    render(
      <LayoutResultsSummary
        scorecards={measured}
        leftRun={RUN_A}
        rightRun={RUN_B}
        pages={BREAKDOWN_PAGES}
        evaluation={evaluation()}
      />,
    );

    await user.click(screen.getByText('Cohort breakdowns'));

    const collectionTable = screen.getByRole('table', {
      name: 'Benchmark breakdown by collection',
    });
    const collection001 = within(collectionTable).getByRole('row', { name: /^001 / });
    expect(collection001).toHaveTextContent('2 cohort · 2 eligible · 2 comparable');
    expect(collection001).toHaveTextContent('A 1 · B 1 · T 0 · N 0');
    expect(collection001).toHaveTextContent('90%');
    expect(collection001).toHaveTextContent('75% geometry · 67% class');
    expect(collection001).toHaveTextContent('90% IoU');
    expect(collection001).toHaveTextContent('A 5 · B 6');

    const collection014 = within(collectionTable).getByRole('row', { name: /^014 / });
    expect(collection014).toHaveTextContent('2 cohort · 0 eligible · 0 comparable');
    const collection014Cells = within(collection014).getAllByRole('cell');
    expect(collection014Cells[1]).toHaveTextContent('0');
    expect(collection014Cells[2]).toHaveTextContent('Pending');
    expect(collection014).toHaveTextContent('Unavailable');

    const challengeTable = screen.getByRole('table', {
      name: 'Benchmark breakdown by challenge',
    });
    const sideways = within(challengeTable).getByRole('row', { name: /^sideways text /i });
    expect(sideways).toHaveTextContent('2 cohort · 2 eligible · 2 comparable');
    const sidewaysCells = within(sideways).getAllByRole('cell');
    expect(sidewaysCells[1]).toHaveTextContent('2');
    expect(sidewaysCells[2]).toHaveTextContent('A 1 · B 1');

    const adjacent = within(challengeTable).getByRole('row', { name: /^adjacent page /i });
    expect(adjacent).toHaveTextContent('2 cohort · 1 eligible · 1 comparable');
    const adjacentCells = within(adjacent).getAllByRole('cell');
    expect(adjacentCells[1]).toHaveTextContent('1');
    expect(adjacentCells[2]).toHaveTextContent('A 1 · B 0');
    expect(screen.getByText(/challenge groups overlap/i)).toBeInTheDocument();
    expect(screen.getAllByText(/not accuracy/i).length).toBeGreaterThan(0);
  });

  it('keeps missing per-page and human measurements visibly pending', async () => {
    const user = userEvent.setup();
    const measured = scorecards();
    measured.pairwise = [];

    render(
      <LayoutResultsSummary
        scorecards={measured}
        leftRun={RUN_A}
        rightRun={RUN_B}
        pages={BREAKDOWN_PAGES}
        evaluation={null}
      />,
    );

    await user.click(screen.getByText('Cohort breakdowns'));
    const collectionTable = screen.getByRole('table', {
      name: 'Benchmark breakdown by collection',
    });
    const collection001 = within(collectionTable).getByRole('row', { name: /^001 / });
    const cells = within(collection001).getAllByRole('cell');

    expect(cells[0]).toHaveTextContent('2 cohort · 2 eligible · — comparable');
    expect(cells[1]).toHaveTextContent('—');
    expect(cells[2]).toHaveTextContent('Pending');
    expect(cells[3]).toHaveTextContent('Unavailable');
    expect(cells[4]).toHaveTextContent('Unavailable geometry · Unavailable class');
    expect(cells[5]).toHaveTextContent('Unavailable IoU');
    expect(cells[6]).toHaveTextContent('A — · B —');
  });
});
