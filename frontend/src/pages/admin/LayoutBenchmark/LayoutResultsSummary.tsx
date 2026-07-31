import type {
  LayoutBenchmarkPageSummary,
  LayoutBenchmarkRunSummary,
  LayoutComparablePageAgreement,
  LayoutEvaluationDecision,
  LayoutEvaluationResponse,
  LayoutEvaluationFlag,
  LayoutHumanSummary,
  LayoutPairwiseScore,
  LayoutRepairCounts,
  LayoutRuntimeStage,
  LayoutRunScore,
  LayoutScorecardsResponse,
} from '../../../api/admin/layoutBenchmark';
import {
  pageHasPotentialRunPair,
  preprocessingProfilesMatch,
} from './comparability';
import './LayoutResultsSummary.css';

interface LayoutResultsSummaryProps {
  scorecards: LayoutScorecardsResponse | null;
  leftRun: LayoutBenchmarkRunSummary;
  rightRun: LayoutBenchmarkRunSummary;
  pages?: LayoutBenchmarkPageSummary[];
  evaluation?: LayoutEvaluationResponse | null;
  error?: string | null;
  revealIdentity?: boolean;
  qualityRankable?: boolean;
}

const FLAG_LABELS: Partial<Record<LayoutEvaluationFlag, string>> = {
  missed_line: 'Missed lines',
  false_line: 'False lines',
  split_line: 'Split lines',
  merged_lines: 'Merged lines',
  wrong_orientation: 'Wrong orientation',
  wrong_reading_order: 'Wrong order',
  foreign_page_detection: 'Foreign-page misses',
  foreign_page_false_positive: 'False foreign-page marks',
  bad_region: 'Bad page/region boundaries',
  other: 'Other',
};

const REPAIR_LABELS: Array<[Exclude<keyof LayoutRepairCounts, 'total'>, string]> = [
  ['missedLinesAdded', 'Lines added'],
  ['falseLinesRemoved', 'Lines removed'],
  ['splitLinesJoined', 'Splits joined'],
  ['mergedLinesSplit', 'Merges split'],
  ['orientationCorrections', 'Orientations fixed'],
  ['readingOrderCorrections', 'Order fixes'],
  ['regionCorrections', 'Page/region fixes'],
  ['other', 'Other'],
];

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) {
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
  }
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1_000);
  return seconds === 0 ? `${minutes} min` : `${minutes}m ${seconds}s`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable';
  return `${Math.round(value * 100)}%`;
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not measured';
  const mebibytes = value / (1024 ** 2);
  if (mebibytes < 1024) return `${Math.round(mebibytes)} MiB`;
  return `${(mebibytes / 1024).toFixed(1)} GiB`;
}

function formatIssueLabel(key: string): string {
  return FLAG_LABELS[key as LayoutEvaluationFlag]
    ?? key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scoreFor(
  scorecards: LayoutScorecardsResponse,
  runId: string,
): LayoutRunScore | null {
  return scorecards.runs.find((score) => score.runId === runId) ?? null;
}

function pairFor(
  scorecards: LayoutScorecardsResponse,
  leftRunId: string,
  rightRunId: string,
): LayoutPairwiseScore | null {
  return scorecards.pairwise.find((pair) => (
    (
      pair.leftRunId === leftRunId
      && pair.rightRunId === rightRunId
    ) || (
      pair.leftRunId === rightRunId
      && pair.rightRunId === leftRunId
    )
  )) ?? null;
}

interface NormalizedPairDecision {
  pageKey: string;
  preference: Exclude<LayoutEvaluationDecision['preference'], 'unreviewed'>;
  leftFlags: LayoutEvaluationFlag[];
  rightFlags: LayoutEvaluationFlag[];
  leftRepairs: LayoutRepairCounts;
  rightRepairs: LayoutRepairCounts;
  elapsedMs?: number;
  confidence?: number;
  updatedAt: string;
}

interface LayoutBreakdownRow {
  key: string;
  label: string;
  cohortPages: number;
  eligiblePages: number;
  comparablePages: number | null;
  reviewedPages: number | null;
  outcomes: {
    left: number;
    right: number;
    tie: number;
    neither: number;
  } | null;
  lineAgreement: number | null;
  regionAgreement: number | null;
  regionClassAgreement: number | null;
  pageBoundaryAgreement: number | null;
  repairs: {
    left: number;
    right: number;
  } | null;
}

function normalizeDecisionForPair(
  decision: LayoutEvaluationDecision,
  leftRunId: string,
  rightRunId: string,
): NormalizedPairDecision | null {
  if (decision.preference === 'unreviewed') return null;
  if (
    decision.leftRunId === leftRunId
    && decision.rightRunId === rightRunId
  ) {
    return {
      pageKey: decision.pageKey,
      preference: decision.preference,
      leftFlags: decision.assessments.left.flags,
      rightFlags: decision.assessments.right.flags,
      leftRepairs: decision.assessments.left.repairs,
      rightRepairs: decision.assessments.right.repairs,
      elapsedMs: decision.elapsedMs,
      confidence: decision.confidence,
      updatedAt: decision.updatedAt,
    };
  }
  if (
    decision.leftRunId !== rightRunId
    || decision.rightRunId !== leftRunId
  ) {
    return null;
  }
  return {
    pageKey: decision.pageKey,
    preference: decision.preference === 'left'
      ? 'right'
      : decision.preference === 'right'
        ? 'left'
        : decision.preference,
    leftFlags: decision.assessments.right.flags,
    rightFlags: decision.assessments.left.flags,
    leftRepairs: decision.assessments.right.repairs,
    rightRepairs: decision.assessments.left.repairs,
    elapsedMs: decision.elapsedMs,
    confidence: decision.confidence,
    updatedAt: decision.updatedAt,
  };
}

function decisionsForPair(
  evaluation: LayoutEvaluationResponse | null | undefined,
  leftRunId: string,
  rightRunId: string,
): Map<string, NormalizedPairDecision> | null {
  if (!evaluation) return null;
  const decisions = new Map<string, NormalizedPairDecision>();
  evaluation.evaluation.decisions.forEach((decision) => {
    const normalized = normalizeDecisionForPair(decision, leftRunId, rightRunId);
    if (!normalized) return;
    const existing = decisions.get(normalized.pageKey);
    if (
      !existing
      || Date.parse(normalized.updatedAt) >= Date.parse(existing.updatedAt)
    ) {
      decisions.set(normalized.pageKey, normalized);
    }
  });
  return decisions;
}

function emptyRepairCounts(): LayoutRepairCounts {
  return {
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
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(fraction * ordered.length) - 1)];
}

function summarizeManualEvidence(
  decisions: Map<string, NormalizedPairDecision>,
  eligiblePageKeys: Set<string>,
  leftRunId: string,
  rightRunId: string,
): LayoutHumanSummary {
  const eligible = [...decisions.values()].filter((decision) => (
    eligiblePageKeys.has(decision.pageKey)
  ));
  const preferences: Record<string, number> = {
    left: 0,
    right: 0,
    tie: 0,
    neither: 0,
  };
  const runWins: Record<string, number> = {};
  const runEvidence = new Map([
    [leftRunId, {
      runId: leftRunId,
      assessedPages: 0,
      assessmentCount: 0,
      flags: {} as Record<string, number>,
      repairs: emptyRepairCounts(),
    }],
    [rightRunId, {
      runId: rightRunId,
      assessedPages: 0,
      assessmentCount: 0,
      flags: {} as Record<string, number>,
      repairs: emptyRepairCounts(),
    }],
  ]);
  const timingValues: number[] = [];
  const confidenceValues: number[] = [];

  eligible.forEach((decision) => {
    preferences[decision.preference] = (preferences[decision.preference] ?? 0) + 1;
    if (decision.preference === 'left') {
      runWins[leftRunId] = (runWins[leftRunId] ?? 0) + 1;
    } else if (decision.preference === 'right') {
      runWins[rightRunId] = (runWins[rightRunId] ?? 0) + 1;
    }
    ([
      {
        runId: leftRunId,
        flags: decision.leftFlags,
        repairs: decision.leftRepairs,
      },
      {
        runId: rightRunId,
        flags: decision.rightFlags,
        repairs: decision.rightRepairs,
      },
    ]).forEach(({ runId, flags, repairs }) => {
      const evidence = runEvidence.get(runId)!;
      evidence.assessedPages += 1;
      evidence.assessmentCount += 1;
      flags.forEach((flag) => {
        evidence.flags[flag] = (evidence.flags[flag] ?? 0) + 1;
      });
      (Object.keys(evidence.repairs) as Array<keyof LayoutRepairCounts>).forEach((key) => {
        evidence.repairs[key] += repairs[key];
      });
    });
    if (decision.elapsedMs !== undefined) timingValues.push(decision.elapsedMs);
    if (decision.confidence !== undefined) confidenceValues.push(decision.confidence);
  });

  return {
    decisionCount: eligible.length,
    reviewedPages: new Set(eligible.map((decision) => decision.pageKey)).size,
    preferences,
    runWins,
    byRun: [...runEvidence.values()],
    timing: {
      count: timingValues.length,
      totalMs: timingValues.reduce((sum, value) => sum + value, 0),
      medianMs: percentile(timingValues, 0.5),
      p95Ms: percentile(timingValues, 0.95),
    },
    confidence: {
      count: confidenceValues.length,
      mean: confidenceValues.length > 0
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : null,
    },
  };
}

function aggregateAgreement(
  agreements: LayoutComparablePageAgreement[],
  dimension: 'lines' | 'regions',
): number | null {
  if (agreements.length === 0) return null;
  const totals = agreements.reduce((result, agreement) => ({
    left: result.left + agreement[dimension].left,
    right: result.right + agreement[dimension].right,
    matched: result.matched + agreement[dimension].matched,
  }), { left: 0, right: 0, matched: 0 });
  const denominator = totals.left + totals.right;
  return denominator === 0 ? null : (2 * totals.matched) / denominator;
}

function aggregateRegionClassAgreement(
  agreements: LayoutComparablePageAgreement[],
): number | null {
  const totals = agreements.reduce((result, agreement) => ({
    evaluated: result.evaluated + agreement.regions.classEvaluated,
    matches: result.matches + agreement.regions.classMatches,
  }), { evaluated: 0, matches: 0 });
  return totals.evaluated > 0 ? totals.matches / totals.evaluated : null;
}

function aggregatePageBoundaryAgreement(
  agreements: LayoutComparablePageAgreement[],
): number | null {
  const values = agreements
    .map((agreement) => agreement.pageBoundary.iou)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function breakdownRows(
  groups: Array<{ key: string; label: string; pages: LayoutBenchmarkPageSummary[] }>,
  pair: LayoutPairwiseScore | null,
  decisions: Map<string, NormalizedPairDecision> | null,
  leftRun: LayoutBenchmarkRunSummary,
  rightRun: LayoutBenchmarkRunSummary,
): LayoutBreakdownRow[] {
  const agreementByPage = pair
    ? new Map(pair.pages.map((page) => [page.pageKey, page]))
    : null;
  return groups.map((group) => {
    const eligible = group.pages.filter((page) => (
      agreementByPage
        ? agreementByPage.get(page.pageKey)?.comparable === true
        : pageHasPotentialRunPair(page, leftRun, rightRun)
    ));
    const pageAgreements = agreementByPage
      ? eligible.map((page) => agreementByPage.get(page.pageKey))
      : [];
    const pairCoverageComplete = Boolean(
      agreementByPage && pageAgreements.every((agreement) => agreement !== undefined),
    );
    const comparableAgreements = pairCoverageComplete
      ? pageAgreements.filter(
        (agreement): agreement is LayoutComparablePageAgreement => (
          agreement?.comparable === true
        ),
      )
      : [];
    const reviewed = decisions
      ? eligible
        .map((page) => decisions.get(page.pageKey))
        .filter((decision): decision is NormalizedPairDecision => decision !== undefined)
      : null;
    const outcomes = reviewed
      ? reviewed.reduce((result, decision) => {
        result[decision.preference as keyof typeof result] += 1;
        return result;
      }, { left: 0, right: 0, tie: 0, neither: 0 })
      : null;
    const repairs = reviewed
      ? reviewed.reduce((result, decision) => ({
        left: result.left + decision.leftRepairs.total,
        right: result.right + decision.rightRepairs.total,
      }), { left: 0, right: 0 })
      : null;

    return {
      key: group.key,
      label: group.label,
      cohortPages: group.pages.length,
      eligiblePages: eligible.length,
      comparablePages: pairCoverageComplete ? comparableAgreements.length : null,
      reviewedPages: reviewed?.length ?? null,
      outcomes,
      lineAgreement: pairCoverageComplete
        ? aggregateAgreement(comparableAgreements, 'lines')
        : null,
      regionAgreement: pairCoverageComplete
        ? aggregateAgreement(comparableAgreements, 'regions')
        : null,
      regionClassAgreement: pairCoverageComplete
        ? aggregateRegionClassAgreement(comparableAgreements)
        : null,
      pageBoundaryAgreement: pairCoverageComplete
        ? aggregatePageBoundaryAgreement(comparableAgreements)
        : null,
      repairs,
    };
  });
}

function collectionGroups(
  pages: LayoutBenchmarkPageSummary[],
): Array<{ key: string; label: string; pages: LayoutBenchmarkPageSummary[] }> {
  const grouped = new Map<string, LayoutBenchmarkPageSummary[]>();
  pages.forEach((page) => {
    grouped.set(page.collectionCode, [...(grouped.get(page.collectionCode) ?? []), page]);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([collectionCode, collectionPages]) => ({
      key: collectionCode,
      label: collectionCode,
      pages: collectionPages,
    }));
}

function challengeGroups(
  pages: LayoutBenchmarkPageSummary[],
): Array<{ key: string; label: string; pages: LayoutBenchmarkPageSummary[] }> {
  const grouped = new Map<string, LayoutBenchmarkPageSummary[]>();
  pages.forEach((page) => {
    page.challengeTags.forEach((tag) => {
      grouped.set(tag, [...(grouped.get(tag) ?? []), page]);
    });
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, challengePages]) => ({
      key: tag,
      label: tag.replaceAll('_', ' '),
      pages: challengePages,
    }));
}

function runTitle(run: LayoutBenchmarkRunSummary): string {
  return `${run.engineId} ${run.engineVersion}`;
}

function totalFlags(flags: Record<string, number> | undefined): number {
  return Object.values(flags ?? {}).reduce((sum, count) => sum + count, 0);
}

function FlagBreakdown({ flags }: { flags: Record<string, number> | undefined }) {
  const populated = Object.entries(flags ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);
  if (populated.length === 0) {
    return <span className="layout-results-detail">No flagged issues yet</span>;
  }
  return (
    <span className="layout-results-detail">
      {populated.map(([key, count]) => `${formatIssueLabel(key)} ${count}`).join(' · ')}
    </span>
  );
}

function RepairBreakdown({ repairs }: { repairs: LayoutRepairCounts | undefined }) {
  const populated = repairs
    ? REPAIR_LABELS.filter(([key]) => repairs[key] > 0)
    : [];
  if (populated.length === 0) {
    return <span className="layout-results-detail">No repair actions yet</span>;
  }
  return (
    <span className="layout-results-detail">
      {populated.map(([key, label]) => `${label} ${repairs?.[key] ?? 0}`).join(' · ')}
    </span>
  );
}

function RunSuccess({
  run,
  score,
}: {
  run: LayoutBenchmarkRunSummary;
  score: LayoutRunScore | null;
}) {
  const selected = score?.runtime.selected ?? run.selected;
  const succeeded = score?.runtime.succeeded ?? run.succeeded;
  const failed = score?.runtime.failed ?? run.failed;
  const failureRate = score?.runtime.failureRate
    ?? (selected > 0 ? failed / selected : null);
  return (
    <div className="layout-results-cell">
      <strong>{succeeded} / {selected}</strong>
      <span>
        succeeded
        {failed > 0 ? ` · ${failed} failed (${formatPercent(failureRate)})` : ' · 0 failed'}
      </span>
    </div>
  );
}

function RuntimeResult({ score }: { score: LayoutRunScore | null }) {
  const successful = score?.runtime.pageDuration.successful;
  return (
    <div className="layout-results-cell">
      <strong>{formatDuration(successful?.medianMs)}</strong>
      <span>
        median · {formatDuration(successful?.p95Ms)} p95
        {successful ? ` · ${successful.count} successful pages` : ''}
      </span>
    </div>
  );
}

const STAGE_LABELS: Record<LayoutRuntimeStage, string> = {
  preparationMs: 'prepare',
  engineMs: 'engine',
  inputStageMs: 'mask input (included in engine)',
  normalizationMs: 'normalize',
  overlayMs: 'overlay',
  totalMs: 'total',
  engineUserCpuMs: 'user CPU',
  engineSystemCpuMs: 'system CPU',
  providerModelLoadMs: 'model load',
  providerInferenceMs: 'provider inference',
};

function StageTimingResult({ score }: { score: LayoutRunScore | null }) {
  if (!score) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Unavailable</strong>
        <span>No scorecard for this run</span>
      </div>
    );
  }
  const entries = (Object.entries(score.runtime.stageTimings) as Array<
    [LayoutRuntimeStage, LayoutRunScore['runtime']['stageTimings'][LayoutRuntimeStage]]
  >).filter(([, timing]) => timing.count > 0);
  const engine = score.runtime.stageTimings.engineMs;
  return (
    <div className="layout-results-cell">
      <strong>{formatDuration(engine.medianMs)} engine median</strong>
      <span className="layout-results-detail">
        {entries.length > 0
          ? entries.map(([stage, timing]) => (
            `${STAGE_LABELS[stage]} ${formatDuration(timing.medianMs)} median`
            + ` / ${formatDuration(timing.p95Ms)} p95 (n=${timing.count})`
          )).join(' · ')
          : 'No stage timings recorded'}
      </span>
    </div>
  );
}

function FailureResult({ score }: { score: LayoutRunScore | null }) {
  if (!score) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Unavailable</strong>
        <span>No scorecard for this run</span>
      </div>
    );
  }
  const failed = score.runtime.pageDuration.failed;
  return (
    <div className="layout-results-cell">
      <strong>{score.runtime.failed} failed pages</strong>
      <span>
        failed-page {formatDuration(failed.medianMs)} median
        {' · '}{formatDuration(failed.p95Ms)} p95
      </span>
      <span className="layout-results-detail">
        {score.runtime.failures.length > 0
          ? score.runtime.failures
            .map((failure) => `${failure.stage}:${failure.code} ${failure.count}`)
            .join(' · ')
          : 'No failure stages recorded'}
      </span>
    </div>
  );
}

function WarningResult({ score }: { score: LayoutRunScore | null }) {
  const warnings = Object.entries(score?.runtime.warnings ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1]);
  const total = warnings.reduce((sum, [, count]) => sum + count, 0);
  return (
    <div className="layout-results-cell">
      <strong>{score ? `${total} warnings` : 'Unavailable'}</strong>
      <span className="layout-results-detail">
        {score
          ? warnings.map(([code, count]) => `${code} ${count}`).join(' · ')
            || 'No warnings recorded'
          : 'No scorecard for this run'}
      </span>
    </div>
  );
}

function MemoryResult({ score }: { score: LayoutRunScore | null }) {
  const memory = score?.runtime.memory;
  const methods = Object.keys(memory?.methods ?? {});
  return (
    <div className="layout-results-cell">
      <strong>{formatBytes(memory?.peakRssBytes)}</strong>
      <span>
        peak RSS
        {memory && memory.measuredPages > 0
          ? ` · ${memory.measuredPages} pages${methods.length ? ` · ${methods.join(', ')}` : ''}`
          : ''}
      </span>
    </div>
  );
}

function HumanAssessment({
  runId,
  manualEvidence,
}: {
  runId: string;
  manualEvidence: LayoutHumanSummary | null;
}) {
  if (!manualEvidence) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Quarantined</strong>
        <span>Pair is not eligible for human quality ranking</span>
      </div>
    );
  }
  const assessment = manualEvidence.byRun.find((entry) => entry.runId === runId);
  const wins = manualEvidence.runWins[runId] ?? 0;
  return (
    <div className="layout-results-cell">
      <strong>{assessment?.assessedPages ?? 0} pages</strong>
      <span>
        {wins} human wins · {assessment?.assessmentCount ?? 0} assessments
        {' · '}eligible pages only
      </span>
    </div>
  );
}

function FlagResult({
  runId,
  manualEvidence,
}: {
  runId: string;
  manualEvidence: LayoutHumanSummary | null;
}) {
  if (!manualEvidence) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Quarantined</strong>
        <span>Pair is not eligible for human quality ranking</span>
      </div>
    );
  }
  const flags = manualEvidence.byRun.find((entry) => entry.runId === runId)?.flags;
  return (
    <div className="layout-results-cell">
      <strong>{totalFlags(flags)}</strong>
      <FlagBreakdown flags={flags} />
    </div>
  );
}

function RepairResult({
  runId,
  manualEvidence,
}: {
  runId: string;
  manualEvidence: LayoutHumanSummary | null;
}) {
  if (!manualEvidence) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Quarantined</strong>
        <span>Pair is not eligible for human quality ranking</span>
      </div>
    );
  }
  const repairs = manualEvidence.byRun.find((entry) => entry.runId === runId)?.repairs;
  return (
    <div className="layout-results-cell">
      <strong>{repairs?.total ?? 0}</strong>
      <RepairBreakdown repairs={repairs} />
    </div>
  );
}

function AccuracyResult({ score }: { score: LayoutRunScore | null }) {
  const accuracy = score?.accuracy;
  if (!accuracy || accuracy.availableGroundTruthPages === 0) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Pending</strong>
        <span>No complete human ground truth</span>
      </div>
    );
  }
  return (
    <div className="layout-results-cell">
      <strong>{formatPercent(accuracy.line.f1)} line F1</strong>
      <span>
        {formatPercent(accuracy.region.f1)} region F1
        {' · '}{formatPercent(accuracy.region.classAgreement)} region class
        {' · '}{formatPercent(accuracy.pageBoundary.meanIoU)} boundary IoU
      </span>
      <span>
        {accuracy.eligiblePages}/{accuracy.selectedAnnotatedPages} annotated pages eligible
        {' · '}P {formatPercent(accuracy.line.precision)}
        {' · '}R {formatPercent(accuracy.line.recall)}
      </span>
    </div>
  );
}

function OrientationAccuracyResult({ score }: { score: LayoutRunScore | null }) {
  const accuracy = score?.accuracy;
  if (!accuracy || accuracy.availableGroundTruthPages === 0) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Pending</strong>
        <span>No complete human ground truth</span>
      </div>
    );
  }
  return (
    <div className="layout-results-cell">
      <strong>{formatPercent(accuracy.orientation.accuracy)} orientation</strong>
      <span>
        {accuracy.orientation.correct}/{accuracy.orientation.evaluated} matched lines correct
      </span>
      <span>
        {formatPercent(accuracy.readingOrder.accuracy)} reading order
        {' · '}{accuracy.readingOrder.correctPairs}/
        {accuracy.readingOrder.evaluatedPairs} ordered pairs correct
      </span>
    </div>
  );
}

function ForeignPageResult({ score }: { score: LayoutRunScore | null }) {
  const accuracy = score?.accuracy;
  if (!accuracy || accuracy.availableGroundTruthPages === 0) {
    return (
      <div className="layout-results-cell is-pending">
        <strong>Pending</strong>
        <span>No complete foreign-page annotations</span>
      </div>
    );
  }
  const foreign = accuracy.foreignPage;
  return (
    <div className="layout-results-cell">
      <strong>{foreign.exclusionRegions} annotated exclusion regions</strong>
      <span>
        correctly classified: {foreign.correctlyClassifiedLines} lines
        {' · '}{foreign.correctlyClassifiedRegions} regions
      </span>
      <span>
        target false positives: {foreign.targetFalsePositives}
        {' · '}false exclusions: {foreign.falseExcludedTargetLines} lines
        {' / '}{foreign.falseExcludedRegions} regions
      </span>
    </div>
  );
}

function ResultsTable({
  scorecards,
  leftRun,
  rightRun,
  manualEvidence,
}: {
  scorecards: LayoutScorecardsResponse;
  leftRun: LayoutBenchmarkRunSummary;
  rightRun: LayoutBenchmarkRunSummary;
  manualEvidence: LayoutHumanSummary | null;
}) {
  const leftScore = scoreFor(scorecards, leftRun.runId);
  const rightScore = scoreFor(scorecards, rightRun.runId);
  return (
    <div className="layout-results-table-scroll">
      <table className="layout-results-table">
        <caption>Aggregate benchmark measurements for the selected run pair</caption>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">
              <span className="layout-results-side is-a">A</span>
              {runTitle(leftRun)}
            </th>
            <th scope="col">
              <span className="layout-results-side is-b">B</span>
              {runTitle(rightRun)}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">
              Run coverage
              <span>Failures remain in the denominator</span>
            </th>
            <td><RunSuccess run={leftRun} score={leftScore} /></td>
            <td><RunSuccess run={rightRun} score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Detector runtime
              <span>Successful pages only</span>
            </th>
            <td><RuntimeResult score={leftScore} /></td>
            <td><RuntimeResult score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Stage timings
              <span>Median, p95, and sample count by processing stage</span>
            </th>
            <td><StageTimingResult score={leftScore} /></td>
            <td><StageTimingResult score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Failure disclosure
              <span>Failed-page duration plus failure stage and code</span>
            </th>
            <td><FailureResult score={leftScore} /></td>
            <td><FailureResult score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Peak memory
              <span>RSS; compare like-for-like methods</span>
            </th>
            <td><MemoryResult score={leftScore} /></td>
            <td><MemoryResult score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Warnings
              <span>All recorded warning codes, including successful pages</span>
            </th>
            <td><WarningResult score={leftScore} /></td>
            <td><WarningResult score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Human assessment
              <span>Comparable successful pages for this selected pair only</span>
            </th>
            <td><HumanAssessment runId={leftRun.runId} manualEvidence={manualEvidence} /></td>
            <td><HumanAssessment runId={rightRun.runId} manualEvidence={manualEvidence} /></td>
          </tr>
          <tr>
            <th scope="row">
              Flagged problems
              <span>Comparable successful reviewed pages; lower after equal review is better</span>
            </th>
            <td><FlagResult runId={leftRun.runId} manualEvidence={manualEvidence} /></td>
            <td><FlagResult runId={rightRun.runId} manualEvidence={manualEvidence} /></td>
          </tr>
          <tr>
            <th scope="row">
              Repair actions
              <span>Estimated corrections on comparable successful reviewed pages</span>
            </th>
            <td><RepairResult runId={leftRun.runId} manualEvidence={manualEvidence} /></td>
            <td><RepairResult runId={rightRun.runId} manualEvidence={manualEvidence} /></td>
          </tr>
          <tr>
            <th scope="row">
              Human ground-truth accuracy
              <span>Line, region, and page boundary; complete annotations only</span>
            </th>
            <td><AccuracyResult score={leftScore} /></td>
            <td><AccuracyResult score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Orientation and reading order
              <span>Ground-truth matched lines and ordered pairs</span>
            </th>
            <td><OrientationAccuracyResult score={leftScore} /></td>
            <td><OrientationAccuracyResult score={rightScore} /></td>
          </tr>
          <tr>
            <th scope="row">
              Foreign-page evidence
              <span>Annotated adjacent-page exclusions; complete annotations only</span>
            </th>
            <td><ForeignPageResult score={leftScore} /></td>
            <td><ForeignPageResult score={rightScore} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PairEvidence({
  pair,
  displayedLeftRunId,
}: {
  pair: LayoutPairwiseScore | null;
  displayedLeftRunId: string;
}) {
  const comparable = pair?.pages.filter(
    (page): page is LayoutComparablePageAgreement => page.comparable,
  ) ?? [];
  const orientation = comparable.reduce((totals, page) => ({
    evaluated: totals.evaluated + page.orientationAgreement.evaluated,
    correct: totals.correct + page.orientationAgreement.correct,
  }), { evaluated: 0, correct: 0 });
  const readingOrder = comparable.reduce((totals, page) => ({
    evaluated: totals.evaluated + page.readingOrderAgreement.evaluatedPairs,
    correct: totals.correct + page.readingOrderAgreement.correctPairs,
  }), { evaluated: 0, correct: 0 });
  const pairOrderMatchesDisplay = pair?.leftRunId === displayedLeftRunId;
  const coveragePages = comparable.filter((page) => (
    page.coverage.available
    && page.coverage.leftFraction !== null
    && page.coverage.rightFraction !== null
  ));
  const coverage = coveragePages.reduce((totals, page) => ({
    left: totals.left + (
      pairOrderMatchesDisplay ? page.coverage.leftFraction! : page.coverage.rightFraction!
    ),
    right: totals.right + (
      pairOrderMatchesDisplay ? page.coverage.rightFraction! : page.coverage.leftFraction!
    ),
  }), { left: 0, right: 0 });
  const derivedCoverage = comparable.reduce((totals, page) => {
    if (page.coverage.available) return totals;
    const displayAAvailable = pairOrderMatchesDisplay
      ? page.coverage.leftAvailable
      : page.coverage.rightAvailable;
    const displayBAvailable = pairOrderMatchesDisplay
      ? page.coverage.rightAvailable
      : page.coverage.leftAvailable;
    return {
      pages: totals.pages + 1,
      a: totals.a + (displayAAvailable ? 0 : 1),
      b: totals.b + (displayBAvailable ? 0 : 1),
    };
  }, { pages: 0, a: 0, b: 0 });
  const coverageCount = coveragePages.length;
  const derivedCoverageMessage = derivedCoverage.pages > 0
    ? `Derived baseline envelopes excluded ${derivedCoverage.pages} page${
      derivedCoverage.pages === 1 ? '' : 's'
    } (A ${derivedCoverage.a} · B ${derivedCoverage.b}).`
    : 'No comparable provider-polygon coverage pages.';

  return (
    <section className="layout-results-evidence" aria-label="Pair evidence">
      <div>
        <span>Orientation agreement</span>
        <strong>
          {formatPercent(
            orientation.evaluated > 0 ? orientation.correct / orientation.evaluated : null,
          )}
        </strong>
        <small>{orientation.correct}/{orientation.evaluated} matched lines</small>
      </div>
      <div>
        <span>Reading-order agreement</span>
        <strong>
          {formatPercent(
            readingOrder.evaluated > 0
              ? readingOrder.correct / readingOrder.evaluated
              : null,
          )}
        </strong>
        <small>{readingOrder.correct}/{readingOrder.evaluated} ordered pairs</small>
      </div>
      <div>
        <span>Mean page coverage</span>
        {coverageCount > 0 ? (
          <>
            <strong>
              A {formatPercent(coverage.left / coverageCount)}
              {' · '}B {formatPercent(coverage.right / coverageCount)}
            </strong>
            <small>
              Union of provider line bounding boxes
              {derivedCoverage.pages > 0
                ? ` · ${derivedCoverage.pages} derived-geometry page${
                  derivedCoverage.pages === 1 ? '' : 's'
                } excluded`
                : ''}
            </small>
          </>
        ) : (
          <>
            <strong>Unavailable</strong>
            <small>{derivedCoverageMessage}</small>
          </>
        )}
      </div>
      <div>
        <span>Coverage difference</span>
        {pair?.aggregate.meanCoverageAbsoluteDelta !== null
          && pair?.aggregate.meanCoverageAbsoluteDelta !== undefined ? (
            <>
              <strong>{formatPercent(pair.aggregate.meanCoverageAbsoluteDelta)}</strong>
              <small>
                Mean absolute A/B page-coverage delta
                {pair.aggregate.coverageUnavailablePages > 0
                  ? ` · ${pair.aggregate.coverageUnavailablePages} derived-geometry page${
                    pair.aggregate.coverageUnavailablePages === 1 ? '' : 's'
                  } excluded`
                  : ''}
              </small>
            </>
          ) : (
            <>
              <strong>Unavailable</strong>
              <small>{derivedCoverageMessage}</small>
            </>
          )}
      </div>
    </section>
  );
}

function BreakdownTable({
  label,
  groupLabel,
  rows,
}: {
  label: string;
  groupLabel: string;
  rows: LayoutBreakdownRow[];
}) {
  return (
    <section className="layout-results-breakdown-section">
      <header>
        <strong>{label}</strong>
        <span>{rows.length} groups</span>
      </header>
      <div className="layout-results-breakdown-scroll">
        <table className="layout-results-breakdown-table">
          <caption>Benchmark breakdown by {groupLabel.toLowerCase()}</caption>
          <thead>
            <tr>
              <th scope="col">{groupLabel}</th>
              <th scope="col">Pages</th>
              <th scope="col">Reviewed</th>
              <th scope="col">Human outcome</th>
              <th scope="col">Line proxy</th>
              <th scope="col">Region proxy</th>
              <th scope="col">Boundary proxy</th>
              <th scope="col">Repairs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td>
                  <strong>{row.cohortPages}</strong> cohort
                  {' · '}
                  <strong>{row.eligiblePages}</strong> eligible
                  {' · '}
                  <strong>{row.comparablePages ?? '—'}</strong> comparable
                </td>
                <td>{row.reviewedPages ?? '—'}</td>
                <td>
                  {row.outcomes && row.reviewedPages
                    ? `A ${row.outcomes.left} · B ${row.outcomes.right} · T ${row.outcomes.tie} · N ${row.outcomes.neither}`
                    : 'Pending'}
                </td>
                <td>{formatPercent(row.lineAgreement)}</td>
                <td>
                  {formatPercent(row.regionAgreement)} geometry
                  {' · '}{formatPercent(row.regionClassAgreement)} class
                </td>
                <td>{formatPercent(row.pageBoundaryAgreement)} IoU</td>
                <td>
                  {row.repairs
                    ? `A ${row.repairs.left} · B ${row.repairs.right}`
                    : 'A — · B —'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CohortBreakdowns({
  pages,
  pair,
  decisions,
  leftRun,
  rightRun,
}: {
  pages: LayoutBenchmarkPageSummary[];
  pair: LayoutPairwiseScore | null;
  decisions: Map<string, NormalizedPairDecision> | null;
  leftRun: LayoutBenchmarkRunSummary;
  rightRun: LayoutBenchmarkRunSummary;
}) {
  const collections = breakdownRows(
    collectionGroups(pages),
    pair,
    decisions,
    leftRun,
    rightRun,
  );
  const challenges = breakdownRows(
    challengeGroups(pages),
    pair,
    decisions,
    leftRun,
    rightRun,
  );
  return (
    <details className="layout-results-breakdowns">
      <summary>
        <span>
          <strong>Cohort breakdowns</strong>
          <small>
            Find where one engine helps: agreement is geometry similarity, not accuracy.
          </small>
        </span>
        <span>
          {collections.length} collections · {challenges.length} challenges
        </span>
      </summary>
      <div className="layout-results-breakdown-body">
        <div className="layout-results-breakdown-legend">
          <span>
            <strong>Eligible</strong> = both runs succeeded on identical prepared pixels
            with the same preprocessing-profile SHA-256.
          </span>
          <span>
            <strong>Comparable</strong> = a pairwise metric could be produced from both layouts.
          </span>
          <span>Challenge groups overlap; a page may appear in more than one row.</span>
        </div>
        <BreakdownTable
          label="By collection"
          groupLabel="Collection"
          rows={collections}
        />
        {challenges.length > 0 ? (
          <BreakdownTable
            label="By challenge"
            groupLabel="Challenge"
            rows={challenges}
          />
        ) : (
          <div className="layout-results-state">No challenge tags are defined for this cohort.</div>
        )}
      </div>
    </details>
  );
}

export default function LayoutResultsSummary({
  scorecards,
  leftRun,
  rightRun,
  pages = [],
  evaluation,
  error,
  revealIdentity = true,
  qualityRankable = true,
}: LayoutResultsSummaryProps) {
  if (!revealIdentity) {
    return (
      <section
        className="layout-results-summary layout-results-locked"
        aria-label="Aggregate results locked"
      >
        <span className="layout-results-summary-title">
          <span className="layout-results-eyebrow">Blind review active</span>
          <strong>Save this page’s verdict to reveal run identities and results</strong>
        </span>
      </section>
    );
  }

  const profilesMatch = preprocessingProfilesMatch(leftRun, rightRun);
  const pairEligible = profilesMatch && qualityRankable;
  const rawPair = scorecards
    ? pairFor(scorecards, leftRun.runId, rightRun.runId)
    : null;
  const pair = pairEligible ? rawPair : null;
  const comparablePages = pairEligible ? pair?.aggregate.comparablePages : 0;
  const incomparablePages = pairEligible
    ? pair?.aggregate.incomparablePages
    : rawPair
      ? rawPair.aggregate.comparablePages + rawPair.aggregate.incomparablePages
      : pages.length;
  const lineCounts = pair?.aggregate.lines;
  const lineDenominator = (lineCounts?.left ?? 0) + (lineCounts?.right ?? 0);
  const lineAgreement = lineCounts && lineDenominator > 0
    ? (2 * lineCounts.matched) / lineDenominator
    : null;
  const regionCounts = pair?.aggregate.regions;
  const regionDenominator = (regionCounts?.left ?? 0) + (regionCounts?.right ?? 0);
  const regionAgreement = regionCounts && regionDenominator > 0
    ? (2 * regionCounts.matched) / regionDenominator
    : null;
  const regionClassAgreement = regionCounts?.classEvaluated
    ? regionCounts.classMatches / regionCounts.classEvaluated
    : null;
  const pageBoundaryAgreement = pair?.aggregate.pageBoundary.meanIoU ?? null;
  const pairDecisions = decisionsForPair(
    evaluation,
    leftRun.runId,
    rightRun.runId,
  );
  const eligiblePageKeys = new Set(
    pair?.pages.flatMap((page) => (
      page.comparable ? [page.pageKey] : []
    )) ?? [],
  );
  const hasEligibilityContext = Boolean(evaluation && pages.length > 0);
  const manualEvidence = pairEligible
    ? pairDecisions && hasEligibilityContext
      ? summarizeManualEvidence(
        pairDecisions,
        eligiblePageKeys,
        leftRun.runId,
        rightRun.runId,
      )
      : scorecards?.human ?? null
    : null;
  const frontendQuarantinedDecisionCount = pairDecisions
    ? pairEligible
      ? [...pairDecisions.keys()].filter((pageKey) => !eligiblePageKeys.has(pageKey)).length
      : pairDecisions.size
    : 0;
  const backendQuarantinedDecisionCount = pairEligible
    ? scorecards?.human.excludedDecisionCount ?? 0
    : (scorecards?.human.decisionCount ?? 0)
      + (scorecards?.human.excludedDecisionCount ?? 0);
  const quarantinedDecisionCount = Math.max(
    frontendQuarantinedDecisionCount,
    backendQuarantinedDecisionCount,
  );
  const excludedReasonSummary = Object.entries(scorecards?.human.excludedReasons ?? {})
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason.replaceAll('_', ' ')} ${count}`)
    .join(' · ');
  const incomparableReasonSummary = Object.entries(pair?.aggregate.reasons ?? {})
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason.replaceAll('_', ' ')} ${count}`)
    .join(' · ');
  const reviewedPages = manualEvidence?.reviewedPages ?? 0;
  const decisions = manualEvidence?.decisionCount ?? 0;
  const leftWins = manualEvidence?.runWins[leftRun.runId] ?? 0;
  const rightWins = manualEvidence?.runWins[rightRun.runId] ?? 0;
  const ties = manualEvidence?.preferences.tie ?? 0;
  const neither = manualEvidence?.preferences.neither ?? 0;
  const truthPages = scorecards
    ? Math.max(...scorecards.runs.map((run) => run.accuracy.availableGroundTruthPages), 0)
    : 0;

  return (
    <details className="layout-results-summary">
      <summary>
        <span className="layout-results-summary-title">
          <span className="layout-results-eyebrow">Selected run pair</span>
          <strong>Aggregate results</strong>
        </span>
        <span className="layout-results-summary-stat">
          <strong>{scorecards && qualityRankable ? reviewedPages : '—'}</strong>
          <span>reviewed</span>
        </span>
        <span className="layout-results-summary-stat">
          <strong>{comparablePages ?? '—'}</strong>
          <span>comparable</span>
        </span>
        <span className="layout-results-summary-stat">
          <strong>
            {qualityRankable
              ? scorecards ? `${leftWins}–${rightWins}` : '—'
              : 'Not ranked'}
          </strong>
          <span>A–B wins</span>
        </span>
        <span className="layout-results-summary-action" aria-hidden="true">
          View summary
        </span>
      </summary>

      <div className="layout-results-body">
        {error ? (
          <div className="layout-results-state is-error" role="alert">
            <strong>Aggregate metrics unavailable</strong>
            <span>{error}</span>
          </div>
        ) : !scorecards ? (
          <div className="layout-results-state" aria-live="polite">
            Calculating aggregate metrics…
          </div>
        ) : (
          <>
            {!qualityRankable ? (
              <div className="layout-results-quarantine" role="status">
                <strong>Diagnostic profile excluded from quality ranking.</strong>
                <span>
                  One or both selected runs declare equivalentToDefaultProfile=false.
                  Per-run runtime, failure, and artifact evidence remain visible for diagnosis;
                  pair agreement and human outcomes are not ranked.
                </span>
              </div>
            ) : !profilesMatch ? (
              <div className="layout-results-quarantine" role="status">
                <strong>Pair evidence quarantined.</strong>
                <span>
                  Run A and Run B have different preprocessing-profile SHA-256 values.
                  Pair metrics and {quarantinedDecisionCount} historical decisions are excluded;
                  per-run runtime and ground-truth measurements remain visible.
                  {excludedReasonSummary ? ` Reasons: ${excludedReasonSummary}.` : ''}
                </span>
              </div>
            ) : quarantinedDecisionCount > 0 ? (
              <div className="layout-results-quarantine" role="status">
                <strong>{quarantinedDecisionCount} historical decisions excluded.</strong>
                <span>
                  Manual summaries include only pages where both selected runs succeeded on
                  identical prepared pixels.
                  {excludedReasonSummary ? ` Reasons: ${excludedReasonSummary}.` : ''}
                </span>
              </div>
            ) : null}
            <section className="layout-results-overview" aria-label="Pair results">
              <div className="layout-results-kpi is-comparability">
                <span>Comparable output</span>
                <strong>{comparablePages ?? '—'} pages</strong>
                <small>
                  {incomparablePages ?? '—'} incomparable
                  {incomparableReasonSummary ? ` · ${incomparableReasonSummary}` : ''}
                </small>
              </div>
              <div className="layout-results-kpi">
                <span>Human outcomes</span>
                <strong>{decisions} decisions</strong>
                <small>
                  A {leftWins} · B {rightWins} · tie {ties} · neither {neither}
                </small>
              </div>
              <div className="layout-results-kpi">
                <span>Human review time</span>
                <strong>{formatDuration(manualEvidence?.timing.medianMs)} median</strong>
                <small>
                  {formatDuration(manualEvidence?.timing.p95Ms)} p95
                  {' · '}{manualEvidence?.timing.count ?? 0} measured
                  {' · '}eligible reviews only
                </small>
              </div>
              <div className="layout-results-kpi is-proxy">
                <span>Engine agreement proxy</span>
                <strong>{formatPercent(lineAgreement)} line F1</strong>
                <small>
                  {formatPercent(regionAgreement)} region F1
                  {' · '}{formatPercent(regionClassAgreement)} class
                  {' · '}{formatPercent(pageBoundaryAgreement)} boundary IoU
                  {' · '}not accuracy
                </small>
              </div>
            </section>

            <PairEvidence
              pair={pair}
              displayedLeftRunId={leftRun.runId}
            />

            <div className={`layout-results-truth ${truthPages > 0 ? 'is-ready' : ''}`}>
              <strong>
                {truthPages > 0
                  ? `Human ground-truth accuracy available on up to ${truthPages} complete pages.`
                  : 'Human ground-truth accuracy is pending.'}
              </strong>
              <span>
                Line, region, region-class, page-boundary, orientation, reading-order, and
                foreign-page accuracy require complete human annotations. Until those annotations
                exist, ground-truth accuracy remains pending. Engine-to-engine agreement only
                measures similarity; it does not prove either engine is correct.
              </span>
            </div>

            <ResultsTable
              scorecards={scorecards}
              leftRun={leftRun}
              rightRun={rightRun}
              manualEvidence={manualEvidence}
            />

            {pages.length > 0 ? (
              <CohortBreakdowns
                pages={pages}
                pair={pair}
                decisions={pairEligible ? pairDecisions : new Map()}
                leftRun={leftRun}
                rightRun={rightRun}
              />
            ) : null}

            <footer className="layout-results-footer">
              <span>
                Mean reviewer confidence:{' '}
                <strong>
                  {manualEvidence?.confidence.mean == null
                    ? '—'
                    : `${manualEvidence.confidence.mean.toFixed(1)} / 5`}
                </strong>
                {' · '}{manualEvidence?.confidence.count ?? 0} measured
                {' · '}comparable successful pages only
              </span>
              <span>
                Calculated {new Date(scorecards.generatedAt).toLocaleString()}
              </span>
            </footer>
          </>
        )}
      </div>
    </details>
  );
}
