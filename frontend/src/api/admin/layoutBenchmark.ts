import {
  API_BASE_URL,
  ApiError,
  apiGet,
  apiPut,
  getAuthHeaders,
} from '../client';

export type LayoutEngineId = 'kraken6' | 'kraken7' | 'eynollah' | string;
export type LayoutRunState = 'created' | 'completed' | 'completed_with_failures';
export type LayoutPageRunStatus = 'succeeded' | 'failed';
export type LayoutRunStatusFilter = LayoutPageRunStatus | 'not_selected';
export type GroundTruthStatus = 'unannotated' | 'in_progress' | 'complete';
export type LayoutPreference = 'left' | 'right' | 'tie' | 'neither' | 'unreviewed';
export type LayoutJsonValue =
  | null
  | boolean
  | number
  | string
  | LayoutJsonValue[]
  | { [key: string]: LayoutJsonValue };
export type LayoutEvaluationFlag =
  | 'missed_line'
  | 'false_line'
  | 'split_line'
  | 'merged_lines'
  | 'wrong_orientation'
  | 'wrong_reading_order'
  | 'foreign_page_detection'
  | 'foreign_page_false_positive'
  | 'bad_region'
  | 'other';

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutReadingOrder {
  index: number;
  scope: 'page' | 'region';
  source: 'provider' | 'geometry';
}

export interface NormalizedLayoutRegion {
  id: string;
  class: string;
  boundary: LayoutPoint[];
  orientationDegrees: number | null;
  readingOrder: LayoutReadingOrder | null;
  confidence: number | null;
  lineIds: string[];
}

export interface NormalizedLayoutLine {
  id: string;
  regionId: string | null;
  class: string;
  boundary: LayoutPoint[];
  baseline: LayoutPoint[] | null;
  orientationDegrees: number | null;
  readingOrder: LayoutReadingOrder | null;
  confidence: number | null;
  provenance?: {
    attributes?: {
      rotationEnsemble?: {
        mergePolicy?: string;
        supportCount?: number;
        sourceRotationsDegrees?: number[];
        representativeRotationDegrees?: number;
        readingOrderSource?: string;
      };
    };
  };
}

export interface NormalizedLayout {
  schemaVersion: 1;
  pageKey: string;
  runId: string;
  engineId: LayoutEngineId;
  image: {
    width: number;
    height: number;
    coordinateSpace: 'prepared-pixels-top-left';
    sourceSha256: string;
    preparedSha256: string;
    rasterFingerprint?: LayoutPreparedRasterFingerprint;
  };
  pageBoundary: LayoutPoint[];
  regions: NormalizedLayoutRegion[];
  lines: NormalizedLayoutLine[];
  warnings: Array<{ code: string; message: string }>;
}

export interface LayoutBenchmarkOverview {
  schemaVersion: 1;
  cohort: {
    id: string;
    description: string;
    createdAt: string;
    letterCount: number;
    pageCount: number;
    collectionCodes: string[];
    challengeTags: string[];
  };
  runs: {
    valid: number;
    invalid: number;
    completed: number;
    completedWithFailures: number;
  };
  reviewer: {
    id: string;
    reviewedPages: number;
    decisionCount: number;
    excludedDecisionCount: number;
    totalPages: number;
    percent: number;
  };
  capabilities: {
    groundTruthWrite: boolean;
    evaluationWrite: boolean;
    runArtifactsReadOnly: boolean;
  };
}

export interface LayoutPreparedArtifact {
  sha256: string;
  width: number;
  height: number;
  rasterFingerprint?: LayoutPreparedRasterFingerprint | null;
  url: string;
}

export interface LayoutPreparedRasterFingerprint {
  algorithm: 'sha256-rgb8-v1';
  sha256: string;
}

export interface LayoutPageRunSummary {
  runId: string;
  engineId: LayoutEngineId;
  preprocessingProfileSha256: string;
  status: LayoutPageRunStatus;
  prepared: LayoutPreparedArtifact | null;
  layoutUrl: string | null;
  overlayUrl: string | null;
  pageMaskUrl?: string | null;
  engineInputUrl?: string | null;
  rawUrl?: string | null;
  errorUrl?: string | null;
  inputStageUrl?: string | null;
  error: {
    stage: string;
    code: string;
    message: string;
    details?: LayoutJsonValue;
  } | null;
}

export interface LayoutBenchmarkPageSummary {
  pageKey: string;
  letterKey: string;
  collectionCode: string;
  dateRaw: string;
  type: string;
  typeSequence: number;
  pageNumber: number;
  originalFilename: string;
  challengeTags: string[];
  source: {
    sha256: string;
    encodedWidth: number;
    encodedHeight: number;
    url: string;
  };
  groundTruth: {
    status: GroundTruthStatus;
    url: string;
  };
  runs: LayoutPageRunSummary[];
}

export interface LayoutBenchmarkPagesResponse {
  cohortId: string;
  total: number;
  filteredTotal: number;
  pages: LayoutBenchmarkPageSummary[];
}

export interface LayoutComparisonGroup {
  preparedSha256: string;
  rasterFingerprint?: LayoutPreparedRasterFingerprint;
  width: number;
  height: number;
  preprocessingProfileSha256: string;
  runIds: string[];
}

export interface LayoutBenchmarkPageResponse {
  page: LayoutBenchmarkPageSummary;
  comparisonGroups: LayoutComparisonGroup[];
  incomparableRuns: Array<{ runId: string; reason: string }>;
}

export interface LayoutBenchmarkRunSummary {
  runId: string;
  state: LayoutRunState;
  engineId: LayoutEngineId;
  engineVersion: string;
  adapterVersion: string;
  preprocessingProfileId: string;
  preprocessingProfileSha256: string;
  createdAt: string;
  completedAt: string | null;
  selected: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  diagnostic?: {
    equivalentToDefaultProfile: boolean;
    comparisonProfile: string | null;
    purpose: string | null;
    capReachedIsQualityFailure: boolean;
  } | null;
}

export interface LayoutBenchmarkRunsResponse {
  runs: LayoutBenchmarkRunSummary[];
  invalidRuns: Array<{ directory: string; error: string }>;
}

export interface LayoutRepairCounts {
  missedLinesAdded: number;
  falseLinesRemoved: number;
  splitLinesJoined: number;
  mergedLinesSplit: number;
  orientationCorrections: number;
  readingOrderCorrections: number;
  regionCorrections: number;
  other: number;
  total: number;
}

export interface LayoutRunAssessment {
  flags: LayoutEvaluationFlag[];
  repairs: LayoutRepairCounts;
}

export interface LayoutEvaluationDecision {
  pageKey: string;
  comparisonKey: string;
  leftRunId: string;
  rightRunId: string;
  preference: LayoutPreference;
  assessments: {
    left: LayoutRunAssessment;
    right: LayoutRunAssessment;
  };
  elapsedMs?: number;
  confidence?: number;
  notes?: string;
  reviewedAt: string;
  updatedAt: string;
}

export type LayoutEvaluationDecisionInput = Omit<
  LayoutEvaluationDecision,
  'pageKey' | 'comparisonKey' | 'reviewedAt' | 'updatedAt'
>;

export interface LayoutEvaluationProgress {
  totalPages: number;
  reviewedPages: number;
  decisionCount: number;
  excludedDecisionCount: number;
  percent: number;
  comparisons: Array<{
    comparisonKey: string;
    leftRunId: string;
    rightRunId: string;
    reviewedPages: number;
    attemptedPages: number;
    leftSelectedPages: number;
    rightSelectedPages: number;
    sharedSelectedPages: number;
    sharedSucceededPages: number;
    failedPages: number;
    preparedMismatchPages: number;
    preprocessingProfileMismatchPages: number;
    eligiblePages: number;
    incomparablePages: number;
    totalPages: number;
    percent: number;
  }>;
}

export interface LayoutEvaluationResponse {
  evaluation: {
    schemaVersion: number;
    cohortId: string;
    reviewerId: string;
    createdAt: string;
    updatedAt: string;
    decisions: LayoutEvaluationDecision[];
  };
  progress: LayoutEvaluationProgress;
}

export interface LayoutOrientationScore {
  evaluated: number;
  correct: number;
  accuracy: number | null;
}

export interface LayoutReadingOrderScore {
  evaluatedPairs: number;
  correctPairs: number;
  accuracy: number | null;
}

export type LayoutPairIncomparabilityReason =
  | 'preprocessing_profile_mismatch'
  | 'not_selected_by_both_runs'
  | 'one_or_both_runs_failed'
  | 'prepared_input_unavailable'
  | 'prepared_raster_or_dimensions_mismatch'
  | 'normalized_layout_invalid_or_missing';

export type LayoutCoverageUnavailableReason =
  | 'both_line_boundaries_derived_from_baselines'
  | 'left_line_boundaries_derived_from_baselines'
  | 'right_line_boundaries_derived_from_baselines';

export interface LayoutComparablePageAgreement {
  pageKey: string;
  comparable: true;
  effectiveLineTolerancePx: number;
  prepared: {
    sha256: string;
    width: number;
    height: number;
    rasterFingerprint?: LayoutPreparedRasterFingerprint;
  };
  lines: {
    left: number;
    right: number;
    matched: number;
    leftOnly: number;
    rightOnly: number;
    splitCandidates: number;
    mergeCandidates: number;
    agreementF1: number | null;
    classAgreement: number | null;
  };
  regions: {
    left: number;
    right: number;
    matched: number;
    leftOnly: number;
    rightOnly: number;
    agreementF1: number | null;
    classEvaluated: number;
    classMatches: number;
    classMismatches: number;
    classAgreement: number | null;
  };
  pageBoundary: {
    method: 'rasterized-polygon-iou';
    rasterLongEdgePx: number;
    available: boolean;
    leftAvailable: boolean;
    rightAvailable: boolean;
    iou: number | null;
    reason:
      | null
      | 'both_provider_boundaries_unavailable'
      | 'left_provider_boundary_unavailable'
      | 'right_provider_boundary_unavailable'
      | 'boundary_geometry_has_no_raster_area';
  };
  coverage: {
    method: 'union-of-line-bounding-boxes';
    available: boolean;
    leftAvailable: boolean;
    rightAvailable: boolean;
    leftFraction: number | null;
    rightFraction: number | null;
    signedDelta: number | null;
    absoluteDelta: number | null;
    reason: LayoutCoverageUnavailableReason | null;
  };
  orientationAgreement: LayoutOrientationScore;
  readingOrderAgreement: LayoutReadingOrderScore;
}

export interface LayoutIncomparablePageAgreement {
  pageKey: string;
  comparable: false;
  reason: LayoutPairIncomparabilityReason;
}

export type LayoutPageAgreement =
  | LayoutComparablePageAgreement
  | LayoutIncomparablePageAgreement;

export interface LayoutDurationDistribution {
  count: number;
  totalMs: number;
  medianMs: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
}

export interface LayoutRegionAccuracy {
  tp: number;
  fp: number;
  fn: number;
  classEvaluated: number;
  classMatches: number;
  classMismatches: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  classAgreement: number | null;
}

export interface LayoutPageBoundaryAggregate {
  method: 'rasterized-polygon-iou';
  rasterLongEdgePx: number;
  evaluatedPages: number;
  unavailablePages: number;
  meanIoU: number | null;
}

export interface LayoutPageBoundaryAccuracy {
  method: 'rasterized-polygon-iou';
  rasterLongEdgePx: number;
  available: boolean;
  iou: number | null;
  reason:
    | null
    | 'provider_boundary_unavailable'
    | 'boundary_geometry_has_no_raster_area';
}

export interface LayoutLineAccuracy {
  tp: number;
  fp: number;
  fn: number;
  split: number;
  merge: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface LayoutForeignPageAccuracy {
  exclusionRegions: number;
  targetFalsePositives: number;
  correctlyClassifiedLines: number;
  falseExcludedTargetLines: number;
  correctlyClassifiedRegions: number;
  falseExcludedRegions: number;
}

export interface LayoutPageForeignPageAccuracy {
  targetFalsePositives: number;
  correctlyClassified: number;
  falseExcludedTargetLines: number;
  correctlyClassifiedRegions: number;
  falseExcludedRegions: number;
  exclusionRegions: number;
}

export interface LayoutEligiblePageAccuracy {
  pageKey: string;
  eligible: true;
  effectiveLineTolerancePx: number;
  line: LayoutLineAccuracy;
  region: LayoutRegionAccuracy;
  pageBoundary: LayoutPageBoundaryAccuracy;
  orientation: LayoutOrientationScore;
  readingOrder: LayoutReadingOrderScore;
  foreignPage: LayoutPageForeignPageAccuracy;
}

export interface LayoutIneligiblePageAccuracy {
  pageKey: string;
  eligible: false;
  reason: string;
}

export type LayoutPageAccuracy =
  | LayoutEligiblePageAccuracy
  | LayoutIneligiblePageAccuracy;

export type LayoutRuntimeStage =
  | 'preparationMs'
  | 'engineMs'
  | 'inputStageMs'
  | 'normalizationMs'
  | 'overlayMs'
  | 'totalMs'
  | 'engineUserCpuMs'
  | 'engineSystemCpuMs'
  | 'providerModelLoadMs'
  | 'providerInferenceMs';

export interface LayoutStageTiming {
  count: number;
  totalMs: number;
  medianMs: number | null;
  p95Ms: number | null;
}

export interface LayoutRunScore {
  runId: string;
  engineId: LayoutEngineId;
  state: LayoutRunState;
  accuracy: {
    availableGroundTruthPages: number;
    selectedAnnotatedPages: number;
    eligiblePages: number;
    incomparablePages: number;
    line: {
      tp: number;
      fp: number;
      fn: number;
      precision: number | null;
      recall: number | null;
      f1: number | null;
      missed: number;
      spurious: number;
      split: number;
      merge: number;
    };
    region: LayoutRegionAccuracy;
    pageBoundary: LayoutPageBoundaryAggregate;
    orientation: LayoutOrientationScore;
    readingOrder: LayoutReadingOrderScore;
    foreignPage: LayoutForeignPageAccuracy;
    pages: LayoutPageAccuracy[];
  };
  runtime: {
    selected: number;
    succeeded: number;
    failed: number;
    failureRate: number | null;
    totalMs: number;
    pageDuration: {
      count: number;
      totalMs: number;
      medianMs: number | null;
      p95Ms: number | null;
      minMs: number | null;
      maxMs: number | null;
      attempted: LayoutDurationDistribution;
      successful: LayoutDurationDistribution;
      failed: LayoutDurationDistribution;
    };
    stageTimings: Record<LayoutRuntimeStage, LayoutStageTiming>;
    memory: {
      measuredPages: number;
      peakRssBytes: number | null;
      methods: Record<string, number>;
      caveat: string;
    };
    failures: Array<{
      stage: string;
      code: string;
      count: number;
    }>;
    warnings: Record<string, number>;
  };
}

export interface LayoutPairwiseScore {
  leftRunId: string;
  rightRunId: string;
  metricKind: 'proxy_agreement_not_accuracy';
  pages: LayoutPageAgreement[];
  aggregate: {
    comparablePages: number;
    incomparablePages: number;
    reasons: Partial<Record<LayoutPairIncomparabilityReason, number>>;
    lines: {
      left: number;
      right: number;
      matched: number;
      leftOnly: number;
      rightOnly: number;
      agreementF1: number | null;
    };
    regions: {
      left: number;
      right: number;
      matched: number;
      leftOnly: number;
      rightOnly: number;
      agreementF1: number | null;
      classEvaluated: number;
      classMatches: number;
      classMismatches: number;
      classAgreement: number | null;
    };
    pageBoundary: LayoutPageBoundaryAggregate;
    coverageAvailablePages: number;
    coverageUnavailablePages: number;
    coverageUnavailableReasons: Partial<Record<
      LayoutCoverageUnavailableReason,
      number
    >>;
    coverageAbsoluteDeltaTotal: number;
    meanCoverageAbsoluteDelta: number | null;
  };
}

export interface LayoutHumanRunSummary {
  runId: string;
  assessedPages: number;
  assessmentCount: number;
  flags: Record<string, number>;
  repairs: LayoutRepairCounts;
}

export interface LayoutHumanSummary {
  decisionCount: number;
  reviewedPages: number;
  preferences: Record<string, number>;
  runWins: Record<string, number>;
  byRun: LayoutHumanRunSummary[];
  timing: {
    count: number;
    totalMs: number;
    medianMs: number | null;
    p95Ms: number | null;
  };
  confidence: {
    count: number;
    mean: number | null;
  };
}

export interface LayoutHumanComparisonSummary extends LayoutHumanSummary {
  comparisonKey: string;
  leftRunId: string;
  rightRunId: string;
}

export interface LayoutScorecardsResponse {
  schemaVersion: 1;
  cohortId: string;
  generatedAt: string;
  parameters: Record<string, unknown>;
  metadata?: {
    pairwiseMetrics?: string;
    [key: string]: unknown;
  };
  runs: LayoutRunScore[];
  pairwise: LayoutPairwiseScore[];
  human: LayoutHumanSummary & {
    excludedDecisionCount: number;
    excludedReasons: Partial<Record<
      LayoutPairIncomparabilityReason | 'run_unavailable',
      number
    >>;
    byComparison: LayoutHumanComparisonSummary[];
  };
}

export interface LayoutBenchmarkPageFilters {
  collectionCode?: string;
  challengeTag?: string;
  groundTruthStatus?: GroundTruthStatus;
  runId?: string;
  runStatus?: LayoutRunStatusFilter;
}

export function resolveLayoutArtifactUrl(path: string): string {
  return new URL(path, API_BASE_URL).toString();
}

export async function getLayoutBenchmarkImageObjectUrl(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(resolveLayoutArtifactUrl(path), {
    credentials: 'include',
    headers: getAuthHeaders(),
    signal,
  });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      'Prepared benchmark image could not be loaded',
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new ApiError(
      502,
      'Prepared benchmark image returned an unexpected content type',
    );
  }
  return URL.createObjectURL(await response.blob());
}

export async function getLayoutBenchmarkArtifactText(path: string): Promise<string> {
  const body = await apiGet<LayoutJsonValue | string>(path);
  return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
}

export function getLayoutBenchmarkOverview(
  signal?: AbortSignal,
): Promise<LayoutBenchmarkOverview> {
  return apiGet<LayoutBenchmarkOverview>('/admin/layout-benchmark', undefined, signal);
}

export function getLayoutBenchmarkPages(
  filters?: LayoutBenchmarkPageFilters,
  signal?: AbortSignal,
): Promise<LayoutBenchmarkPagesResponse> {
  return apiGet<LayoutBenchmarkPagesResponse>(
    '/admin/layout-benchmark/pages',
    filters ? {
      collectionCode: filters.collectionCode,
      challengeTag: filters.challengeTag,
      groundTruthStatus: filters.groundTruthStatus,
      runId: filters.runId,
      runStatus: filters.runStatus,
    } : undefined,
    signal,
  );
}

export function getLayoutBenchmarkPage(
  pageKey: string,
  signal?: AbortSignal,
): Promise<LayoutBenchmarkPageResponse> {
  return apiGet<LayoutBenchmarkPageResponse>(
    `/admin/layout-benchmark/pages/${encodeURIComponent(pageKey)}`,
    undefined,
    signal,
  );
}

export function getLayoutBenchmarkRuns(
  signal?: AbortSignal,
): Promise<LayoutBenchmarkRunsResponse> {
  return apiGet<LayoutBenchmarkRunsResponse>(
    '/admin/layout-benchmark/runs',
    undefined,
    signal,
  );
}

export function getLayoutBenchmarkLayout(
  runId: string,
  pageKey: string,
  signal?: AbortSignal,
): Promise<NormalizedLayout> {
  return apiGet<NormalizedLayout>(
    `/admin/layout-benchmark/runs/${encodeURIComponent(runId)}/pages/${encodeURIComponent(pageKey)}/layout`,
    undefined,
    signal,
  );
}

export function getMyLayoutEvaluations(
  signal?: AbortSignal,
): Promise<LayoutEvaluationResponse> {
  return apiGet<LayoutEvaluationResponse>(
    '/admin/layout-benchmark/evaluations/me',
    undefined,
    signal,
  );
}

export function putMyLayoutEvaluation(
  pageKey: string,
  decision: LayoutEvaluationDecisionInput,
): Promise<{
  decision: LayoutEvaluationDecision;
  evaluation: LayoutEvaluationResponse['evaluation'];
  progress: LayoutEvaluationProgress;
}> {
  return apiPut(
    `/admin/layout-benchmark/evaluations/me/pages/${encodeURIComponent(pageKey)}`,
    decision,
  );
}

export function getLayoutScorecards(
  runIds: string[],
  signal?: AbortSignal,
): Promise<LayoutScorecardsResponse> {
  return apiGet<LayoutScorecardsResponse>(
    '/admin/layout-benchmark/scorecards',
    { runIds: runIds.join(',') },
    signal,
  );
}
