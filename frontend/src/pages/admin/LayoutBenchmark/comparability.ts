import type {
  LayoutBenchmarkPageSummary,
  LayoutPreparedArtifact,
  LayoutBenchmarkRunSummary,
} from '../../../api/admin/layoutBenchmark';

export const PREPROCESSING_PROFILE_MISMATCH_REASON = 'preprocessing_profile_mismatch';

export function preprocessingProfilesMatch(
  leftRun: LayoutBenchmarkRunSummary | null | undefined,
  rightRun: LayoutBenchmarkRunSummary | null | undefined,
): boolean {
  return Boolean(
    leftRun?.preprocessingProfileSha256
    && rightRun?.preprocessingProfileSha256
    && leftRun.preprocessingProfileSha256 === rightRun.preprocessingProfileSha256,
  );
}

export function runIsQualityRankable(
  run: LayoutBenchmarkRunSummary | null | undefined,
): boolean {
  return Boolean(run) && run?.diagnostic?.equivalentToDefaultProfile !== false;
}

export function preparedRastersMatch(
  left: LayoutPreparedArtifact | null | undefined,
  right: LayoutPreparedArtifact | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.width === right.width
    && left.height === right.height
    && left.rasterFingerprint
    && right.rasterFingerprint
    && left.rasterFingerprint.algorithm === 'sha256-rgb8-v1'
    && right.rasterFingerprint.algorithm === 'sha256-rgb8-v1'
    && left.rasterFingerprint.sha256 === right.rasterFingerprint.sha256,
  );
}

/**
 * A cheap, non-authoritative candidate gate for summaries of legacy runs.
 * Missing legacy fingerprints are resolved only after a pair/page is chosen;
 * this helper must never authorize a verdict write.
 */
export function pageHasPotentialRunPair(
  page: LayoutBenchmarkPageSummary,
  leftRun: LayoutBenchmarkRunSummary | null | undefined,
  rightRun: LayoutBenchmarkRunSummary | null | undefined,
): boolean {
  if (
    !leftRun
    || !rightRun
    || !runIsQualityRankable(leftRun)
    || !runIsQualityRankable(rightRun)
    || !preprocessingProfilesMatch(leftRun, rightRun)
  ) {
    return false;
  }
  const leftPageRun = page.runs.find((run) => run.runId === leftRun.runId);
  const rightPageRun = page.runs.find((run) => run.runId === rightRun.runId);
  if (
    leftPageRun?.status !== 'succeeded'
    || rightPageRun?.status !== 'succeeded'
    || !leftPageRun.prepared
    || !rightPageRun.prepared
    || leftPageRun.prepared.width !== rightPageRun.prepared.width
    || leftPageRun.prepared.height !== rightPageRun.prepared.height
  ) {
    return false;
  }
  if (
    leftPageRun.prepared.rasterFingerprint
    && rightPageRun.prepared.rasterFingerprint
  ) {
    return preparedRastersMatch(leftPageRun.prepared, rightPageRun.prepared);
  }
  return true;
}

export function pageHasEligibleRunPair(
  page: LayoutBenchmarkPageSummary,
  leftRun: LayoutBenchmarkRunSummary | null | undefined,
  rightRun: LayoutBenchmarkRunSummary | null | undefined,
): boolean {
  if (
    !leftRun
    || !rightRun
    || !runIsQualityRankable(leftRun)
    || !runIsQualityRankable(rightRun)
    || !preprocessingProfilesMatch(leftRun, rightRun)
  ) {
    return false;
  }
  const leftPageRun = page.runs.find((run) => run.runId === leftRun.runId);
  const rightPageRun = page.runs.find((run) => run.runId === rightRun.runId);
  return Boolean(
    leftPageRun?.status === 'succeeded'
    && rightPageRun?.status === 'succeeded'
    && leftPageRun.preprocessingProfileSha256 === leftRun.preprocessingProfileSha256
    && rightPageRun.preprocessingProfileSha256 === rightRun.preprocessingProfileSha256
    && leftPageRun.preprocessingProfileSha256 === rightPageRun.preprocessingProfileSha256
    && preparedRastersMatch(leftPageRun.prepared, rightPageRun.prepared),
  );
}

/**
 * Returns every page attempted by both selected runs, including provider
 * failures. These pages belong in diagnostic navigation even though only the
 * stricter eligible subset may receive a human preference or repair estimate.
 */
export function pageHasInspectableRunPair(
  page: LayoutBenchmarkPageSummary,
  leftRun: LayoutBenchmarkRunSummary | null | undefined,
  rightRun: LayoutBenchmarkRunSummary | null | undefined,
): boolean {
  if (!leftRun || !rightRun || !preprocessingProfilesMatch(leftRun, rightRun)) {
    return false;
  }
  const leftPageRun = page.runs.find((run) => run.runId === leftRun.runId);
  const rightPageRun = page.runs.find((run) => run.runId === rightRun.runId);
  return Boolean(
    leftPageRun
    && rightPageRun
    && leftPageRun.preprocessingProfileSha256 === leftRun.preprocessingProfileSha256
    && rightPageRun.preprocessingProfileSha256 === rightRun.preprocessingProfileSha256,
  );
}
