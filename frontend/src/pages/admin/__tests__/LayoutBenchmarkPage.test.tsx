// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayoutEvaluationResponse } from '../../../api/admin/layoutBenchmark';

const api = vi.hoisted(() => ({
  getLayoutBenchmarkOverview: vi.fn(),
  getLayoutBenchmarkPages: vi.fn(),
  getLayoutBenchmarkRuns: vi.fn(),
  getMyLayoutEvaluations: vi.fn(),
  getLayoutBenchmarkPage: vi.fn(),
  getLayoutBenchmarkLayout: vi.fn(),
  getLayoutBenchmarkImageObjectUrl: vi.fn(),
  getLayoutBenchmarkArtifactText: vi.fn(),
  getLayoutScorecards: vi.fn(),
  putMyLayoutEvaluation: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock('../../../api/admin/layoutBenchmark', () => ({
  ...api,
  resolveLayoutArtifactUrl: (path: string) => `http://localhost:3002${path}`,
}));

vi.mock('../../../api/client', () => ({
  getErrorMessage: (error: unknown, fallback: string) => (
    error instanceof Error ? error.message : fallback
  ),
}));

vi.mock('../../../components/AdminLayout/AdminLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast }),
}));

import LayoutBenchmarkPage from '../LayoutBenchmarkPage';

const RUN_A = {
  runId: 'kraken6-full-001',
  state: 'completed',
  engineId: 'kraken6',
  engineVersion: '6.0.3',
  adapterVersion: '1.0.0',
  preprocessingProfileId: 'layout-benchmark-v1',
  preprocessingProfileSha256: 'profile-sha-v1',
  createdAt: '2026-07-28T01:00:00.000Z',
  completedAt: '2026-07-28T01:10:00.000Z',
  selected: 1,
  succeeded: 1,
  failed: 0,
  durationMs: 10_000,
};

const RUN_B = {
  runId: 'eynollah-full-001',
  state: 'completed',
  engineId: 'eynollah',
  engineVersion: '0.9.0',
  adapterVersion: '1.0.0',
  preprocessingProfileId: 'layout-benchmark-v1',
  preprocessingProfileSha256: 'profile-sha-v1',
  createdAt: '2026-07-28T02:00:00.000Z',
  completedAt: '2026-07-28T02:10:00.000Z',
  selected: 1,
  succeeded: 1,
  failed: 0,
  durationMs: 8_000,
};

const NEWER_NONOVERLAPPING_RUN_A = {
  ...RUN_A,
  runId: 'contract-gated-kraken6-014p2',
  createdAt: '2026-07-28T04:00:00.000Z',
};

const DIAGNOSTIC_RUN = {
  ...RUN_A,
  runId: 'kraken7-orli-cap128-diagnostic',
  engineId: 'kraken7',
  engineVersion: '7.0.3',
  createdAt: '2026-07-28T05:00:00.000Z',
  diagnostic: {
    equivalentToDefaultProfile: false,
    comparisonProfile: 'kraken7-orli-cpu',
    purpose: 'Bounded line-cap smoke validation',
    capReachedIsQualityFailure: true,
  },
};

const RASTER_FINGERPRINT = {
  algorithm: 'sha256-rgb8-v1' as const,
  sha256: 'a'.repeat(64),
};

const PAGE = {
  pageKey: '014-18780127-L01-01',
  letterKey: '014-18780127-L01',
  collectionCode: '014',
  dateRaw: '18780127',
  type: 'L',
  typeSequence: 1,
  pageNumber: 1,
  originalFilename: '014-18780127-L01-01.jpg',
  challengeTags: ['sideways-text', 'marginalia'],
  source: {
    sha256: 'source-sha',
    encodedWidth: 1000,
    encodedHeight: 1400,
    url: '/images/layout-benchmark/source',
  },
  groundTruth: {
    status: 'unannotated',
    url: '/admin/layout-benchmark/ground-truth/014-18780127-L01-01',
  },
  runs: [
    {
      runId: RUN_A.runId,
      engineId: RUN_A.engineId,
      preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
      status: 'succeeded',
      prepared: {
        sha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        rasterFingerprint: RASTER_FINGERPRINT,
        url: '/images/layout-benchmark/a/prepared',
      },
      layoutUrl: '/admin/layout-benchmark/a/layout',
      overlayUrl: '/images/layout-benchmark/a/overlay',
      pageMaskUrl: '/images/layout-benchmark/a/pageMask',
      engineInputUrl: '/images/layout-benchmark/a/engineInput',
      inputStageUrl: '/admin/layout-benchmark/a/artifacts/inputStage',
      rawUrl: '/admin/layout-benchmark/a/artifacts/raw',
      error: null,
    },
    {
      runId: RUN_B.runId,
      engineId: RUN_B.engineId,
      preprocessingProfileSha256: RUN_B.preprocessingProfileSha256,
      status: 'succeeded',
      prepared: {
        sha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        rasterFingerprint: RASTER_FINGERPRINT,
        url: '/images/layout-benchmark/b/prepared',
      },
      layoutUrl: '/admin/layout-benchmark/b/layout',
      overlayUrl: '/images/layout-benchmark/b/overlay',
      rawUrl: '/admin/layout-benchmark/b/artifacts/raw',
      error: null,
    },
  ],
};

const UNSELECTED_PAGE = {
  ...PAGE,
  pageKey: '001-18881103-L01-01',
  letterKey: '001-18881103-L01',
  collectionCode: '001',
  dateRaw: '18881103',
  pageNumber: 1,
  originalFilename: '001-18881103-L01-01.jpg',
  challengeTags: [],
  runs: [],
};

const FILTERED_PAGE = {
  ...PAGE,
  pageKey: '001-18881103-L01-01',
  letterKey: '001-18881103-L01',
  collectionCode: '001',
  dateRaw: '18881103',
  pageNumber: 1,
  originalFilename: '001-18881103-L01-01.jpg',
  challengeTags: ['ordinary-horizontal'],
};

const SWAPPED_PAGE = {
  ...PAGE,
  pageKey: '014-18780127-L01-02',
  pageNumber: 2,
  originalFilename: '014-18780127-L01-02.jpg',
};

const FAILED_PAGE = {
  ...SWAPPED_PAGE,
  runs: [
    {
      ...PAGE.runs[0],
      prepared: {
        ...PAGE.runs[0].prepared,
        url: '/images/layout-benchmark/a/p2/prepared',
      },
    },
    {
      ...PAGE.runs[1],
      status: 'failed',
      prepared: {
        ...PAGE.runs[1].prepared,
        url: '/images/layout-benchmark/b/p2/prepared',
      },
      layoutUrl: '/admin/layout-benchmark/b/p2/layout',
      overlayUrl: '/images/layout-benchmark/b/p2/overlay',
      rawUrl: '/admin/layout-benchmark/b/p2/artifacts/raw',
      errorUrl: '/admin/layout-benchmark/b/p2/artifacts/error',
      error: {
        stage: 'engine-quality',
        code: 'PREDICTED_LINE_CAP_REACHED',
        message: 'Output reached the configured line cap and is truncated.',
        details: { maxPredictedLines: 768 },
      },
    },
  ],
};

function layout(
  runId: string,
  engineId: string,
  lineCount: number,
  rotationLineIndexes: number[] = [],
) {
  return {
    schemaVersion: 1,
    pageKey: PAGE.pageKey,
    runId,
    engineId,
    image: {
      width: 1000,
      height: 1400,
      coordinateSpace: 'prepared-pixels-top-left',
      sourceSha256: 'source-sha',
      preparedSha256: 'prepared-sha',
    },
    pageBoundary: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1400 },
      { x: 0, y: 1400 },
    ],
    regions: [],
    lines: Array.from({ length: lineCount }, (_, index) => ({
      id: `${runId}:line:${index}`,
      regionId: null,
      class: 'text_line',
      boundary: [
        { x: 100, y: 100 + index * 50 },
        { x: 800, y: 100 + index * 50 },
        { x: 800, y: 130 + index * 50 },
        { x: 100, y: 130 + index * 50 },
      ],
      baseline: null,
      orientationDegrees: 0,
      readingOrder: { index, scope: 'page', source: 'provider' },
      confidence: null,
      ...(rotationLineIndexes.includes(index) ? {
        provenance: {
          attributes: {
            rotationEnsemble: {
              mergePolicy: 'baseline-plus-vertical-zones',
              supportCount: 1,
              sourceRotationsDegrees: [90],
              representativeRotationDegrees: 90,
              readingOrderSource: 'ensemble-appended',
            },
          },
        },
      } : {}),
    })),
    warnings: [],
  };
}

function emptyEvaluation(): LayoutEvaluationResponse {
  return {
    evaluation: {
      schemaVersion: 1,
      cohortId: 'handwriting-layout-v1',
      reviewerId: 'reviewer-1',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      decisions: [],
    },
    progress: {
      totalPages: 1,
      reviewedPages: 0,
      decisionCount: 0,
      excludedDecisionCount: 0,
      percent: 0,
      comparisons: [],
    },
  };
}

function setupMocks({ comparable = true } = {}) {
  api.getLayoutBenchmarkOverview.mockResolvedValue({
    schemaVersion: 1,
    cohort: {
      id: 'handwriting-layout-v1',
      description: 'Fixed benchmark',
      createdAt: '2026-07-28',
      letterCount: 1,
      pageCount: 1,
      collectionCodes: ['001', '014'],
      challengeTags: ['marginalia', 'ordinary-horizontal', 'sideways-text'],
    },
    runs: { valid: 2, invalid: 0, completed: 2, completedWithFailures: 0 },
    reviewer: {
      id: 'reviewer-1',
      reviewedPages: 0,
      decisionCount: 0,
      excludedDecisionCount: 0,
      totalPages: 1,
      percent: 0,
    },
    capabilities: { groundTruthWrite: true, evaluationWrite: true, runArtifactsReadOnly: true },
  });
  api.getLayoutBenchmarkPages.mockResolvedValue({
    cohortId: 'handwriting-layout-v1',
    total: 1,
    filteredTotal: 1,
    pages: [PAGE],
  });
  api.getLayoutBenchmarkRuns.mockResolvedValue({
    runs: [RUN_A, RUN_B],
    invalidRuns: [],
  });
  api.getMyLayoutEvaluations.mockResolvedValue(emptyEvaluation());
  api.getLayoutBenchmarkPage.mockResolvedValue({
    page: comparable
      ? PAGE
      : {
        ...PAGE,
        runs: PAGE.runs.map((run) => (
          run.runId === RUN_B.runId && run.prepared
            ? {
              ...run,
              prepared: {
                ...run.prepared,
                sha256: 'prepared-sha-mismatch',
                rasterFingerprint: {
                  ...RASTER_FINGERPRINT,
                  sha256: 'b'.repeat(64),
                },
              },
            }
            : run
        )),
      },
    comparisonGroups: comparable
      ? [{
        preparedSha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
        runIds: [RUN_A.runId, RUN_B.runId],
      }]
      : [],
    incomparableRuns: comparable ? [] : [{ runId: RUN_B.runId, reason: 'prepared checksum mismatch' }],
  });
  api.getLayoutBenchmarkLayout.mockImplementation((runId: string) => (
    Promise.resolve(runId === RUN_A.runId
      ? layout(RUN_A.runId, RUN_A.engineId, 3)
      : layout(RUN_B.runId, RUN_B.engineId, 4))
  ));
  api.getLayoutBenchmarkImageObjectUrl.mockImplementation(async (path: string) => (
    `blob:blind-${path.split('/').filter(Boolean).slice(-2).join('-')}`
  ));
  api.getLayoutBenchmarkArtifactText.mockResolvedValue('{"artifact":"ok"}');
  api.getLayoutScorecards.mockResolvedValue({
    schemaVersion: 1,
    cohortId: 'handwriting-layout-v1',
    generatedAt: '2026-07-28T03:00:00.000Z',
    parameters: {},
    runs: [],
    pairwise: [{
      leftRunId: RUN_A.runId,
      rightRunId: RUN_B.runId,
      metricKind: 'proxy_agreement_not_accuracy',
      pages: [{
        pageKey: PAGE.pageKey,
        comparable,
        reason: comparable ? undefined : 'prepared checksum mismatch',
        effectiveLineTolerancePx: 20,
        prepared: {
          sha256: 'prepared-sha',
          width: 1000,
          height: 1400,
        },
        lines: {
          left: 3,
          right: 4,
          matched: 3,
          leftOnly: 0,
          rightOnly: 1,
          splitCandidates: 0,
          mergeCandidates: 0,
          agreementF1: comparable ? 6 / 7 : null,
          classAgreement: 1,
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
          available: false,
          leftAvailable: false,
          rightAvailable: false,
          iou: null,
          reason: 'both_provider_boundaries_unavailable',
        },
        coverage: {
          method: 'union-of-line-bounding-boxes',
          available: true,
          leftAvailable: true,
          rightAvailable: true,
          leftFraction: 0.3,
          rightFraction: 0.4,
          signedDelta: -0.1,
          absoluteDelta: 0.1,
          reason: null,
        },
        orientationAgreement: { evaluated: 3, correct: 3, accuracy: 1 },
        readingOrderAgreement: { evaluatedPairs: 3, correctPairs: 3, accuracy: 1 },
      }],
      aggregate: {
        comparablePages: comparable ? 1 : 0,
        incomparablePages: comparable ? 0 : 1,
        reasons: comparable ? {} : { prepared_checksum_or_dimensions_mismatch: 1 },
        lines: {
          left: comparable ? 3 : 0,
          right: comparable ? 4 : 0,
          matched: comparable ? 3 : 0,
          leftOnly: 0,
          rightOnly: comparable ? 1 : 0,
          agreementF1: comparable ? 6 / 7 : null,
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
          unavailablePages: comparable ? 1 : 0,
          meanIoU: null,
        },
        coverageAvailablePages: comparable ? 1 : 0,
        coverageUnavailablePages: 0,
        coverageUnavailableReasons: {},
        coverageAbsoluteDeltaTotal: comparable ? 0.1 : 0,
        meanCoverageAbsoluteDelta: comparable ? 0.1 : null,
      },
    }],
    human: {
      decisionCount: 0,
      reviewedPages: 0,
      preferences: {},
      runWins: {},
      byRun: [],
      timing: { count: 0, totalMs: 0, medianMs: null, p95Ms: null },
      confidence: { count: 0, mean: null },
      excludedDecisionCount: 0,
      excludedReasons: {},
      byComparison: [],
    },
  });
  api.putMyLayoutEvaluation.mockImplementation(async (
    pageKey: string,
    decision: Record<string, unknown>,
  ) => {
    const savedDecision = {
      pageKey,
      ...decision,
      createdAt: '2026-07-28T03:00:00.000Z',
      updatedAt: '2026-07-28T03:00:00.000Z',
    };
    const evaluation = emptyEvaluation().evaluation;
    return {
      decision: savedDecision,
      evaluation: { ...evaluation, decisions: [savedDecision] },
      progress: {
        totalPages: 1,
        reviewedPages: 1,
        decisionCount: 1,
        excludedDecisionCount: 0,
        percent: 100,
        comparisons: [],
      },
    };
  });
}

function loadPreparedImages(width = 1000, height = 1400) {
  screen.getAllByRole('img').forEach((image) => {
    Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true });
    fireEvent.load(image);
  });
}

async function waitForBlindGeometry() {
  const lockedCounts = await screen.findAllByText('Counts reveal after save');
  expect(lockedCounts.length).toBeGreaterThan(0);
}

async function openReviewSetup(user = userEvent.setup()) {
  const summary = screen.getByText('Change setup').closest('summary');
  expect(summary).not.toBeNull();
  await user.click(summary as HTMLElement);
  return user;
}

describe('LayoutBenchmarkPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('uses short grouped run choices and explains the selected methods outside the menu', async () => {
    const user = userEvent.setup();
    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    await openReviewSetup(user);

    const candidateOne = screen.getByRole('combobox', { name: 'Candidate 1' });
    expect(within(candidateOne).getByRole('option', {
      name: 'Kraken 6 baseline — 1/1 passed',
    })).toBeInTheDocument();
    expect(within(candidateOne).queryByText(RUN_A.runId)).not.toBeInTheDocument();
    expect(within(candidateOne).getByRole('group', { name: 'Baselines' }))
      .toBeInTheDocument();

    const summaryId = candidateOne.getAttribute('aria-describedby');
    expect(summaryId).toBe('layout-comparison-question');
    expect(document.getElementById(summaryId!)).toHaveTextContent(
      'Custom comparison.',
    );
    await user.click(screen.getByText('About selected candidates'));
    expect(screen.getByText('The original BLLA result used as the upgrade control.'))
      .toBeInTheDocument();
    expect(screen.getAllByText('Run details')).toHaveLength(2);
  });

  it('loads a suggested comparison and confirms dirty work only once', async () => {
    const user = userEvent.setup();
    const p0SafeRun = {
      ...DIAGNOSTIC_RUN,
      runId: 'p0-safe-full',
      engineId: 'kraken7-rot3-eyno-mask-p0-safe-zones',
      selected: 8,
      succeeded: 8,
      failed: 0,
      createdAt: '2026-07-29T04:14:00.000Z',
    };
    const kraken7Run = {
      ...RUN_A,
      runId: 'kraken7-full',
      engineId: 'kraken7',
      engineVersion: '7.0.3',
      selected: 66,
      succeeded: 66,
      createdAt: '2026-07-28T09:47:00.000Z',
    };
    const pageWithSuggestedPair = {
      ...PAGE,
      runs: [
        ...PAGE.runs,
        {
          ...PAGE.runs[0],
          runId: p0SafeRun.runId,
          engineId: p0SafeRun.engineId,
        },
        {
          ...PAGE.runs[0],
          runId: kraken7Run.runId,
          engineId: kraken7Run.engineId,
        },
      ],
    };
    api.getLayoutBenchmarkRuns.mockResolvedValue({
      runs: [p0SafeRun, kraken7Run, RUN_A, RUN_B],
      invalidRuns: [],
    });
    api.getLayoutBenchmarkPages.mockResolvedValue({
      cohortId: 'handwriting-layout-v1',
      total: 1,
      filteredTotal: 1,
      pages: [pageWithSuggestedPair],
    });
    api.getLayoutBenchmarkPage.mockResolvedValue({
      page: pageWithSuggestedPair,
      comparisonGroups: [{
        preparedSha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
        runIds: pageWithSuggestedPair.runs.map((pageRun) => pageRun.runId),
      }],
      incomparableRuns: [],
    });
    api.getLayoutBenchmarkLayout.mockImplementation((runId: string) => (
      Promise.resolve(layout(runId, runId === p0SafeRun.runId
        ? p0SafeRun.engineId
        : runId === kraken7Run.runId
          ? kraken7Run.engineId
          : runId === RUN_A.runId
            ? RUN_A.engineId
            : RUN_B.engineId, 3))
    ));

    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    loadPreparedImages();
    await user.click(screen.getByRole('button', { name: 'Start review' }));
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('radio', { name: /A.*Run A/i }));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openReviewSetup(user);
    await user.click(screen.getByRole('button', {
      name: 'Best candidate vs baseline',
    }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Candidate 1' }))
        .toHaveValue(p0SafeRun.runId);
      expect(screen.getByRole('combobox', { name: 'Candidate 2' }))
        .toHaveValue(kraken7Run.runId);
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText(
      'Start here: does strict page isolation plus guarded sideways recovery beat plain Kraken 7?',
    )).toBeInTheDocument();
  });

  it('renders aligned engine outputs and records measurable human repair effort', async () => {
    const user = userEvent.setup();
    api.getLayoutBenchmarkLayout.mockImplementation((runId: string) => (
      Promise.resolve(runId === RUN_A.runId
        ? layout(RUN_A.runId, RUN_A.engineId, 3, [2])
        : layout(RUN_B.runId, RUN_B.engineId, 4))
    ));
    render(<LayoutBenchmarkPage />);

    expect(await screen.findByRole('heading', { name: 'Layout Engine Lab' })).toBeInTheDocument();
    expect(await screen.findAllByText('Counts reveal after save')).toHaveLength(2);
    expect(screen.queryByRole('region', { name: 'Benchmark measurements' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Aggregate results locked' }))
      .not.toBeInTheDocument();
    expect(screen.queryByText('3 lines · 0 regions')).not.toBeInTheDocument();
    expect(screen.queryByText('4 lines · 0 regions')).not.toBeInTheDocument();
    const comparison = screen.getByRole('region', { name: 'Layout comparison' });
    expect(within(comparison).queryByText(/kraken6/i)).not.toBeInTheDocument();
    expect(within(comparison).queryByText(/eynollah/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Artifact evidence')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Raw provider output' })).not.toBeInTheDocument();
    expect(comparison.querySelector('[data-source-rotation]')).not.toBeInTheDocument();
    expect(screen.queryByText('Added from rotated pass')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Comparison legend' }))
      .not.toBeInTheDocument();

    loadPreparedImages();
    const startReview = screen.getByRole('button', { name: 'Start review' });
    await waitFor(() => expect(startReview).toBeEnabled());
    expect(screen.queryByRole('radio', { name: /A.*Run A/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save verdict' })).toBeDisabled();
    await user.click(startReview);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await user.click(screen.getByRole('radio', { name: /A.*Run A/i }));
    await user.click(screen.getByRole('checkbox', { name: 'Run A: Missed line' }));

    const repairSection = screen.getByRole('heading', { name: 'Estimated edits' }).closest('section');
    const linesAdded = within(repairSection as HTMLElement).getByRole('spinbutton', {
      name: 'Run A: Lines added',
    });
    await user.clear(linesAdded);
    await user.type(linesAdded, '2');
    await user.click(screen.getByRole('button', { name: 'Save verdict' }));

    await waitFor(() => expect(api.putMyLayoutEvaluation).toHaveBeenCalledTimes(1));
    expect(api.putMyLayoutEvaluation).toHaveBeenCalledWith(
      PAGE.pageKey,
      expect.objectContaining({
        leftRunId: RUN_A.runId,
        rightRunId: RUN_B.runId,
        preference: 'left',
        assessments: {
          left: {
            flags: ['missed_line'],
            repairs: expect.objectContaining({ missedLinesAdded: 2, total: 2 }),
          },
          right: {
            flags: [],
            repairs: expect.objectContaining({ total: 0 }),
          },
        },
        elapsedMs: expect.any(Number),
      }),
    );
    expect(showToast).toHaveBeenCalledWith('Benchmark verdict saved', 'success');
    expect(within(comparison).getByRole('heading', { name: /A · kraken6/i }))
      .toBeInTheDocument();
    expect(screen.getByText('Aggregate results')).toBeInTheDocument();
    expect(screen.getByText('3 lines · 0 regions')).toBeInTheDocument();
    expect(screen.getByText('4 lines · 0 regions')).toBeInTheDocument();
    expect(comparison.querySelector('[data-source-rotation="90"]')).toBeInTheDocument();
    await user.click(screen.getByText('Artifact evidence'));
    const runAEvidence = screen.getByRole('navigation', { name: 'A artifact evidence' });
    expect(within(runAEvidence).getByRole('link', { name: 'Raw provider output' }))
      .toHaveAttribute(
        'href',
        'http://localhost:3002/admin/layout-benchmark/a/artifacts/raw',
      );
    expect(within(runAEvidence).getByRole('link', { name: 'Page mask' }))
      .toHaveAttribute(
        'href',
        'http://localhost:3002/images/layout-benchmark/a/pageMask',
      );
    expect(within(runAEvidence).getByRole('link', { name: 'Masked engine input' }))
      .toHaveAttribute(
        'href',
        'http://localhost:3002/images/layout-benchmark/a/engineInput',
      );
    expect(within(runAEvidence).getByRole('link', { name: 'Mask provenance' }))
      .toHaveAttribute(
        'href',
        'http://localhost:3002/admin/layout-benchmark/a/artifacts/inputStage',
      );
  });

  it('flickers one shared canvas between A and B without stealing Space from form controls', async () => {
    const user = userEvent.setup();
    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();

    const comparison = screen.getByRole('region', { name: 'Layout comparison' });
    await user.click(screen.getByRole('button', { name: 'Single canvas' }));

    expect(within(comparison).getAllByRole('img')).toHaveLength(1);
    expect(comparison.querySelector('g[data-layer="A"]')).toBeInTheDocument();
    expect(comparison.querySelector('g[data-layer="B"]')).toBeInTheDocument();

    const showA = screen.getByRole('button', { name: 'Show candidate A only' });
    await user.click(showA);
    expect(comparison.querySelector('g[data-layer="A"]')).toBeInTheDocument();
    expect(comparison.querySelector('g[data-layer="B"]')).not.toBeInTheDocument();

    const sharedStage = screen.getByRole('group', { name: 'Single-canvas comparison' });
    sharedStage.focus();
    fireEvent.keyDown(sharedStage, { key: ' ', code: 'Space' });
    expect(comparison.querySelector('g[data-layer="A"]')).not.toBeInTheDocument();
    expect(comparison.querySelector('g[data-layer="B"]')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show candidate A only' }));
    showA.focus();
    fireEvent.keyDown(showA, { key: ' ', code: 'Space' });
    expect(comparison.querySelector('g[data-layer="A"]')).toBeInTheDocument();
    expect(comparison.querySelector('g[data-layer="B"]')).not.toBeInTheDocument();

    loadPreparedImages();
    const startReview = screen.getByRole('button', { name: 'Start review' });
    await waitFor(() => expect(startReview).toBeEnabled());
    await user.click(startReview);

    const notes = screen.getByRole('textbox', { name: 'Notes' });
    notes.focus();
    fireEvent.keyDown(notes, { key: ' ', code: 'Space' });
    expect(comparison.querySelector('g[data-layer="A"]')).toBeInTheDocument();
    expect(comparison.querySelector('g[data-layer="B"]')).not.toBeInTheDocument();
  });

  it('maps a swapped blind Run A verdict back to the canonical right run', async () => {
    const user = userEvent.setup();
    api.getLayoutBenchmarkPages.mockResolvedValue({
      cohortId: 'handwriting-layout-v1',
      total: 1,
      filteredTotal: 1,
      pages: [SWAPPED_PAGE],
    });
    api.getLayoutBenchmarkPage.mockResolvedValue({
      page: SWAPPED_PAGE,
      comparisonGroups: [{
        preparedSha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
        runIds: [RUN_A.runId, RUN_B.runId],
      }],
      incomparableRuns: [],
    });
    api.getLayoutBenchmarkLayout.mockImplementation((runId: string) => Promise.resolve({
      ...(runId === RUN_A.runId
        ? layout(RUN_A.runId, RUN_A.engineId, 3)
        : layout(RUN_B.runId, RUN_B.engineId, 4)),
      pageKey: SWAPPED_PAGE.pageKey,
    }));

    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    const runACanvas = screen.getByRole('heading', { name: 'Run A' }).closest('article');
    expect((runACanvas as HTMLElement).querySelectorAll('svg polygon')).toHaveLength(5);
    expect(within(runACanvas as HTMLElement).queryByText(/lines · .*regions/))
      .not.toBeInTheDocument();
    loadPreparedImages();
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Start review' }),
    ).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Start review' }));

    const runAChoice = screen.getByRole('radio', { name: /A.*Run A/i });
    runAChoice.focus();
    await user.keyboard('[Space]');
    await user.click(screen.getByRole('checkbox', { name: 'Run A: Missed line' }));
    await user.click(screen.getByRole('button', { name: 'Save verdict' }));

    await waitFor(() => expect(api.putMyLayoutEvaluation).toHaveBeenCalledTimes(1));
    expect(api.putMyLayoutEvaluation).toHaveBeenCalledWith(
      SWAPPED_PAGE.pageKey,
      expect.objectContaining({
        leftRunId: RUN_A.runId,
        rightRunId: RUN_B.runId,
        preference: 'right',
        assessments: {
          left: {
            flags: [],
            repairs: expect.objectContaining({ total: 0 }),
          },
          right: {
            flags: ['missed_line'],
            repairs: expect.objectContaining({ total: 0 }),
          },
        },
      }),
    );
  });

  it('opens a partial run pair on its first comparable page', async () => {
    const user = userEvent.setup();
    api.getLayoutBenchmarkPages.mockResolvedValue({
      cohortId: 'handwriting-layout-v1',
      total: 2,
      filteredTotal: 2,
      pages: [UNSELECTED_PAGE, PAGE],
    });

    render(<LayoutBenchmarkPage />);

    await waitForBlindGeometry();
    await openReviewSetup(user);
    expect(screen.getByRole('combobox', { name: 'Benchmark page' })).toHaveValue(
      PAGE.pageKey,
    );
    expect(api.getLayoutBenchmarkPage).toHaveBeenCalledWith(
      PAGE.pageKey,
      expect.any(AbortSignal),
    );
  });

  it('prefers an older engine-distinct run pair when the newest runs do not overlap', async () => {
    const user = userEvent.setup();
    api.getLayoutBenchmarkRuns.mockResolvedValue({
      runs: [NEWER_NONOVERLAPPING_RUN_A, RUN_A, RUN_B],
      invalidRuns: [],
    });

    render(<LayoutBenchmarkPage />);

    await waitForBlindGeometry();
    await openReviewSetup(user);
    expect(screen.getByRole('combobox', { name: 'Candidate 1' })).toHaveValue(RUN_A.runId);
    expect(screen.getByRole('combobox', { name: 'Candidate 2' })).toHaveValue(RUN_B.runId);
    expect(screen.getByRole('group', { name: 'Earlier run (selected)' }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show earlier runs (1)' }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps diagnostic profiles inspectable but excludes them from initial ranking and review', async () => {
    const user = userEvent.setup();
    const diagnosticPageRun = {
      ...PAGE.runs[0],
      runId: DIAGNOSTIC_RUN.runId,
      engineId: DIAGNOSTIC_RUN.engineId,
      layoutUrl: '/admin/layout-benchmark/diagnostic/layout',
      overlayUrl: '/images/layout-benchmark/diagnostic/overlay',
    };
    const pageWithDiagnostic = {
      ...PAGE,
      runs: [...PAGE.runs, diagnosticPageRun],
    };
    api.getLayoutBenchmarkRuns.mockResolvedValue({
      runs: [DIAGNOSTIC_RUN, RUN_A, RUN_B],
      invalidRuns: [],
    });
    api.getLayoutBenchmarkPages.mockResolvedValue({
      cohortId: 'handwriting-layout-v1',
      total: 1,
      filteredTotal: 1,
      pages: [pageWithDiagnostic],
    });
    api.getLayoutBenchmarkPage.mockResolvedValue({
      page: pageWithDiagnostic,
      comparisonGroups: [{
        preparedSha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
        runIds: [DIAGNOSTIC_RUN.runId, RUN_A.runId, RUN_B.runId],
      }],
      incomparableRuns: [],
    });
    api.getLayoutBenchmarkLayout.mockImplementation((runId: string) => (
      Promise.resolve(runId === DIAGNOSTIC_RUN.runId
        ? layout(DIAGNOSTIC_RUN.runId, DIAGNOSTIC_RUN.engineId, 5, [4])
        : runId === RUN_A.runId
          ? layout(RUN_A.runId, RUN_A.engineId, 3)
          : layout(RUN_B.runId, RUN_B.engineId, 4))
    ));

    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    await openReviewSetup(user);
    expect(screen.getByRole('combobox', { name: 'Candidate 1' })).toHaveValue(RUN_A.runId);

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Candidate 1' }),
      DIAGNOSTIC_RUN.runId,
    );

    expect(await screen.findByText('5 lines · 0 regions')).toBeInTheDocument();
    expect(screen.getByRole('option', {
      name: 'Kraken 7 baseline — 1/1 passed',
    })).toBeInTheDocument();
    expect(screen.getByText('Diagnostic — view only')).toBeInTheDocument();
    expect(screen.getByText('page position in diagnostic set')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Compare without ranking' }))
      .toBeInTheDocument();
    expect(screen.getByText(/use Single canvas to alternate A\/B/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Single canvas' })).toBeEnabled();
    expect(document.querySelector('[data-source-rotation="90"]'))
      .toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Lines' }));
    expect(document.querySelector('[data-source-rotation="90"]'))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Lines' }));
    await user.click(screen.getByRole('button', { name: 'Single canvas' }));
    expect(screen.getByRole('group', { name: 'Single-canvas comparison' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /kraken7/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diagnostic only' })).toBeDisabled();
    expect(api.putMyLayoutEvaluation).not.toHaveBeenCalled();
  });

  it('moves to a comparable page inside the selected filter', async () => {
    const user = userEvent.setup();
    api.getLayoutBenchmarkPages.mockResolvedValue({
      cohortId: 'handwriting-layout-v1',
      total: 2,
      filteredTotal: 2,
      pages: [PAGE, FILTERED_PAGE],
    });
    api.getLayoutBenchmarkPage.mockImplementation(async (pageKey: string) => ({
      page: pageKey === FILTERED_PAGE.pageKey ? FILTERED_PAGE : PAGE,
      comparisonGroups: [{
        preparedSha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
        runIds: [RUN_A.runId, RUN_B.runId],
      }],
      incomparableRuns: [],
    }));
    api.getLayoutBenchmarkLayout.mockImplementation((
      runId: string,
      pageKey: string,
    ) => Promise.resolve({
      ...(runId === RUN_A.runId
        ? layout(RUN_A.runId, RUN_A.engineId, 3)
        : layout(RUN_B.runId, RUN_B.engineId, 4)),
      pageKey,
    }));

    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    await openReviewSetup(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Collection' }),
      '001',
    );

    await waitFor(() => expect(
      screen.getByRole('combobox', { name: 'Benchmark page' }),
    ).toHaveValue(FILTERED_PAGE.pageKey));
    expect(screen.getByText('filtered comparable pages reviewed')).toBeInTheDocument();
  });

  it('pauses active review time while the browser window is unfocused', async () => {
    const user = userEvent.setup();
    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    loadPreparedImages();

    const startReview = screen.getByRole('button', { name: 'Start review' });
    await waitFor(() => expect(startReview).toBeEnabled());
    await user.click(startReview);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    fireEvent.blur(window);
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('blocks single-canvas comparison and proxy scoring when prepared inputs differ', async () => {
    setupMocks({ comparable: false });
    render(<LayoutBenchmarkPage />);

    expect(await screen.findByText('Prepared inputs do not match.')).toBeInTheDocument();
    const singleCanvasButton = screen.getByRole('button', { name: 'Single canvas' });
    expect(singleCanvasButton).toBeDisabled();
    expect(screen.queryByText('Automated evidence locked')).not.toBeInTheDocument();
    expect(screen.queryByText('Current page proxy')).not.toBeInTheDocument();
  });

  it('quarantines review and saved decisions when preprocessing profile SHAs differ', async () => {
    const mismatchedRun = {
      ...RUN_B,
      preprocessingProfileId: 'layout-benchmark-v2',
      preprocessingProfileSha256: 'profile-sha-v2',
    };
    api.getLayoutBenchmarkRuns.mockResolvedValue({
      runs: [RUN_A, mismatchedRun],
      invalidRuns: [],
    });
    const stored = emptyEvaluation();
    stored.evaluation.decisions = [{
      pageKey: PAGE.pageKey,
      comparisonKey: `${RUN_A.runId}__${RUN_B.runId}`,
      leftRunId: RUN_A.runId,
      rightRunId: RUN_B.runId,
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
      reviewedAt: '2026-07-28T03:00:00.000Z',
      updatedAt: '2026-07-28T03:00:00.000Z',
    }];
    api.getMyLayoutEvaluations.mockResolvedValue(stored);

    render(<LayoutBenchmarkPage />);

    expect((await screen.findAllByText(
      /different preprocessing-profile SHA-256 values/i,
    )).length).toBeGreaterThan(0);
    await openReviewSetup();
    expect(screen.getByRole('combobox', { name: 'Benchmark page' })).toBeDisabled();
    expect(screen.queryByText('Automated evidence locked')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Aggregate results locked' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save verdict' })).not.toBeInTheDocument();
    expect(api.putMyLayoutEvaluation).not.toHaveBeenCalled();
  });

  it('keeps successful output visible when the other engine fails', async () => {
    api.getLayoutBenchmarkLayout.mockImplementation((runId: string) => (
      runId === RUN_A.runId
        ? Promise.resolve(layout(RUN_A.runId, RUN_A.engineId, 3))
        : Promise.reject(new Error('Provider inference failed'))
    ));
    render(<LayoutBenchmarkPage />);

    await waitForBlindGeometry();
    expect(screen.getByRole('heading', { name: 'No comparable output' })).toBeInTheDocument();
    expect(screen.getByText(
      'This candidate did not produce a comparable output for the selected page.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Provider inference failed')).not.toBeInTheDocument();
  });

  it('keeps selected failure pages inspectable without allowing a human verdict', async () => {
    const user = userEvent.setup();
    api.getLayoutBenchmarkPages.mockResolvedValue({
      cohortId: 'handwriting-layout-v1',
      total: 2,
      filteredTotal: 2,
      pages: [PAGE, FAILED_PAGE],
    });
    api.getLayoutBenchmarkRuns.mockResolvedValue({
      runs: [
        { ...RUN_A, selected: 2, succeeded: 2 },
        {
          ...RUN_B,
          state: 'completed_with_failures',
          selected: 2,
          succeeded: 1,
          failed: 1,
        },
      ],
      invalidRuns: [],
    });
    api.getLayoutBenchmarkPage.mockImplementation(async (pageKey: string) => ({
      page: pageKey === FAILED_PAGE.pageKey ? FAILED_PAGE : PAGE,
      comparisonGroups: [{
        preparedSha256: 'prepared-sha',
        width: 1000,
        height: 1400,
        preprocessingProfileSha256: RUN_A.preprocessingProfileSha256,
        runIds: [RUN_A.runId, RUN_B.runId],
      }],
      incomparableRuns: pageKey === FAILED_PAGE.pageKey
        ? [{ runId: RUN_B.runId, reason: 'one_or_both_runs_failed' }]
        : [],
    }));
    const scorecards = await api.getLayoutScorecards();
    scorecards.pairwise[0].pages.push({
      pageKey: FAILED_PAGE.pageKey,
      comparable: false,
      reason: 'one_or_both_runs_failed',
    });
    scorecards.pairwise[0].aggregate.incomparablePages = 1;
    scorecards.pairwise[0].aggregate.reasons = { one_or_both_runs_failed: 1 };
    api.getLayoutScorecards.mockResolvedValue(scorecards);

    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    await openReviewSetup(user);

    const pageSelect = screen.getByRole('combobox', { name: 'Benchmark page' });
    expect(within(pageSelect).getByRole('option', {
      name: /014-18780127-L01-02.*failed output/i,
    })).toBeInTheDocument();
    await user.selectOptions(pageSelect, FAILED_PAGE.pageKey);

    expect(await screen.findByText(
      'Output reached the configured line cap and is truncated.',
    )).toBeInTheDocument();
    expect(screen.getByText(/failed \/ truncated output/i)).toBeInTheDocument();
    expect(screen.getByText('4 lines · 0 regions')).toBeInTheDocument();
    expect(api.getLayoutBenchmarkLayout).toHaveBeenCalledWith(
      RUN_B.runId,
      FAILED_PAGE.pageKey,
      expect.any(AbortSignal),
    );
    expect(screen.getAllByText(/diagnostic-only page/i).length).toBeGreaterThan(0);
    const failureReport = screen.getByRole('link', { name: 'Failure report' });
    expect(failureReport).toHaveAttribute(
      'href',
      'http://localhost:3002/admin/layout-benchmark/b/p2/artifacts/error',
    );
    const failedRunEvidence = failureReport.closest('nav');
    expect(within(failedRunEvidence as HTMLElement).getByRole(
      'link',
      { name: 'Rendered overlay' },
    )).toHaveAttribute(
      'href',
      'http://localhost:3002/images/layout-benchmark/b/p2/overlay',
    );
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:layout-artifact'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const downloadClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await user.click(failureReport);
    await waitFor(() => expect(api.getLayoutBenchmarkArtifactText).toHaveBeenCalledWith(
      '/admin/layout-benchmark/b/p2/artifacts/error',
    ));
    expect(downloadClick).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Failure report downloaded', 'success');
    downloadClick.mockRestore();
    expect(screen.queryByRole('radio', { name: /A.*eynollah/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Run A: Missed line' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Run A: Lines added' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Diagnostic only' })).toBeDisabled();
    const diagnosticPosition = screen.getByText('page position in diagnostic set')
      .closest('.layout-review-progress');
    expect(diagnosticPosition).toHaveTextContent('2 / 2');
    expect(screen.getAllByText(/1 failed/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(pageSelect).toHaveValue(PAGE.pageKey));
    expect(api.putMyLayoutEvaluation).not.toHaveBeenCalled();
  });

  it('orients a saved unordered comparison when the displayed A/B order is reversed', async () => {
    const stored = emptyEvaluation();
    stored.evaluation.decisions = [{
      pageKey: PAGE.pageKey,
      comparisonKey: `${RUN_A.runId}__${RUN_B.runId}`,
      leftRunId: RUN_B.runId,
      rightRunId: RUN_A.runId,
      preference: 'left',
      assessments: {
        left: {
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
      elapsedMs: 5_000,
      confidence: 4,
      notes: 'Eynollah needed less repair',
      reviewedAt: '2026-07-28T03:00:00.000Z',
      updatedAt: '2026-07-28T03:00:00.000Z',
    }];
    api.getMyLayoutEvaluations.mockResolvedValue(stored);

    render(<LayoutBenchmarkPage />);
    expect(await screen.findByText('3 lines · 0 regions')).toBeInTheDocument();
    loadPreparedImages();

    expect(screen.getByRole('radio', { name: /B.*eynollah/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Run B: Missed line' })).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: 'Run B: Lines added' })).toHaveValue(1);
    expect(screen.getByRole('radio', { name: /B.*eynollah/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Run B: Missed line' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Run B: Lines added' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Verdict locked' })).toBeDisabled();
    expect(screen.getByText('Saved · read-only')).toBeInTheDocument();
  });

  it('blocks timing and saving when decoded image dimensions violate the manifest', async () => {
    render(<LayoutBenchmarkPage />);
    await waitForBlindGeometry();
    loadPreparedImages(999, 1400);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Prepared image dimensions are 999×1400/,
    );
    expect(screen.getByRole('button', { name: 'Start review' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save verdict' })).toBeDisabled();
  });
});
