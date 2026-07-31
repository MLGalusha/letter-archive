import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getLayoutBenchmarkLayout,
  getLayoutBenchmarkImageObjectUrl,
  getLayoutBenchmarkArtifactText,
  getLayoutBenchmarkOverview,
  getLayoutBenchmarkPage,
  getLayoutBenchmarkPages,
  getLayoutBenchmarkRuns,
  getLayoutScorecards,
  getMyLayoutEvaluations,
  putMyLayoutEvaluation,
  resolveLayoutArtifactUrl,
  type LayoutBenchmarkOverview,
  type LayoutBenchmarkPageResponse,
  type LayoutBenchmarkPageSummary,
  type LayoutBenchmarkRunSummary,
  type LayoutEvaluationDecision,
  type LayoutEvaluationDecisionInput,
  type LayoutEvaluationResponse,
  type LayoutPageAgreement,
  type LayoutRepairCounts,
  type LayoutScorecardsResponse,
  type NormalizedLayout,
} from '../../api/admin/layoutBenchmark';
import { getErrorMessage } from '../../api/client';
import AdminLayout from '../../components/AdminLayout/AdminLayout';
import { Button } from '../../components/common';
import { useToast } from '../../contexts/ToastContext';
import EvaluationPanel from './LayoutBenchmark/EvaluationPanel';
import LayoutCanvas from './LayoutBenchmark/LayoutCanvas';
import LayoutResultsSummary from './LayoutBenchmark/LayoutResultsSummary';
import { createBlindAssignment } from './LayoutBenchmark/blindAssignment';
import {
  pageHasInspectableRunPair,
  pageHasPotentialRunPair,
  preparedRastersMatch,
  PREPROCESSING_PROFILE_MISMATCH_REASON,
  preprocessingProfilesMatch,
  runIsQualityRankable,
} from './LayoutBenchmark/comparability';
import {
  earlierRunCount,
  formatRunDate,
  pairMatchesPreset,
  resolveComparisonPresets,
  runOptionGroups,
  runOptionLabel,
  runPresentation,
  runStatusLabel,
  type RunOptionGroup,
} from './LayoutBenchmark/runPresentation';
import { useReviewTimer } from './LayoutBenchmark/useReviewTimer';
import './LayoutBenchmarkPage.css';

const ENGINE_COLORS = {
  left: '#1876d2',
  right: '#d1495b',
};

type StageMode = 'split' | 'single';
type SingleCanvasCandidate = 'a' | 'both' | 'b';

function isFormOrTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    'input, textarea, select, option, button, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
  ));
}

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

function emptyDecision(
  leftRunId: string,
  rightRunId: string,
): LayoutEvaluationDecisionInput {
  return {
    leftRunId,
    rightRunId,
    preference: 'unreviewed',
    assessments: {
      left: { flags: [], repairs: { ...EMPTY_REPAIRS } },
      right: { flags: [], repairs: { ...EMPTY_REPAIRS } },
    },
    confidence: 3,
    notes: '',
  };
}

function toDecisionInput(
  decision: LayoutEvaluationDecision | undefined,
  leftRunId: string,
  rightRunId: string,
): LayoutEvaluationDecisionInput {
  if (!decision) return emptyDecision(leftRunId, rightRunId);
  return {
    leftRunId,
    rightRunId,
    preference: decision.preference,
    assessments: {
      left: {
        flags: [...decision.assessments.left.flags],
        repairs: { ...decision.assessments.left.repairs },
      },
      right: {
        flags: [...decision.assessments.right.flags],
        repairs: { ...decision.assessments.right.repairs },
      },
    },
    elapsedMs: decision.elapsedMs,
    confidence: decision.confidence ?? 3,
    notes: decision.notes ?? '',
  };
}

function chooseInitialPair(
  runs: LayoutBenchmarkRunSummary[],
  pages: LayoutBenchmarkPageSummary[],
): [string, string] {
  const usable = runs.filter((run) => run.succeeded > 0 && runIsQualityRankable(run));
  const candidates: Array<{
    left: LayoutBenchmarkRunSummary;
    right: LayoutBenchmarkRunSummary;
    comparablePages: number;
    distinctEngines: boolean;
    enginePreference: number;
    recencyRank: number;
  }> = [];

  for (let leftIndex = 0; leftIndex < usable.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < usable.length; rightIndex += 1) {
      const first = usable[leftIndex];
      const second = usable[rightIndex];
      const engineIds = new Set([first.engineId, second.engineId]);
      const ordered = first.engineId === 'kraken6'
        ? [first, second]
        : second.engineId === 'kraken6'
          ? [second, first]
          : [first, second];
      candidates.push({
        left: ordered[0],
        right: ordered[1],
        comparablePages: pages.filter((page) => (
          pageHasPotentialRunPair(page, ordered[0], ordered[1])
        )).length,
        distinctEngines: engineIds.size === 2,
        enginePreference: engineIds.has('kraken6') && engineIds.has('eynollah')
          ? 3
          : engineIds.has('kraken6') && engineIds.has('kraken7')
            ? 2
            : engineIds.size === 2
              ? 1
              : 0,
        recencyRank: -(leftIndex + rightIndex),
      });
    }
  }

  const overlappingDistinct = candidates.filter((candidate) => (
    candidate.distinctEngines && candidate.comparablePages > 0
  ));
  const overlapping = candidates.filter((candidate) => candidate.comparablePages > 0);
  const pool = overlappingDistinct.length > 0
    ? overlappingDistinct
    : overlapping.length > 0
      ? overlapping
      : candidates;
  const best = [...pool].sort((a, b) => (
    b.comparablePages - a.comparablePages
    || Number(b.distinctEngines) - Number(a.distinctEngines)
    || b.enginePreference - a.enginePreference
    || b.recencyRank - a.recencyRank
  ))[0];
  return [best?.left.runId ?? '', best?.right.runId ?? ''];
}

function RunSelectOptions({ groups }: { groups: RunOptionGroup[] }) {
  return groups.map((group) => (
    <optgroup key={group.id} label={group.label}>
      {group.options.map(({ run, earlier }) => (
        <option key={run.runId} value={run.runId}>
          {runOptionLabel(run, earlier)}
        </option>
      ))}
    </optgroup>
  ));
}

function SelectedRunSummary({
  id,
  run,
}: {
  id: string;
  run: LayoutBenchmarkRunSummary;
}) {
  const presentation = runPresentation(run);
  return (
    <article id={id} className="layout-selected-run">
      <div className="layout-selected-run-heading">
        <strong>{presentation.name}</strong>
        <span>{runStatusLabel(run)}</span>
      </div>
      <p>{presentation.purpose}</p>
      <div className="layout-selected-run-meta">
        <span>
          {runIsQualityRankable(run) ? 'Quality-ranking run' : 'Diagnostic — view only'}
        </span>
        <span>{formatRunDate(run.createdAt)}</span>
        <details>
          <summary>Run details</summary>
          <dl>
            <div>
              <dt>Run ID</dt>
              <dd><code>{run.runId}</code></dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{run.engineId}</dd>
            </div>
            <div>
              <dt>Versions</dt>
              <dd>
                engine {run.engineVersion}
                {' · '}
                adapter {run.adapterVersion}
              </dd>
            </div>
            <div>
              <dt>Input profile</dt>
              <dd><code>{run.preprocessingProfileId}</code></dd>
            </div>
          </dl>
        </details>
      </div>
    </article>
  );
}

function decisionIdentity(
  pageKey: string,
  leftRunId: string,
  rightRunId: string,
): string {
  return `${pageKey}::${leftRunId}::${rightRunId}`;
}

function findDecision(
  evaluation: LayoutEvaluationResponse | null,
  pageKey: string,
  leftRunId: string,
  rightRunId: string,
): LayoutEvaluationDecision | undefined {
  const exact = evaluation?.evaluation.decisions.find((decision) => (
    decision.pageKey === pageKey
    && decision.leftRunId === leftRunId
    && decision.rightRunId === rightRunId
  ));
  if (exact) return exact;

  const reversed = evaluation?.evaluation.decisions.find((decision) => (
    decision.pageKey === pageKey
    && decision.leftRunId === rightRunId
    && decision.rightRunId === leftRunId
  ));
  if (!reversed) return undefined;

  return {
    ...reversed,
    leftRunId,
    rightRunId,
    preference: reversed.preference === 'left'
      ? 'right'
      : reversed.preference === 'right'
        ? 'left'
        : reversed.preference,
    assessments: {
      left: reversed.assessments.right,
      right: reversed.assessments.left,
    },
  };
}

function pageAgreementFor(
  scorecards: LayoutScorecardsResponse | null,
  pageKey: string,
  leftRun: LayoutBenchmarkRunSummary | null,
  rightRun: LayoutBenchmarkRunSummary | null,
): LayoutPageAgreement | null {
  if (!leftRun || !rightRun) return null;
  if (!preprocessingProfilesMatch(leftRun, rightRun)) {
    return {
      pageKey,
      comparable: false,
      reason: PREPROCESSING_PROFILE_MISMATCH_REASON,
    };
  }
  const comparison = scorecards?.pairwise.find((pair) => (
    (
      pair.leftRunId === leftRun.runId
      && pair.rightRunId === rightRun.runId
    ) || (
      pair.leftRunId === rightRun.runId
      && pair.rightRunId === leftRun.runId
    )
  ));
  return comparison?.pages.find((page) => page.pageKey === pageKey) ?? null;
}

function isPreparedPairComparable(
  page: LayoutBenchmarkPageResponse | null,
  leftRun: LayoutBenchmarkRunSummary | null,
  rightRun: LayoutBenchmarkRunSummary | null,
): boolean {
  if (!leftRun || !rightRun || !preprocessingProfilesMatch(leftRun, rightRun)) {
    return false;
  }
  const leftPageRun = page?.page.runs.find((run) => run.runId === leftRun.runId);
  const rightPageRun = page?.page.runs.find((run) => run.runId === rightRun.runId);
  return Boolean(
    leftPageRun?.prepared
    && rightPageRun?.prepared
    && leftPageRun.preprocessingProfileSha256 === leftRun.preprocessingProfileSha256
    && rightPageRun.preprocessingProfileSha256 === rightRun.preprocessingProfileSha256
    && preparedRastersMatch(leftPageRun.prepared, rightPageRun.prepared),
  );
}

function firstComparablePageKey(
  pages: LayoutBenchmarkPageSummary[],
  leftRun: LayoutBenchmarkRunSummary | null | undefined,
  rightRun: LayoutBenchmarkRunSummary | null | undefined,
): string | undefined {
  return pages.find((page) => (
    pageHasPotentialRunPair(page, leftRun, rightRun)
  ))?.pageKey;
}

function firstInspectablePageKey(
  pages: LayoutBenchmarkPageSummary[],
  leftRun: LayoutBenchmarkRunSummary | null | undefined,
  rightRun: LayoutBenchmarkRunSummary | null | undefined,
): string | undefined {
  return pages.find((page) => (
    pageHasInspectableRunPair(page, leftRun, rightRun)
  ))?.pageKey;
}

function pageMatchesFilters(
  page: LayoutBenchmarkPageSummary,
  collection: string,
  challenge: string,
): boolean {
  return (
    (!collection || page.collectionCode === collection)
    && (!challenge || page.challengeTags.includes(challenge))
  );
}

function RunArtifactLinks({
  side,
  pageRun,
  onDownloadArtifact,
}: {
  side: 'A' | 'B';
  pageRun: LayoutBenchmarkPageSummary['runs'][number] | undefined;
  onDownloadArtifact: (url: string, label: string) => void;
}) {
  const artifacts = [
    ['Failure report', pageRun?.errorUrl],
    ['Rendered overlay', pageRun?.overlayUrl],
    ['Page mask', pageRun?.pageMaskUrl],
    ['Masked engine input', pageRun?.engineInputUrl],
    ['Mask provenance', pageRun?.inputStageUrl],
    ['Normalized layout', pageRun?.layoutUrl],
    ['Raw provider output', pageRun?.rawUrl],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (artifacts.length === 0) return null;

  return (
    <nav className="layout-run-artifacts" aria-label={`${side} artifact evidence`}>
      {artifacts.map(([label, url]) => {
        const isImageArtifact = url.includes('/images/');
        return (
          <a
            key={label}
            href={resolveLayoutArtifactUrl(url)}
            target={isImageArtifact ? '_blank' : undefined}
            rel={isImageArtifact ? 'noreferrer' : undefined}
            download={isImageArtifact ? undefined : ''}
            onClick={isImageArtifact
              ? undefined
              : (event) => {
                event.preventDefault();
                onDownloadArtifact(url, label);
              }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}

function RunUnavailable({
  side,
  run,
  pageRun,
  layoutError,
  revealIdentity,
  onDownloadArtifact,
}: {
  side: 'A' | 'B';
  run: LayoutBenchmarkRunSummary;
  pageRun: LayoutBenchmarkPageSummary['runs'][number] | undefined;
  layoutError?: string;
  revealIdentity: boolean;
  onDownloadArtifact: (url: string, label: string) => void;
}) {
  const showDiagnosticIdentity = revealIdentity || pageRun?.status === 'failed';

  return (
    <article className="layout-run-unavailable">
      <span className="layout-eyebrow">
        {showDiagnosticIdentity ? `${side} · ${run.engineId}` : `Run ${side}`}
      </span>
      <h3>{pageRun?.status === 'failed' ? 'Provider output failed' : 'No comparable output'}</h3>
      <p>
        {!showDiagnosticIdentity
          ? 'This candidate did not produce a comparable output for the selected page.'
          : pageRun?.error?.message
            ?? layoutError
            ?? (pageRun?.status === 'failed'
              ? 'This engine failed on the selected page. Its failure remains in the run metrics.'
              : 'This page was not successfully produced by this run.')}
      </p>
      {showDiagnosticIdentity ? (
        <RunArtifactLinks
          side={side}
          pageRun={pageRun}
          onDownloadArtifact={onDownloadArtifact}
        />
      ) : null}
      {showDiagnosticIdentity && pageRun?.error ? (
        <details open>
          <summary>Failure detail</summary>
          <pre>{JSON.stringify(pageRun.error, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

export default function LayoutBenchmarkPage() {
  const { showToast } = useToast();
  const [overview, setOverview] = useState<LayoutBenchmarkOverview | null>(null);
  const [pages, setPages] = useState<LayoutBenchmarkPageSummary[]>([]);
  const [runs, setRuns] = useState<LayoutBenchmarkRunSummary[]>([]);
  const [evaluation, setEvaluation] = useState<LayoutEvaluationResponse | null>(null);
  const [scorecards, setScorecards] = useState<LayoutScorecardsResponse | null>(null);
  const [selectedPageKey, setSelectedPageKey] = useState('');
  const [leftRunId, setLeftRunId] = useState('');
  const [rightRunId, setRightRunId] = useState('');
  const [pageDetail, setPageDetail] = useState<LayoutBenchmarkPageResponse | null>(null);
  const [layouts, setLayouts] = useState<Record<string, NormalizedLayout>>({});
  const [preparedImageUrls, setPreparedImageUrls] = useState<Record<string, string>>({});
  const [loadedLayoutIdentity, setLoadedLayoutIdentity] = useState('');
  const [layoutErrors, setLayoutErrors] = useState<Record<string, string>>({});
  const [imageStates, setImageStates] = useState<Record<string, 'ready' | 'error'>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [draftState, setDraftState] = useState<{
    identity: string;
    value: LayoutEvaluationDecisionInput;
  }>(() => ({ identity: '', value: emptyDecision('', '') }));
  const [loading, setLoading] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [scorecardError, setScorecardError] = useState<string | null>(null);
  const [stageMode, setStageMode] = useState<StageMode>('split');
  const [singleCanvasCandidate, setSingleCanvasCandidate] = useState<SingleCanvasCandidate>('both');
  const [showLines, setShowLines] = useState(true);
  const [showPageBoundary, setShowPageBoundary] = useState(true);
  const [showRegions, setShowRegions] = useState(false);
  const [showReadingOrder, setShowReadingOrder] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.9);
  const [zoom, setZoom] = useState(1);
  const [collectionFilter, setCollectionFilter] = useState('');
  const [challengeFilter, setChallengeFilter] = useState('');
  const [showEarlierRuns, setShowEarlierRuns] = useState(false);

  const selectedIndex = pages.findIndex((page) => page.pageKey === selectedPageKey);
  const selectedPage = pages[selectedIndex] ?? null;
  const leftRun = runs.find((run) => run.runId === leftRunId) ?? null;
  const rightRun = runs.find((run) => run.runId === rightRunId) ?? null;
  const comparisonPresets = useMemo(() => resolveComparisonPresets(runs), [runs]);
  const activeComparisonPreset = comparisonPresets.find((preset) => (
    pairMatchesPreset(preset, leftRunId, rightRunId)
  )) ?? null;
  const hiddenEarlierRunCount = useMemo(() => earlierRunCount(runs), [runs]);
  const leftRunOptionGroups = useMemo(() => runOptionGroups(runs, {
    excludeRunId: rightRunId,
    selectedRunId: leftRunId,
    showEarlier: showEarlierRuns,
  }), [leftRunId, rightRunId, runs, showEarlierRuns]);
  const rightRunOptionGroups = useMemo(() => runOptionGroups(runs, {
    excludeRunId: leftRunId,
    selectedRunId: rightRunId,
    showEarlier: showEarlierRuns,
  }), [leftRunId, rightRunId, runs, showEarlierRuns]);
  const profilesMatch = preprocessingProfilesMatch(leftRun, rightRun);
  const pairQualityRankable = runIsQualityRankable(leftRun) && runIsQualityRankable(rightRun);
  const selectedPairHasFailure = Boolean(
    selectedPage
    && pageHasInspectableRunPair(selectedPage, leftRun, rightRun)
    && [leftRunId, rightRunId].some((runId) => (
      selectedPage.runs.find((run) => run.runId === runId)?.status === 'failed'
    )),
  );
  const savedDecision = useMemo(() => (
    profilesMatch
      ? findDecision(evaluation, selectedPageKey, leftRunId, rightRunId)
      : undefined
  ), [evaluation, leftRunId, profilesMatch, rightRunId, selectedPageKey]);
  const identity = decisionIdentity(selectedPageKey, leftRunId, rightRunId);
  const blindAssignment = useMemo(() => (
    selectedPageKey && leftRunId && rightRunId && leftRunId !== rightRunId
      ? createBlindAssignment(selectedPageKey, leftRunId, rightRunId)
      : null
  ), [leftRunId, rightRunId, selectedPageKey]);
  const displayARun = blindAssignment?.aCanonicalSide === 'right' ? rightRun : leftRun;
  const displayBRun = blindAssignment?.bCanonicalSide === 'left' ? leftRun : rightRun;
  const diagnosticOnly = selectedPairHasFailure || !pairQualityRankable;
  const revealIdentity = Boolean(savedDecision) || diagnosticOnly;
  const draft = draftState.identity === identity
    ? draftState.value
    : toDecisionInput(savedDecision, leftRunId, rightRunId);
  const setDraft = useCallback((value: LayoutEvaluationDecisionInput) => {
    setDraftState({ identity, value });
  }, [identity]);
  const presentationDraft = useMemo(
    () => blindAssignment?.toPresentationDecision(draft) ?? draft,
    [blindAssignment, draft],
  );
  const setPresentationDraft = useCallback((value: LayoutEvaluationDecisionInput) => {
    setDraft(blindAssignment?.toCanonicalDecision(value) ?? value);
  }, [blindAssignment, setDraft]);
  const timer = useReviewTimer(identity, savedDecision?.elapsedMs ?? 0);
  const imageKey = useCallback((runId: string) => `${identity}::${runId}`, [identity]);
  const recordImageLoad = useCallback((
    runId: string,
    expected: { width: number; height: number },
    image: HTMLImageElement,
  ) => {
    const key = imageKey(runId);
    if (
      image.naturalWidth !== expected.width
      || image.naturalHeight !== expected.height
    ) {
      timer.pause();
      setImageStates((current) => ({ ...current, [key]: 'error' }));
      setImageErrors((current) => ({
        ...current,
        [key]: `Prepared image dimensions are ${image.naturalWidth}×${image.naturalHeight}; the run declares ${expected.width}×${expected.height}.`,
      }));
      return;
    }
    setImageStates((current) => ({ ...current, [key]: 'ready' }));
    setImageErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [imageKey, timer]);
  const recordImageError = useCallback((runId: string) => {
    const key = imageKey(runId);
    timer.pause();
    setImageStates((current) => ({ ...current, [key]: 'error' }));
    setImageErrors((current) => ({
      ...current,
      [key]: 'The prepared scan could not be loaded. Restore the image session or inspect the run artifact.',
    }));
  }, [imageKey, timer]);
  const downloadArtifact = useCallback(async (url: string, label: string) => {
    try {
      const contents = await getLayoutBenchmarkArtifactText(url);
      const objectUrl = URL.createObjectURL(new Blob([contents], {
        type: 'text/plain;charset=utf-8',
      }));
      const anchor = document.createElement('a');
      const filenameLabel = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
      anchor.href = objectUrl;
      anchor.download = `${selectedPageKey}-${filenameLabel}.${label === 'Raw provider output' ? 'txt' : 'json'}`;
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      showToast(`${label} downloaded`, 'success');
    } catch (error) {
      showToast(getErrorMessage(error, `Could not download ${label.toLowerCase()}`), 'error');
    }
  }, [selectedPageKey, showToast]);

  const filteredPages = useMemo(() => pages.filter((page) => (
    pageMatchesFilters(page, collectionFilter, challengeFilter)
  )), [challengeFilter, collectionFilter, pages]);
  const pageOptions = useMemo(() => filteredPages.filter((page) => (
    pageHasInspectableRunPair(page, leftRun, rightRun)
  )), [filteredPages, leftRun, rightRun]);
  const scorecardComparablePageKeys = useMemo(() => new Set(
    pages.flatMap((page) => (
      pageAgreementFor(scorecards, page.pageKey, leftRun, rightRun)?.comparable
        ? [page.pageKey]
        : []
    )),
  ), [leftRun, pages, rightRun, scorecards]);
  const eligiblePageOptions = useMemo(() => filteredPages.filter((page) => (
    pageHasPotentialRunPair(page, leftRun, rightRun)
    && scorecardComparablePageKeys.has(page.pageKey)
  )), [
    filteredPages,
    leftRun,
    rightRun,
    scorecardComparablePageKeys,
  ]);
  const navigationIndex = pageOptions.findIndex(
    (page) => page.pageKey === selectedPageKey,
  );
  const diagnosticPagePosition = diagnosticOnly && navigationIndex >= 0
    ? navigationIndex + 1
    : null;
  const comparablePages = useMemo(() => pages.filter((page) => (
    pageHasPotentialRunPair(page, leftRun, rightRun)
    && scorecardComparablePageKeys.has(page.pageKey)
  )), [leftRun, pages, rightRun, scorecardComparablePageKeys]);
  const comparablePageCount = comparablePages.length;
  const filtersActive = Boolean(collectionFilter || challengeFilter);
  const filteredReviewedPageCount = useMemo(() => eligiblePageOptions.filter((page) => (
    Boolean(findDecision(evaluation, page.pageKey, leftRunId, rightRunId))
  )).length, [eligiblePageOptions, evaluation, leftRunId, rightRunId]);
  const reviewedForCurrentPair = useMemo(() => comparablePages.filter((page) => (
    Boolean(findDecision(evaluation, page.pageKey, leftRunId, rightRunId))
  )).length, [comparablePages, evaluation, leftRunId, rightRunId]);
  const displayedReviewedPageCount = filtersActive
    ? filteredReviewedPageCount
    : reviewedForCurrentPair;
  const displayedEligiblePageCount = filtersActive
    ? eligiblePageOptions.length
    : comparablePageCount;

  const draftComparableValue = useMemo(() => JSON.stringify({
    ...draft,
    elapsedMs: undefined,
  }), [draft]);
  const savedComparableValue = useMemo(() => JSON.stringify({
    ...toDecisionInput(savedDecision, leftRunId, rightRunId),
    elapsedMs: undefined,
  }), [leftRunId, rightRunId, savedDecision]);
  const isDirty = draftComparableValue !== savedComparableValue || timer.modified;

  const loadBenchmark = useCallback(async () => {
    setLoading(true);
    setFatalError(null);
    try {
      const [overviewResult, pagesResult, runsResult, evaluationResult] = await Promise.all([
        getLayoutBenchmarkOverview(),
        getLayoutBenchmarkPages(),
        getLayoutBenchmarkRuns(),
        getMyLayoutEvaluations(),
      ]);
      const sortedRuns = [...runsResult.runs].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
      const [initialLeft, initialRight] = chooseInitialPair(
        sortedRuns,
        pagesResult.pages,
      );
      const initialLeftRun = sortedRuns.find((run) => run.runId === initialLeft);
      const initialRightRun = sortedRuns.find((run) => run.runId === initialRight);
      setOverview(overviewResult);
      setPages(pagesResult.pages);
      setRuns(sortedRuns);
      setEvaluation(evaluationResult);
      setLeftRunId((current) => (
        sortedRuns.some((run) => run.runId === current) ? current : initialLeft
      ));
      setRightRunId((current) => (
        sortedRuns.some((run) => run.runId === current) ? current : initialRight
      ));
      setSelectedPageKey((current) => (
        pagesResult.pages.some((page) => page.pageKey === current)
          ? current
          : firstComparablePageKey(
            pagesResult.pages,
            initialLeftRun,
            initialRightRun,
          ) ?? firstInspectablePageKey(
            pagesResult.pages,
            initialLeftRun,
            initialRightRun,
          ) ?? pagesResult.pages[0]?.pageKey ?? ''
      ));
    } catch (error) {
      setFatalError(getErrorMessage(
        error,
        'The local layout benchmark could not be loaded.',
      ));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadBenchmark);
  }, [loadBenchmark]);

  useEffect(() => () => {
    Object.values(preparedImageUrls).forEach((url) => URL.revokeObjectURL(url));
  }, [preparedImageUrls]);

  useEffect(() => {
    if (!selectedPageKey || !leftRunId || !rightRunId) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoadingPage(true);
      setLayoutErrors({});
      setLayouts({});
      setPreparedImageUrls({});
      setLoadedLayoutIdentity('');
    });

    void getLayoutBenchmarkPage(selectedPageKey, controller.signal)
      .then(async (detail) => {
        if (controller.signal.aborted) return;
        setPageDetail(detail);
        const targetRuns = [leftRunId, rightRunId];
        const settled = await Promise.allSettled(targetRuns.map(async (runId) => {
          const pageRun = detail.page.runs.find((entry) => entry.runId === runId);
          if (!pageRun || !pageRun.layoutUrl) {
            throw new Error(
              pageRun?.status === 'failed'
                ? 'Failed output has no validated normalized layout artifact'
                : 'No normalized layout artifact for this page',
            );
          }
          const layout = await getLayoutBenchmarkLayout(
            runId,
            selectedPageKey,
            controller.signal,
          );
          if (!pageRun.prepared) {
            throw new Error('Normalized layout has no prepared image artifact');
          }
          const preparedImageUrl = await getLayoutBenchmarkImageObjectUrl(
            pageRun.prepared.url,
            controller.signal,
          );
          return [runId, layout, preparedImageUrl] as const;
        }));
        if (controller.signal.aborted) {
          settled.forEach((result) => {
            if (result.status === 'fulfilled') {
              URL.revokeObjectURL(result.value[2]);
            }
          });
        } else {
          const nextLayouts: Record<string, NormalizedLayout> = {};
          const nextPreparedImageUrls: Record<string, string> = {};
          const nextErrors: Record<string, string> = {};
          settled.forEach((result, index) => {
            const runId = targetRuns[index];
            if (result.status === 'fulfilled') {
              nextLayouts[result.value[0]] = result.value[1];
              nextPreparedImageUrls[result.value[0]] = result.value[2];
            } else {
              nextErrors[runId] = getErrorMessage(result.reason, 'Output unavailable');
            }
          });
          setLayouts(nextLayouts);
          setPreparedImageUrls(nextPreparedImageUrls);
          setLayoutErrors(nextErrors);
          setLoadedLayoutIdentity(identity);
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLayoutErrors({
          [leftRunId]: getErrorMessage(error, 'Output unavailable'),
          [rightRunId]: getErrorMessage(error, 'Output unavailable'),
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingPage(false);
      });

    return () => controller.abort();
  }, [identity, leftRunId, rightRunId, selectedPageKey]);

  useEffect(() => {
    if (!leftRunId || !rightRunId) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setScorecardError(null);
    });
    void getLayoutScorecards([leftRunId, rightRunId], controller.signal)
      .then(setScorecards)
      .catch((error) => {
        if (controller.signal.aborted) return;
        setScorecards(null);
        setScorecardError(getErrorMessage(error, 'Metrics are unavailable.'));
      });
    return () => controller.abort();
  }, [leftRunId, rightRunId, evaluation?.evaluation.updatedAt]);

  const confirmDiscard = useCallback(() => (
    !isDirty || window.confirm('Discard the unsaved benchmark verdict for this page?')
  ), [isDirty]);

  const selectPage = useCallback((pageKey: string) => {
    if (pageKey === selectedPageKey || !confirmDiscard()) return;
    timer.pause();
    setLoadingPage(true);
    setLoadedLayoutIdentity('');
    setPageDetail(null);
    setLayouts({});
    setPreparedImageUrls({});
    setSelectedPageKey(pageKey);
  }, [confirmDiscard, selectedPageKey, timer]);

  const selectPair = useCallback((nextLeftRunId: string, nextRightRunId: string) => {
    if (
      nextLeftRunId === nextRightRunId
      || (nextLeftRunId === leftRunId && nextRightRunId === rightRunId)
      || !confirmDiscard()
    ) return;
    const nextLeftRun = runs.find((run) => run.runId === nextLeftRunId);
    const nextRightRun = runs.find((run) => run.runId === nextRightRunId);
    if (!nextLeftRun || !nextRightRun) return;
    const currentPageRemainsComparable = Boolean(
      selectedPage
      && pageHasInspectableRunPair(selectedPage, nextLeftRun, nextRightRun),
    );
    const nextPageKey = currentPageRemainsComparable
      ? selectedPageKey
      : firstComparablePageKey(
        filteredPages,
        nextLeftRun,
        nextRightRun,
      ) ?? firstInspectablePageKey(
        filteredPages,
        nextLeftRun,
        nextRightRun,
      ) ?? firstComparablePageKey(
        pages,
        nextLeftRun,
        nextRightRun,
      ) ?? firstInspectablePageKey(
        pages,
        nextLeftRun,
        nextRightRun,
      ) ?? selectedPageKey;
    timer.pause();
    setLoadingPage(true);
    setLoadedLayoutIdentity('');
    setPageDetail(null);
    setLayouts({});
    setPreparedImageUrls({});
    setLeftRunId(nextLeftRunId);
    setRightRunId(nextRightRunId);
    if (nextPageKey !== selectedPageKey) setSelectedPageKey(nextPageKey);
  }, [
    confirmDiscard,
    filteredPages,
    leftRunId,
    pages,
    rightRunId,
    runs,
    selectedPage,
    selectedPageKey,
    timer,
  ]);

  const selectRun = useCallback((side: 'left' | 'right', runId: string) => {
    selectPair(
      side === 'left' ? runId : leftRunId,
      side === 'right' ? runId : rightRunId,
    );
  }, [leftRunId, rightRunId, selectPair]);

  const selectFilters = useCallback((
    nextCollection: string,
    nextChallenge: string,
  ) => {
    const matchingPages = pages.filter((page) => (
      pageMatchesFilters(page, nextCollection, nextChallenge)
    ));
    const nextPageKey = firstComparablePageKey(
      matchingPages,
      leftRun,
      rightRun,
    ) ?? firstInspectablePageKey(
      matchingPages,
      leftRun,
      rightRun,
    );
    const shouldMove = Boolean(
      nextPageKey
      && nextPageKey !== selectedPageKey
      && !matchingPages.some((page) => (
        page.pageKey === selectedPageKey
        && pageHasInspectableRunPair(page, leftRun, rightRun)
      )),
    );
    if (shouldMove && !confirmDiscard()) return;
    if (shouldMove) {
      timer.pause();
      setLoadingPage(true);
      setLoadedLayoutIdentity('');
      setPageDetail(null);
      setLayouts({});
      setPreparedImageUrls({});
      setSelectedPageKey(nextPageKey!);
    }
    setCollectionFilter(nextCollection);
    setChallengeFilter(nextChallenge);
  }, [
    confirmDiscard,
    leftRun,
    pages,
    rightRun,
    selectedPageKey,
    timer,
  ]);

  const handleSave = useCallback(async () => {
    if (
      !selectedPageKey
      || !leftRunId
      || !rightRunId
      || !profilesMatch
      || !pairQualityRankable
      || selectedPairHasFailure
      || savedDecision
      || !timer.hasStarted
      || draft.preference === 'unreviewed'
    ) {
      return;
    }
    const measuredElapsed = timer.pause();
    setSaving(true);
    try {
      const response = await putMyLayoutEvaluation(selectedPageKey, {
        ...draft,
        leftRunId,
        rightRunId,
        elapsedMs: Math.max(1, measuredElapsed),
      });
      setEvaluation({
        evaluation: response.evaluation,
        progress: response.progress,
      });
      setDraftState({
        identity,
        value: toDecisionInput(response.decision, leftRunId, rightRunId),
      });
      timer.markSaved();
      showToast('Benchmark verdict saved', 'success');
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to save benchmark verdict'), 'error');
    } finally {
      setSaving(false);
    }
  }, [
    draft,
    identity,
    leftRunId,
    pairQualityRankable,
    profilesMatch,
    rightRunId,
    savedDecision,
    selectedPageKey,
    selectedPairHasFailure,
    showToast,
    timer,
  ]);

  const movePage = useCallback((direction: -1 | 1) => {
    const nextPage = pageOptions[navigationIndex + direction];
    if (nextPage) selectPage(nextPage.pageKey);
  }, [navigationIndex, pageOptions, selectPage]);

  const currentPageDetail = pageDetail?.page.pageKey === selectedPageKey
    ? pageDetail
    : null;
  const pageRunA = currentPageDetail?.page.runs.find(
    (run) => run.runId === blindAssignment?.aRunId,
  );
  const pageRunB = currentPageDetail?.page.runs.find(
    (run) => run.runId === blindAssignment?.bRunId,
  );
  const layoutA = loadedLayoutIdentity === identity && blindAssignment
    ? layouts[blindAssignment.aRunId]
    : undefined;
  const layoutB = loadedLayoutIdentity === identity && blindAssignment
    ? layouts[blindAssignment.bRunId]
    : undefined;
  const imageUrlA = loadedLayoutIdentity === identity && blindAssignment
    ? preparedImageUrls[blindAssignment.aRunId]
    : undefined;
  const imageUrlB = loadedLayoutIdentity === identity && blindAssignment
    ? preparedImageUrls[blindAssignment.bRunId]
    : undefined;
  const comparable = isPreparedPairComparable(
    currentPageDetail,
    leftRun,
    rightRun,
  );
  const eligibleForReview = Boolean(
    selectedPage
    && comparable
    && pairQualityRankable
    && pageRunA?.status === 'succeeded'
    && pageRunB?.status === 'succeeded',
  );
  const effectiveStageMode = (
    comparable
    && layoutA
    && layoutB
    && imageUrlA
    && imageUrlB
    && !selectedPairHasFailure
  ) ? stageMode : 'split';
  const aImageState = blindAssignment
    ? imageStates[imageKey(blindAssignment.aRunId)]
    : undefined;
  const bImageState = blindAssignment
    ? imageStates[imageKey(blindAssignment.bRunId)]
    : undefined;
  const reviewReady = Boolean(
    eligibleForReview
    && comparable
    && layoutA
    && layoutB
    && (
      effectiveStageMode === 'single'
        ? aImageState === 'ready'
        : aImageState === 'ready' && bImageState === 'ready'
    ),
  );
  useEffect(() => {
    if (effectiveStageMode !== 'single') return undefined;

    const handleSpaceFlicker = (event: KeyboardEvent) => {
      if (
        (event.key !== ' ' && event.code !== 'Space')
        || event.repeat
        || isFormOrTypingTarget(event.target)
        || isFormOrTypingTarget(document.activeElement)
      ) {
        return;
      }
      event.preventDefault();
      setSingleCanvasCandidate((current) => (current === 'a' ? 'b' : 'a'));
    };

    window.addEventListener('keydown', handleSpaceFlicker);
    return () => window.removeEventListener('keydown', handleSpaceFlicker);
  }, [effectiveStageMode]);
  const currentImageError = imageErrors[imageKey(leftRunId)]
    ?? imageErrors[imageKey(rightRunId)];
  const reviewBlockReason = currentImageError
    ?? (!pairQualityRankable
      ? 'Diagnostic-only run profile: this experiment is inspectable but excluded from quality ranking and saved human review.'
      : selectedPairHasFailure
      ? 'Diagnostic-only page: one or both selected runs failed. Human preference, repair, confidence, and notes controls are disabled.'
      : undefined)
    ?? (loadingPage
      ? 'Waiting for normalized layouts.'
      : 'Waiting for the prepared scan to decode and match its declared dimensions.');

  if (loading) {
    return (
      <AdminLayout fullHeight>
        <div className="layout-benchmark-state" aria-live="polite">
          <span className="layout-state-spinner" aria-hidden />
          <h1>Preparing the layout lab</h1>
          <p>Loading the fixed cohort, immutable runs, and your review progress…</p>
        </div>
      </AdminLayout>
    );
  }

  if (fatalError || !overview) {
    return (
      <AdminLayout fullHeight>
        <div className="layout-benchmark-state is-error">
          <span className="layout-eyebrow">Local benchmark</span>
          <h1>Layout lab unavailable</h1>
          <p>{fatalError ?? 'The benchmark API did not return an overview.'}</p>
          <p className="layout-state-help">
            This tool is intentionally disabled in production. Start the local backend and create
            at least two benchmark runs before reviewing results.
          </p>
          <Button variant="primary" icon="refresh" onClick={() => void loadBenchmark()}>
            Try again
          </Button>
        </div>
      </AdminLayout>
    );
  }

  if (!leftRun || !rightRun || runs.length < 2) {
    return (
      <AdminLayout fullHeight>
        <div className="layout-benchmark-state">
          <span className="layout-eyebrow">Local benchmark</span>
          <h1>Two completed runs are needed</h1>
          <p>
            The cohort is ready ({overview.cohort.pageCount} pages), but there are not yet two
            engine outputs to compare.
          </p>
          <code>
            npm run benchmark:layout -- run --engine all --scope smoke
          </code>
          <Button variant="secondary" icon="refresh" onClick={() => void loadBenchmark()}>
            Refresh runs
          </Button>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout fullHeight>
      <div className="layout-benchmark-page">
        <header className="layout-benchmark-header">
          <div className="layout-benchmark-title">
            <div>
              <span className="layout-eyebrow">Admin · local experiment</span>
              <h1>Layout Engine Lab</h1>
            </div>
            <div className="layout-benchmark-title-actions">
              <a
                className="layout-transcript-alignment-link"
                href="/admin/layout-benchmark/alignment"
              >
                Transcript alignment
              </a>
              <div className="layout-review-progress">
                <strong>
                  {diagnosticPagePosition ?? displayedReviewedPageCount}
                  <span>
                    {' / '}
                    {diagnosticPagePosition === null
                      ? displayedEligiblePageCount
                      : pageOptions.length}
                  </span>
                </strong>
                <div>
                  <span>
                    {diagnosticPagePosition !== null
                      ? 'page position in diagnostic set'
                      : filtersActive
                        ? 'filtered comparable pages reviewed'
                        : 'comparable pages reviewed'}
                  </span>
                  <progress
                    max={Math.max(
                      1,
                      diagnosticPagePosition === null
                        ? displayedEligiblePageCount
                        : pageOptions.length,
                    )}
                    value={diagnosticPagePosition ?? displayedReviewedPageCount}
                  />
                </div>
              </div>
            </div>
          </div>

          <details className="layout-review-setup">
            <summary>
              <span className="layout-review-setup-pair">
                <span>Comparing</span>
                <strong>{runPresentation(leftRun).name}</strong>
                <span>vs</span>
                <strong>{runPresentation(rightRun).name}</strong>
              </span>
              <span className="layout-review-setup-page">{selectedPageKey}</span>
              <span className="layout-review-setup-action">Change setup</span>
            </summary>

            <div className="layout-review-setup-body">
              {comparisonPresets.length > 0 || hiddenEarlierRunCount > 0 ? (
                <div className="layout-comparison-guide">
                  <div className="layout-comparison-guide-controls">
                    {comparisonPresets.length > 0 ? (
                      <>
                        <span>Suggested</span>
                        {comparisonPresets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={activeComparisonPreset?.id === preset.id ? 'is-active' : ''}
                            aria-pressed={activeComparisonPreset?.id === preset.id}
                            onClick={() => selectPair(preset.leftRunId, preset.rightRunId)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </>
                    ) : null}
                    {hiddenEarlierRunCount > 0 ? (
                      <button
                        type="button"
                        className="layout-run-history-toggle"
                        aria-expanded={showEarlierRuns}
                        onClick={() => setShowEarlierRuns((current) => !current)}
                      >
                        {showEarlierRuns
                          ? 'Hide earlier runs'
                          : `Show earlier runs (${hiddenEarlierRunCount})`}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="layout-benchmark-selectors">
                <label className="layout-run-select">
                  <span>Candidate 1</span>
                  <select
                    id="layout-candidate-one"
                    value={leftRunId}
                    aria-describedby="layout-comparison-question"
                    onChange={(event) => selectRun('left', event.target.value)}
                  >
                    <RunSelectOptions groups={leftRunOptionGroups} />
                  </select>
                </label>
                <label className="layout-run-select">
                  <span>Candidate 2</span>
                  <select
                    id="layout-candidate-two"
                    value={rightRunId}
                    aria-describedby="layout-comparison-question"
                    onChange={(event) => selectRun('right', event.target.value)}
                  >
                    <RunSelectOptions groups={rightRunOptionGroups} />
                  </select>
                </label>
                <label className="layout-page-select">
                  <span>Benchmark page</span>
                  <select
                    value={pageOptions.some((page) => page.pageKey === selectedPageKey)
                      ? selectedPageKey
                      : ''}
                    disabled={pageOptions.length === 0}
                    onChange={(event) => selectPage(event.target.value)}
                  >
                    {pageOptions.length === 0
                      ? <option value="">No comparable pages</option>
                      : pageOptions.map((page) => {
                        const reviewed = Boolean(findDecision(
                          evaluation,
                          page.pageKey,
                          leftRunId,
                          rightRunId,
                        ));
                        const failed = [leftRunId, rightRunId].some((runId) => (
                          page.runs.find((run) => run.runId === runId)?.status === 'failed'
                        ));
                        return (
                          <option key={page.pageKey} value={page.pageKey}>
                            {reviewed ? '✓ ' : failed ? '⚠ ' : ''}
                            {page.pageKey}
                            {failed ? ' · failed output' : ''}
                          </option>
                        );
                      })}
                  </select>
                </label>
                <label className="layout-compact-filter">
                  <span>Collection</span>
                  <select
                    value={collectionFilter}
                    onChange={(event) => selectFilters(
                      event.target.value,
                      challengeFilter,
                    )}
                  >
                    <option value="">All</option>
                    {overview.cohort.collectionCodes.map((code) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                </label>
                <label className="layout-compact-filter">
                  <span>Challenge</span>
                  <select
                    value={challengeFilter}
                    onChange={(event) => selectFilters(
                      collectionFilter,
                      event.target.value,
                    )}
                  >
                    <option value="">All</option>
                    {overview.cohort.challengeTags.map((tag) => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </select>
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  onClick={() => void loadBenchmark()}
                >
                  Refresh
                </Button>
              </div>

              <div className="layout-review-setup-context">
                <p id="layout-comparison-question">
                  <strong>{activeComparisonPreset ? 'Question:' : 'Custom comparison.'}</strong>
                  {' '}
                  {activeComparisonPreset?.description
                    ?? 'Use the candidate names above to choose the exact methods you want to inspect.'}
                </p>
                <details className="layout-pair-details">
                  <summary>About selected candidates</summary>
                  <div className="layout-selected-runs">
                    <SelectedRunSummary id="layout-candidate-one-summary" run={leftRun} />
                    <SelectedRunSummary id="layout-candidate-two-summary" run={rightRun} />
                  </div>
                </details>
              </div>
            </div>
          </details>
        </header>

        {savedDecision ? (
          <LayoutResultsSummary
            scorecards={scorecards}
            leftRun={displayARun ?? leftRun}
            rightRun={displayBRun ?? rightRun}
            pages={pages}
            evaluation={evaluation}
            error={scorecardError}
            revealIdentity
            qualityRankable={pairQualityRankable}
          />
        ) : null}

        {pageOptions.length === 0 ? (
          <section className="layout-benchmark-state layout-comparison-empty" role="status">
            <span className="layout-eyebrow">No overlapping pages</span>
            <h2>No pages selected by both runs for this view</h2>
            <p>
              {!profilesMatch
                ? 'These runs use different preprocessing-profile SHA-256 values. Pair metrics, historical decisions, overlays, and new reviews are quarantined; choose runs created with the identical preprocessing profile.'
                : filtersActive
                ? 'The selected runs did not both attempt any pages matching these filters. Clear a filter or choose another run pair.'
                : 'These runs do not overlap on a selected page. Choose another run pair or generate matching runs before reviewing.'}
            </p>
          </section>
        ) : (
        <div className="layout-benchmark-workspace">
          <section className="layout-stage" aria-label="Layout comparison">
            <div className="layout-stage-toolbar">
              <div className="layout-page-context">
                <strong>{selectedPage?.pageKey}</strong>
                <span>
                  {navigationIndex >= 0 ? `${navigationIndex + 1} / ${pageOptions.length}` : ''}
                </span>
              </div>

              <div className="layout-view-controls" aria-label="Comparison controls">
                <div className="layout-segmented-control">
                  <button
                    type="button"
                    className={effectiveStageMode === 'split' ? 'is-active' : ''}
                    onClick={() => setStageMode('split')}
                  >
                    Side by side
                  </button>
                  <button
                    type="button"
                    className={effectiveStageMode === 'single' ? 'is-active' : ''}
                    disabled={
                      !comparable
                      || !layoutA
                      || !layoutB
                      || selectedPairHasFailure
                    }
                    title={
                      comparable && layoutA && layoutB && !selectedPairHasFailure
                        ? 'Inspect either candidate or both on one shared prepared image'
                        : 'Both normalized layouts must share one prepared image'
                    }
                    onClick={() => setStageMode('single')}
                  >
                    Single canvas
                  </button>
                </div>
                {effectiveStageMode === 'single' ? (
                  <div
                    className="layout-segmented-control layout-candidate-control"
                    aria-label="Visible candidates"
                  >
                    {([
                      ['a', 'A'],
                      ['both', 'Both'],
                      ['b', 'B'],
                    ] as const).map(([candidate, label]) => (
                      <button
                        key={candidate}
                        type="button"
                        className={singleCanvasCandidate === candidate ? 'is-active' : ''}
                        aria-pressed={singleCanvasCandidate === candidate}
                        aria-label={
                          candidate === 'both'
                            ? 'Show both candidates'
                            : `Show candidate ${label} only`
                        }
                        onClick={() => setSingleCanvasCandidate(candidate)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <label className="layout-layer-toggle">
                  <input
                    type="checkbox"
                    checked={showLines}
                    onChange={(event) => setShowLines(event.target.checked)}
                  />
                  Lines
                </label>
                <label className="layout-layer-toggle">
                  <input
                    type="checkbox"
                    checked={showPageBoundary}
                    onChange={(event) => setShowPageBoundary(event.target.checked)}
                  />
                  Page edge
                </label>
                <label className="layout-layer-toggle">
                  <input
                    type="checkbox"
                    checked={showRegions}
                    onChange={(event) => setShowRegions(event.target.checked)}
                  />
                  Regions
                </label>
                <label className="layout-layer-toggle">
                  <input
                    type="checkbox"
                    checked={showReadingOrder}
                    onChange={(event) => setShowReadingOrder(event.target.checked)}
                  />
                  Order
                </label>
                <label className="layout-slider">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={overlayOpacity}
                    onChange={(event) => setOverlayOpacity(Number(event.target.value))}
                  />
                </label>
                <label className="layout-slider">
                  <span>Zoom</span>
                  <input
                    type="range"
                    min={0.65}
                    max={2}
                    step={0.05}
                    value={zoom}
                    onChange={(event) => setZoom(Number(event.target.value))}
                  />
                </label>
              </div>
            </div>

            {!comparable && !loadingPage && (
              <div className="layout-comparability-warning" role="status">
                <strong>Prepared inputs do not match.</strong>
                Side-by-side inspection remains available, but proxy scores and single-canvas comparison
                are disabled so different coordinate spaces are never mistaken for a fair comparison.
              </div>
            )}
            {selectedPairHasFailure && !loadingPage && (
              <div className="layout-comparability-warning is-diagnostic" role="status">
                <strong>Diagnostic-only page.</strong>
                One or both selected runs failed. Provider identities and immutable artifact
                evidence are revealed for troubleshooting; human verdict and repair controls
                remain disabled.
              </div>
            )}
            {!pairQualityRankable && !loadingPage && (
              <div className="layout-comparability-warning is-diagnostic" role="status">
                <strong>Diagnostic profile — not ranked.</strong>
                One or both selected runs declare an experimental diagnostic profile. Outputs
                remain visible for diagnosis, but pair ranking and saved human verdict controls
                are disabled.
              </div>
            )}
            {currentImageError && (
              <div className="layout-comparability-warning" role="alert">
                <strong>Prepared image unavailable.</strong>
                {currentImageError}
              </div>
            )}

            {revealIdentity && (
              pageRunA?.status === 'succeeded' || pageRunB?.status === 'succeeded'
            ) ? (
              <details className="layout-evidence-drawer">
                <summary>Artifact evidence</summary>
                <div className="layout-evidence-runs">
                  {pageRunA?.status === 'succeeded' && displayARun ? (
                    <section>
                      <strong>A · {displayARun.engineId} {displayARun.engineVersion}</strong>
                      <RunArtifactLinks
                        side="A"
                        pageRun={pageRunA}
                        onDownloadArtifact={(url, label) => {
                          void downloadArtifact(url, label);
                        }}
                      />
                    </section>
                  ) : null}
                  {pageRunB?.status === 'succeeded' && displayBRun ? (
                    <section>
                      <strong>B · {displayBRun.engineId} {displayBRun.engineVersion}</strong>
                      <RunArtifactLinks
                        side="B"
                        pageRun={pageRunB}
                        onDownloadArtifact={(url, label) => {
                          void downloadArtifact(url, label);
                        }}
                      />
                    </section>
                  ) : null}
                </div>
              </details>
            ) : null}

            <div
              className={`layout-stage-body is-${effectiveStageMode}`}
              aria-busy={loadingPage}
              aria-keyshortcuts={effectiveStageMode === 'single' ? 'Space' : undefined}
              aria-label={effectiveStageMode === 'single'
                ? 'Single-canvas comparison'
                : undefined}
              role={effectiveStageMode === 'single' ? 'group' : undefined}
              tabIndex={effectiveStageMode === 'single' ? 0 : undefined}
            >
              {loadingPage && (
                <div className="layout-stage-loading">
                  <span className="layout-state-spinner" aria-hidden />
                  Loading normalized geometry…
                </div>
              )}

              {!loadingPage && effectiveStageMode === 'split' && (
                <div
                  className="layout-split-grid"
                  style={{ width: `${zoom * 100}%` }}
                >
                  {layoutA && imageUrlA && pageRunA?.prepared && displayARun ? (
                    <LayoutCanvas
                      title={revealIdentity ? `A · ${displayARun.engineId}` : 'Run A'}
                      subtitle=""
                      imageUrl={imageUrlA}
                      width={pageRunA.prepared.width}
                      height={pageRunA.prepared.height}
                      layers={[{
                        id: displayARun.runId,
                        label: 'A',
                        color: ENGINE_COLORS.left,
                        layout: layoutA,
                      }]}
                      overlayOpacity={overlayOpacity}
                      showPageBoundary={showPageBoundary}
                      showLines={showLines}
                      showRegions={showRegions}
                      showReadingOrder={showReadingOrder}
                      revealIdentity={revealIdentity}
                      diagnosticStatus={pageRunA.status === 'failed' ? {
                        label: pageRunA.error?.code === 'PREDICTED_LINE_CAP_REACHED'
                          ? 'Failed / truncated output'
                          : 'Failed output',
                        message: pageRunA.error?.message
                          ?? 'This partial geometry came from a failed run and is diagnostic only.',
                      } : undefined}
                      diagnosticActions={pageRunA.status === 'failed' ? (
                        <RunArtifactLinks
                          side="A"
                          pageRun={pageRunA}
                          onDownloadArtifact={(url, label) => {
                            void downloadArtifact(url, label);
                          }}
                        />
                      ) : undefined}
                      onImageLoad={(image) => recordImageLoad(
                        displayARun.runId,
                        pageRunA.prepared!,
                        image,
                      )}
                      onImageError={() => recordImageError(displayARun.runId)}
                    />
                  ) : (
                    <RunUnavailable
                      side="A"
                      run={displayARun ?? leftRun}
                      pageRun={pageRunA}
                      layoutError={blindAssignment
                        ? layoutErrors[blindAssignment.aRunId]
                        : undefined}
                      revealIdentity={revealIdentity}
                      onDownloadArtifact={(url, label) => void downloadArtifact(url, label)}
                    />
                  )}
                  {layoutB && imageUrlB && pageRunB?.prepared && displayBRun ? (
                    <LayoutCanvas
                      title={revealIdentity ? `B · ${displayBRun.engineId}` : 'Run B'}
                      subtitle=""
                      imageUrl={imageUrlB}
                      width={pageRunB.prepared.width}
                      height={pageRunB.prepared.height}
                      layers={[{
                        id: displayBRun.runId,
                        label: 'B',
                        color: ENGINE_COLORS.right,
                        layout: layoutB,
                      }]}
                      overlayOpacity={overlayOpacity}
                      showPageBoundary={showPageBoundary}
                      showLines={showLines}
                      showRegions={showRegions}
                      showReadingOrder={showReadingOrder}
                      revealIdentity={revealIdentity}
                      diagnosticStatus={pageRunB.status === 'failed' ? {
                        label: pageRunB.error?.code === 'PREDICTED_LINE_CAP_REACHED'
                          ? 'Failed / truncated output'
                          : 'Failed output',
                        message: pageRunB.error?.message
                          ?? 'This partial geometry came from a failed run and is diagnostic only.',
                      } : undefined}
                      diagnosticActions={pageRunB.status === 'failed' ? (
                        <RunArtifactLinks
                          side="B"
                          pageRun={pageRunB}
                          onDownloadArtifact={(url, label) => {
                            void downloadArtifact(url, label);
                          }}
                        />
                      ) : undefined}
                      onImageLoad={(image) => recordImageLoad(
                        displayBRun.runId,
                        pageRunB.prepared!,
                        image,
                      )}
                      onImageError={() => recordImageError(displayBRun.runId)}
                    />
                  ) : (
                    <RunUnavailable
                      side="B"
                      run={displayBRun ?? rightRun}
                      pageRun={pageRunB}
                      layoutError={blindAssignment
                        ? layoutErrors[blindAssignment.bRunId]
                        : undefined}
                      revealIdentity={revealIdentity}
                      onDownloadArtifact={(url, label) => void downloadArtifact(url, label)}
                    />
                  )}
                </div>
              )}

              {!loadingPage
                && effectiveStageMode === 'single'
                && comparable
                && layoutA
                && layoutB
                && imageUrlA
                && displayARun
                && displayBRun
                && pageRunA?.prepared && (
                <div className="layout-single-canvas">
                  <div
                    className="layout-single-canvas-zoom"
                    style={{ width: `${zoom * 100}%` }}
                  >
                    <LayoutCanvas
                    title={
                      singleCanvasCandidate === 'a'
                        ? revealIdentity ? `A · ${displayARun.engineId}` : 'Run A'
                        : singleCanvasCandidate === 'b'
                          ? revealIdentity ? `B · ${displayBRun.engineId}` : 'Run B'
                          : revealIdentity
                            ? `A · ${displayARun.engineId} + B · ${displayBRun.engineId}`
                            : 'Run A + Run B'
                    }
                    subtitle={
                      singleCanvasCandidate === 'both'
                        ? 'Blue = A · Red = B · Space alternates A/B'
                        : `Candidate ${singleCanvasCandidate.toUpperCase()} only · Space alternates A/B`
                    }
                    imageUrl={imageUrlA}
                    width={pageRunA.prepared.width}
                    height={pageRunA.prepared.height}
                    layers={[
                      ...(singleCanvasCandidate !== 'b' ? [{
                        id: displayARun.runId,
                        label: 'A',
                        color: ENGINE_COLORS.left,
                        layout: layoutA,
                      }] : []),
                      ...(singleCanvasCandidate !== 'a' ? [{
                        id: displayBRun.runId,
                        label: 'B',
                        color: ENGINE_COLORS.right,
                        layout: layoutB,
                      }] : []),
                    ]}
                    overlayOpacity={overlayOpacity}
                    showPageBoundary={showPageBoundary}
                    showLines={showLines}
                    showRegions={showRegions}
                    showReadingOrder={showReadingOrder}
                    revealIdentity={revealIdentity}
                    onImageLoad={(image) => recordImageLoad(
                      displayARun.runId,
                      pageRunA.prepared!,
                      image,
                    )}
                    onImageError={() => recordImageError(displayARun.runId)}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          <EvaluationPanel
            pageKey={selectedPageKey}
            leftRun={displayARun ?? leftRun}
            rightRun={displayBRun ?? rightRun}
            draft={presentationDraft}
            onDraftChange={setPresentationDraft}
            timer={timer}
            reviewReady={reviewReady}
            controlsEnabled={
              reviewReady
              && timer.hasStarted
              && !savedDecision
              && !diagnosticOnly
            }
            reviewBlockReason={reviewBlockReason}
            revealIdentity={revealIdentity}
            diagnosticOnly={diagnosticOnly}
            readOnly={Boolean(savedDecision)}
            saving={saving}
            saved={!isDirty && Boolean(savedDecision)}
            canSave={
              draft.preference !== 'unreviewed'
              && comparable
              && Boolean(layoutA)
              && Boolean(layoutB)
              && reviewReady
              && timer.hasStarted
              && !savedDecision
              && !diagnosticOnly
              && !saving
            }
            onSave={() => void handleSave()}
            onPrevious={() => movePage(-1)}
            onNext={() => movePage(1)}
            previousDisabled={navigationIndex <= 0}
            nextDisabled={
              navigationIndex < 0
              || navigationIndex >= pageOptions.length - 1
            }
          />
        </div>
        )}
      </div>
    </AdminLayout>
  );
}
