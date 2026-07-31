import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getTranscriptAlignmentIndex,
  getTranscriptAlignmentPage,
  putTranscriptAlignmentReview,
  type TranscriptAlignmentFailureMode,
  type TranscriptAlignmentItem,
  type TranscriptAlignmentLetterSummary,
  type TranscriptAlignmentPageResponse,
  type TranscriptAlignmentRunSummary,
  type TranscriptAlignmentSegment,
  type TranscriptAlignmentVerdict,
} from '../../api/admin/transcriptAlignment';
import { getLayoutBenchmarkImageObjectUrl } from '../../api/admin/layoutBenchmark';
import { ApiError, getErrorMessage } from '../../api/client';
import {
  getAdminLetterById,
  getAdminLetters,
} from '../../api/letters';
import AdminLayout from '../../components/AdminLayout/AdminLayout';
import type {
  AdminLetterSummary,
  Letter,
} from '../../types/Letter';
import { useReviewTimer } from './LayoutBenchmark/useReviewTimer';
import TranscriptAlignmentCanvas from './TranscriptAlignment/TranscriptAlignmentCanvas';
import './TranscriptAlignmentPage.css';

const MAXIMUM_CORRECTION_SEGMENTS = 12;
const ADMIN_LETTER_LOOKUP_PAGE_SIZE = 100;

interface ProductionRepairTarget {
  letterId: string;
  pageIndex: number;
  originalFilename: string;
}

type ProductionRepairResolution =
  | { kind: 'idle' }
  | {
      kind: 'ready';
      pageKey: string;
      target: ProductionRepairTarget;
    }
  | { kind: 'unavailable'; pageKey: string };

function productionPageTarget(
  letter: Letter,
  page: TranscriptAlignmentPageResponse['page'],
): ProductionRepairTarget | null {
  const matches = letter.images
    .map((image, pageIndex) => ({ image, pageIndex }))
    .filter(({ image }) => (
      image.type === 'letter'
      && image.originalFilename === page.originalFilename
      && (
        image.pageNumber === undefined
        || image.pageNumber === page.pageNumber
      )
    ));
  if (matches.length !== 1) return null;
  return {
    letterId: letter.id,
    pageIndex: matches[0].pageIndex,
    originalFilename: page.originalFilename,
  };
}

async function resolveProductionRepairTarget(
  page: TranscriptAlignmentPageResponse['page'],
  letterCache: Map<string, Letter>,
): Promise<ProductionRepairTarget | null> {
  const cachedLetter = letterCache.get(page.letterKey);
  if (cachedLetter) {
    return productionPageTarget(cachedLetter, page);
  }

  const collectionCode = page.letterKey.match(/^([^-]+)-/)?.[1];
  if (!collectionCode) return null;

  const summaries: AdminLetterSummary[] = [];
  let pageNumber = 1;
  while (true) {
    const response = await getAdminLetters({
      collection: collectionCode,
      page: pageNumber,
      limit: ADMIN_LETTER_LOOKUP_PAGE_SIZE,
    });
    summaries.push(...response.letters);
    if (pageNumber >= response.pagination.totalPages) break;
    pageNumber += 1;
  }

  const uniqueLetterIds = Array.from(new Set(
    summaries.map((summary) => summary.id),
  ));
  const detailResults = await Promise.allSettled(
    uniqueLetterIds.map((letterId) => getAdminLetterById(letterId)),
  );
  const matches = detailResults.flatMap((result) => {
    if (result.status !== 'fulfilled') return [];
    const target = productionPageTarget(result.value, page);
    return target ? [{ letter: result.value, target }] : [];
  });
  if (matches.length !== 1) return null;

  letterCache.set(page.letterKey, matches[0].letter);
  return matches[0].target;
}

function friendlyRunName(run: TranscriptAlignmentRunSummary): string {
  const id = run.runId.toLowerCase();
  if (id.includes('flow-aware')) {
    return 'Flow-aware transcript match';
  }
  if (id.includes('mccatmus') && id.includes('dp')) {
    return 'Content-aware match · handwriting OCR';
  }
  if (id.includes('content') || id.includes('align')) {
    return 'Content-aware transcript match';
  }
  return 'Transcript alignment experiment';
}

function compactRunId(runId: string): string {
  if (runId.length <= 28) return runId;
  const parts = runId.split('-').filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0]}…${parts.slice(-2).join('-')}`;
  }
  return `${runId.slice(0, 13)}…${runId.slice(-13)}`;
}

function runOptionLabel(run: TranscriptAlignmentRunSummary): string {
  const date = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(run.createdAt));
  return `${friendlyRunName(run)} · ${compactRunId(run.runId)} · ${date} · ${run.pageCount}p`;
}

function operationLabel(operation: TranscriptAlignmentItem['mapping']['operation']): string {
  switch (operation) {
    case 'split':
      return 'One transcript line matched to multiple image lines';
    case 'merge':
      return 'Multiple transcript lines share one image line';
    case 'unlocated-transcript':
      return 'No image line was confidently located';
    default:
      return 'One transcript line matched to one image line';
  }
}

function statusLabel(status: TranscriptAlignmentItem['mapping']['status']): string {
  switch (status) {
    case 'accepted':
      return 'Strong match';
    case 'unlocated':
      return 'Not located';
    default:
      return 'Needs review';
  }
}

const STANDALONE_EDITORIAL_PLACEHOLDER = /^\s*(?:\[(?:illegible|unclear|unreadable|blank|missing)(?:[^\]]*)\]\s*[\s.,;:!?—-]*)+$/iu;

function isStandaloneEditorialPlaceholder(text: string): boolean {
  return STANDALONE_EDITORIAL_PLACEHOLDER.test(text);
}

function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function segmentText(
  segmentIds: string[],
  segmentById: Map<string, TranscriptAlignmentSegment>,
): string {
  const lines = segmentIds
    .map((segmentId) => segmentById.get(segmentId)?.recognizedText.trim())
    .filter((text): text is string => Boolean(text));
  return lines.length > 0 ? lines.join('\n') : 'No readable Kraken text for this image line.';
}

function sameSegments(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((segmentId) => rightIds.has(segmentId));
}

const FAILURE_MODES: Array<{
  value: TranscriptAlignmentFailureMode;
  label: string;
}> = [
  { value: 'wrong-line', label: 'Wrong line' },
  { value: 'missed-line', label: 'Missed line' },
  { value: 'false-line', label: 'False line' },
  { value: 'split', label: 'Split' },
  { value: 'merge', label: 'Merge' },
  { value: 'wrong-order', label: 'Wrong order' },
  { value: 'neighboring-page', label: 'Neighbor page' },
  { value: 'sideways-text', label: 'Sideways text' },
  { value: 'page-boundary', label: 'Page boundary' },
  { value: 'other', label: 'Other' },
];

function inferredFailureModes(
  item: TranscriptAlignmentItem,
): TranscriptAlignmentFailureMode[] {
  switch (item.mapping.operation) {
    case 'split':
      return ['split'];
    case 'merge':
      return ['merge'];
    case 'unlocated-transcript':
      return ['missed-line'];
    default:
      return ['wrong-line'];
  }
}

function correctionRepairActions(
  candidateSegmentIds: string[],
  correctedSegmentIds: string[],
): number {
  const candidate = new Set(candidateSegmentIds);
  const corrected = new Set(correctedSegmentIds);
  const removed = candidateSegmentIds.filter((segmentId) => !corrected.has(segmentId)).length;
  const added = correctedSegmentIds.filter((segmentId) => !candidate.has(segmentId)).length;
  return Math.max(1, removed + added);
}

function firstReviewItem(items: TranscriptAlignmentItem[]): TranscriptAlignmentItem | undefined {
  return items.find((item) => item.mapping.status === 'ambiguous' && !item.review)
    ?? items.find((item) => item.mapping.status === 'unlocated' && !item.review)
    ?? items.find((item) => item.mapping.status === 'ambiguous')
    ?? items.find((item) => item.mapping.status === 'unlocated')
    ?? items.find((item) => !item.review)
    ?? items[0];
}

function nextReviewItem(
  items: TranscriptAlignmentItem[],
  currentItemId: string,
): TranscriptAlignmentItem | undefined {
  const currentIndex = items.findIndex((item) => item.id === currentItemId);
  const ordered = currentIndex < 0
    ? items
    : [...items.slice(currentIndex + 1), ...items.slice(0, currentIndex)];
  return ordered.find((item) => !item.review && item.mapping.status === 'ambiguous')
    ?? ordered.find((item) => !item.review && item.mapping.status === 'unlocated')
    ?? ordered.find((item) => !item.review);
}

function pageNumberFromKey(pageKey: string): string {
  const suffix = pageKey.match(/-(\d+)$/)?.[1];
  return suffix ? String(Number.parseInt(suffix, 10)) : pageKey;
}

function nextPageKey(
  letter: TranscriptAlignmentLetterSummary | undefined,
  currentPageKey: string,
  delta: number,
): string | null {
  if (!letter) return null;
  const currentIndex = letter.pageKeys.indexOf(currentPageKey);
  if (currentIndex < 0) return null;
  return letter.pageKeys[currentIndex + delta] ?? null;
}

export default function TranscriptAlignmentPage() {
  const [runs, setRuns] = useState<TranscriptAlignmentRunSummary[]>([]);
  const [invalidRunCount, setInvalidRunCount] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedLetterKey, setSelectedLetterKey] = useState('');
  const [selectedPageKey, setSelectedPageKey] = useState('');
  const [pageData, setPageData] = useState<TranscriptAlignmentPageResponse | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionSegmentIds, setCorrectionSegmentIds] = useState<string[]>([]);
  const [correctionFailureModes, setCorrectionFailureModes] = useState<
    TranscriptAlignmentFailureMode[]
  >([]);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [productionRepairResolution, setProductionRepairResolution] =
    useState<ProductionRepairResolution>({ kind: 'idle' });
  const productionLetterCacheRef = useRef(new Map<string, Letter>());
  const currentSelectionRef = useRef({
    runId: '',
    pageKey: '',
    itemId: null as string | null,
  });

  useEffect(() => {
    const controller = new AbortController();
    getTranscriptAlignmentIndex(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        const usableRuns = response.runs.filter((run) => (
          run.letters.some((letter) => letter.pageKeys.length > 0)
        ));
        setRuns(usableRuns);
        setInvalidRunCount(response.invalidRuns.length);
        const firstRun = usableRuns[0];
        const firstLetter = firstRun?.letters[0];
        setSelectedRunId(firstRun?.runId ?? '');
        setSelectedLetterKey(firstLetter?.letterKey ?? '');
        setSelectedPageKey(firstLetter?.pageKeys[0] ?? '');
        setLoadingPage(Boolean(firstRun && firstLetter?.pageKeys[0]));
        setIndexError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setIndexError(getErrorMessage(
          error,
          'Transcript alignment experiments could not be loaded.',
        ));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingIndex(false);
      });
    return () => controller.abort();
  }, []);

  const selectedRun = useMemo(
    () => runs.find((run) => run.runId === selectedRunId),
    [runs, selectedRunId],
  );
  const selectedLetter = useMemo(
    () => selectedRun?.letters.find((letter) => letter.letterKey === selectedLetterKey),
    [selectedLetterKey, selectedRun],
  );

  useEffect(() => {
    if (!selectedRunId || !selectedPageKey) {
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const response = await getTranscriptAlignmentPage(
          selectedRunId,
          selectedPageKey,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        objectUrl = await getLayoutBenchmarkImageObjectUrl(
          response.page.image.url,
          controller.signal,
        );
        if (controller.signal.aborted) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setPageData(response);
        setImageUrl(objectUrl);
        setSelectedItemId(firstReviewItem(response.items)?.id ?? null);
        setReviewError(null);
        setCorrectionMode(false);
        setCorrectionSegmentIds([]);
        setCorrectionFailureModes([]);
        setCorrectionError(null);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setPageError(getErrorMessage(
          error,
          'This transcript alignment page could not be loaded.',
        ));
      } finally {
        if (!controller.signal.aborted) setLoadingPage(false);
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedPageKey, selectedRunId]);

  useEffect(() => {
    currentSelectionRef.current = {
      runId: selectedRunId,
      pageKey: selectedPageKey,
      itemId: selectedItemId,
    };
  }, [selectedItemId, selectedPageKey, selectedRunId]);

  useEffect(() => {
    const page = pageData?.page;
    if (!page) return undefined;

    let current = true;
    void resolveProductionRepairTarget(
      page,
      productionLetterCacheRef.current,
    )
      .then((target) => {
        if (!current) return;
        setProductionRepairResolution(target
          ? {
              kind: 'ready',
              pageKey: page.pageKey,
              target,
            }
          : {
              kind: 'unavailable',
              pageKey: page.pageKey,
            });
      })
      .catch(() => {
        if (!current) return;
        setProductionRepairResolution({
          kind: 'unavailable',
          pageKey: page.pageKey,
        });
      });

    return () => {
      current = false;
    };
  }, [pageData?.page]);

  const selectedItem = useMemo(
    () => pageData?.items.find((item) => item.id === selectedItemId) ?? null,
    [pageData, selectedItemId],
  );
  const segmentById = useMemo(
    () => new Map(pageData?.segments.map((segment) => [segment.id, segment]) ?? []),
    [pageData],
  );
  const selectedKrakenText = selectedItem
    ? segmentText(selectedItem.mapping.segmentIds, segmentById)
    : '';
  const selectedIsPlaceholder = Boolean(
    selectedItem && isStandaloneEditorialPlaceholder(selectedItem.transcriptText),
  );
  const selectedNeedsGeometryRepair = Boolean(
    selectedItem
    && (
      selectedItem.mapping.status === 'unlocated'
      || selectedItem.mapping.segmentIds.length === 0
      || selectedItem.review?.verdict === 'incorrect'
    )
  );
  const repairGeometryHref = useMemo(() => {
    if (
      !pageData
      || !selectedItem
      || productionRepairResolution.kind !== 'ready'
      || productionRepairResolution.pageKey !== pageData.page.pageKey
    ) {
      return null;
    }

    const params = new URLSearchParams({
      repairGeometry: '1',
      repairIntent: [
        pageData.artifactSha256,
        pageData.page.pageKey,
        selectedItem.id,
      ].join(':'),
      repairPageIndex: String(productionRepairResolution.target.pageIndex),
      repairPageFilename: productionRepairResolution.target.originalFilename,
    });
    if (
      !isStandaloneEditorialPlaceholder(selectedItem.transcriptText)
      && selectedItem.transcriptText.trim()
    ) {
      params.set('repairText', selectedItem.transcriptText.trim());
    }
    return `/admin/letters/${productionRepairResolution.target.letterId}?${params.toString()}`;
  }, [
    pageData,
    productionRepairResolution,
    selectedItem,
  ]);
  const savedIncorrectReview = (
    selectedItem?.review?.verdict === 'incorrect'
      ? selectedItem.review
      : null
  );
  const savedCorrectionText = savedIncorrectReview
    ? segmentText(savedIncorrectReview.correctSegmentIds, segmentById)
    : '';
  const savedCorrectionDescription = savedIncorrectReview
    ? savedIncorrectReview.correctSegmentIds.length > 0
      ? savedCorrectionText
      : savedIncorrectReview.failureModes.includes('missed-line')
        ? 'The text is visible, but Kraken produced no usable image outline.'
        : 'The reviewer marked this transcript line as not present on this page.'
    : '';
  const sharedConnectedItems = useMemo(() => {
    if (!pageData || !selectedItem || selectedItem.mapping.segmentIds.length === 0) {
      return [];
    }
    const selectedIds = new Set(selectedItem.mapping.segmentIds);
    return pageData.items
      .filter((item) => item.mapping.segmentIds.some((segmentId) => selectedIds.has(segmentId)))
      .sort((left, right) => left.sourceLineNumber - right.sourceLineNumber);
  }, [pageData, selectedItem]);
  const selectedAlternatives = selectedItem
    ? selectedItem.mapping.alternatives.filter((alternative) => (
      !sameSegments(alternative.segmentIds, selectedItem.mapping.segmentIds)
    ))
    : [];
  const currentItemIndex = selectedItem && pageData
    ? pageData.items.findIndex((item) => item.id === selectedItem.id)
    : -1;
  const reviewTimerIdentity = selectedItem && pageData
    ? `${pageData.run.runId}:${pageData.page.pageKey}:${selectedItem.id}`
    : '';
  const reviewTimer = useReviewTimer(
    reviewTimerIdentity,
    (selectedItem?.review?.activeSeconds ?? 0) * 1000,
  );
  const {
    start: startReviewTimer,
    pause: pauseReviewTimer,
    markSaved: markReviewTimerSaved,
  } = reviewTimer;

  useEffect(() => {
    if (!reviewTimerIdentity) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) startReviewTimer();
    });
    return () => {
      cancelled = true;
      pauseReviewTimer();
    };
  }, [pauseReviewTimer, reviewTimerIdentity, startReviewTimer]);

  const preparePageChange = () => {
    if (savingReview) return;
    setLoadingPage(true);
    setPageData(null);
    setImageUrl(null);
    setPageError(null);
    setImageError(null);
    setSelectedItemId(null);
    setCorrectionMode(false);
    setCorrectionSegmentIds([]);
    setCorrectionFailureModes([]);
    setCorrectionError(null);
    setReviewError(null);
  };

  const selectItem = (itemId: string | null, force = false) => {
    if (savingReview && !force) return;
    setSelectedItemId(itemId);
    setCorrectionMode(false);
    setCorrectionSegmentIds([]);
    setCorrectionFailureModes([]);
    setCorrectionError(null);
    setReviewError(null);
  };

  const selectRun = (runId: string) => {
    if (savingReview) return;
    const run = runs.find((candidate) => candidate.runId === runId);
    const letter = run?.letters[0];
    preparePageChange();
    setSelectedRunId(runId);
    setSelectedLetterKey(letter?.letterKey ?? '');
    setSelectedPageKey(letter?.pageKeys[0] ?? '');
  };

  const selectLetter = (letterKey: string) => {
    if (savingReview) return;
    const letter = selectedRun?.letters.find((candidate) => candidate.letterKey === letterKey);
    preparePageChange();
    setSelectedLetterKey(letterKey);
    setSelectedPageKey(letter?.pageKeys[0] ?? '');
  };

  const movePage = (delta: number) => {
    if (savingReview) return;
    const target = nextPageKey(selectedLetter, selectedPageKey, delta);
    if (target) {
      preparePageChange();
      setSelectedPageKey(target);
    }
  };

  const moveItem = (delta: number) => {
    if (!pageData || pageData.items.length === 0) return;
    const nextIndex = Math.max(
      0,
      Math.min(pageData.items.length - 1, currentItemIndex + delta),
    );
    selectItem(pageData.items[nextIndex]?.id ?? null);
  };

  const selectNextUncertain = () => {
    if (!pageData) return;
    const uncertain = pageData.items.filter((item) => item.mapping.status !== 'accepted');
    if (uncertain.length === 0) return;
    const currentUncertainIndex = uncertain.findIndex((item) => item.id === selectedItemId);
    selectItem(uncertain[(currentUncertainIndex + 1) % uncertain.length].id);
  };

  const saveReview = async (
    verdict: TranscriptAlignmentVerdict,
    options: {
      correctSegmentIds?: string[];
      failureModes?: TranscriptAlignmentFailureMode[];
      repairActions?: number;
    } = {},
  ) => {
    if (!pageData || !selectedItem || savingReview) return;
    const runId = pageData.run.runId;
    const pageKey = pageData.page.pageKey;
    const transcriptId = selectedItem.id;
    const activeSeconds = pauseReviewTimer() / 1000;
    setSavingReview(true);
    setReviewError(null);
    try {
      const result = await putTranscriptAlignmentReview(
        runId,
        pageKey,
        transcriptId,
        {
          expectedArtifactSha256: pageData.artifactSha256,
          verdict,
          ...(options.correctSegmentIds === undefined
            ? {}
            : { correctSegmentIds: options.correctSegmentIds }),
          failureModes: options.failureModes ?? [],
          activeSeconds,
          repairActions: options.repairActions ?? 0,
        },
      );
      if (
        currentSelectionRef.current.runId !== runId
        || currentSelectionRef.current.pageKey !== pageKey
        || currentSelectionRef.current.itemId !== transcriptId
      ) {
        return;
      }
      const updatedItems = pageData.items.map((item) => (
        item.id === transcriptId ? { ...item, review: result.review } : item
      ));
      setPageData({
        ...pageData,
        summary: {
          ...pageData.summary,
          reviewProgress: result.progress,
        },
        items: updatedItems,
      });
      markReviewTimerSaved();
      selectItem(nextReviewItem(updatedItems, transcriptId)?.id ?? transcriptId, true);
    } catch (error: unknown) {
      if (
        currentSelectionRef.current.runId === runId
        && currentSelectionRef.current.pageKey === pageKey
        && currentSelectionRef.current.itemId === transcriptId
      ) {
        setReviewError(
          error instanceof ApiError
            && error.status === 409
            && error.code === 'ALIGNMENT_ARTIFACT_CHANGED'
            ? 'This experiment changed. Reload the page before saving this judgment.'
            : getErrorMessage(error, 'This judgment could not be saved.'),
        );
        startReviewTimer();
      }
    } finally {
      setSavingReview(false);
    }
  };

  const beginCorrection = () => {
    if (!selectedItem || savingReview) return;
    setCorrectionMode(true);
    setCorrectionSegmentIds(
      selectedItem.review?.verdict === 'incorrect'
        ? selectedItem.review.correctSegmentIds
        : [],
    );
    setCorrectionFailureModes(
      selectedItem.review?.verdict === 'incorrect'
        ? selectedItem.review.failureModes
        : inferredFailureModes(selectedItem),
    );
    setCorrectionError(null);
    setReviewError(null);
  };

  const cancelCorrection = () => {
    if (savingReview) return;
    setCorrectionMode(false);
    setCorrectionSegmentIds([]);
    setCorrectionFailureModes([]);
    setCorrectionError(null);
  };

  const toggleCorrectionSegment = (segmentId: string) => {
    if (!correctionMode || savingReview) return;
    setCorrectionSegmentIds((current) => {
      if (current.includes(segmentId)) {
        setCorrectionError(null);
        return current.filter((candidate) => candidate !== segmentId);
      }
      if (current.length >= MAXIMUM_CORRECTION_SEGMENTS) {
        setCorrectionError(
          `Choose no more than ${MAXIMUM_CORRECTION_SEGMENTS} image lines.`,
        );
        return current;
      }
      setCorrectionError(null);
      return [...current, segmentId];
    });
  };

  const toggleFailureMode = (failureMode: TranscriptAlignmentFailureMode) => {
    if (!correctionMode || savingReview) return;
    setCorrectionFailureModes((current) => (
      current.includes(failureMode)
        ? current.filter((candidate) => candidate !== failureMode)
        : [...current, failureMode]
    ));
  };

  const saveCorrection = (
    correctSegmentIds: string[],
    intent: 'selected-lines' | 'no-detected-line' | 'not-on-page' = 'selected-lines',
  ) => {
    if (!selectedItem || savingReview) return;
    if (
      intent !== 'no-detected-line'
      && sameSegments(correctSegmentIds, selectedItem.mapping.segmentIds)
    ) {
      setCorrectionError(
        correctSegmentIds.length === 0
          ? 'This candidate already found no image line. Use No detected line if the text is visible, or cancel and mark it Correct if the text is absent.'
          : 'Choose different image lines, or cancel and mark this connection Correct.',
      );
      return;
    }
    const failureModes = intent === 'no-detected-line'
      ? Array.from(new Set([...correctionFailureModes, 'missed-line' as const]))
      : correctionFailureModes.filter((failureMode) => (
        intent !== 'not-on-page' || failureMode !== 'missed-line'
      ));
    void saveReview('incorrect', {
      correctSegmentIds,
      failureModes,
      repairActions: correctionRepairActions(
        selectedItem.mapping.segmentIds,
        correctSegmentIds,
      ),
    });
  };

  const previousPage = nextPageKey(selectedLetter, selectedPageKey, -1);
  const followingPage = nextPageKey(selectedLetter, selectedPageKey, 1);
  const hasUncertain = Boolean(
    pageData?.items.some((item) => item.mapping.status !== 'accepted'),
  );
  const correctionMatchesCandidate = Boolean(
    selectedItem
    && sameSegments(correctionSegmentIds, selectedItem.mapping.segmentIds),
  );
  const navigationLocked = savingReview || correctionMode;

  return (
    <AdminLayout fullHeight>
      <section className="transcript-alignment-page">
        <header className="transcript-alignment-toolbar">
          <nav className="transcript-alignment-tabs" aria-label="Layout lab views">
            <Link
              to="/admin/layout-benchmark"
              aria-disabled={navigationLocked}
              onClick={(event) => {
                if (navigationLocked) event.preventDefault();
              }}
            >
              Layout comparison
            </Link>
            <span aria-current="page">Transcript alignment</span>
          </nav>

          <div className="transcript-alignment-selectors">
            <label>
              <span>Experiment</span>
              <select
                aria-label="Alignment experiment"
                value={selectedRunId}
                disabled={loadingIndex || runs.length === 0 || navigationLocked}
                onChange={(event) => selectRun(event.target.value)}
              >
                {runs.map((run) => (
                  <option key={run.runId} value={run.runId} title={run.runId}>
                    {runOptionLabel(run)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Letter</span>
              <select
                aria-label="Benchmark letter"
                value={selectedLetterKey}
                disabled={!selectedRun || navigationLocked}
                onChange={(event) => selectLetter(event.target.value)}
              >
                {selectedRun?.letters.map((letter) => (
                  <option key={letter.letterKey} value={letter.letterKey}>
                    {letter.letterKey} · {letter.pageKeys.length} page{letter.pageKeys.length === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>

            <div className="transcript-alignment-page-picker">
              <button
                type="button"
                aria-label="Previous page"
                disabled={!previousPage || navigationLocked}
                onClick={() => movePage(-1)}
              >
                ‹
              </button>
              <label>
                <span>Page</span>
                <select
                  aria-label="Benchmark page"
                  value={selectedPageKey}
                  disabled={!selectedLetter || navigationLocked}
                  onChange={(event) => {
                    preparePageChange();
                    setSelectedPageKey(event.target.value);
                  }}
                >
                  {selectedLetter?.pageKeys.map((pageKey) => (
                    <option key={pageKey} value={pageKey}>
                      {pageNumberFromKey(pageKey)} / {selectedLetter.pageKeys.length}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label="Next page"
                disabled={!followingPage || navigationLocked}
                onClick={() => movePage(1)}
              >
                ›
              </button>
            </div>
          </div>

          <label className="transcript-alignment-zoom">
            <span>Zoom</span>
            <input
              aria-label="Image zoom"
              type="range"
              min="1"
              max="2.5"
              step="0.1"
              value={zoom}
              disabled={savingReview}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
        </header>

        {loadingIndex ? (
          <div className="transcript-alignment-state" role="status">
            Loading alignment experiments…
          </div>
        ) : indexError ? (
          <div className="transcript-alignment-state is-error" role="alert">
            <strong>Alignment review is unavailable</strong>
            <span>{indexError}</span>
          </div>
        ) : runs.length === 0 ? (
          <div className="transcript-alignment-state" role="status">
            <strong>No transcript alignments yet</strong>
            <span>Run the local alignment experiment, then refresh this page.</span>
            {invalidRunCount > 0 ? (
              <span>{invalidRunCount} invalid local artifact{invalidRunCount === 1 ? '' : 's'} were ignored.</span>
            ) : null}
          </div>
        ) : loadingPage ? (
          <div className="transcript-alignment-state" role="status">
            Loading the scan and its transcript matches…
          </div>
        ) : pageError || !pageData || !imageUrl ? (
          <div className="transcript-alignment-state is-error" role="alert">
            <strong>This page could not be shown</strong>
            <span>{pageError ?? 'The alignment artifact is incomplete.'}</span>
          </div>
        ) : (
          <div className="transcript-alignment-workspace">
            <section className="transcript-alignment-stage" aria-label="Letter image and line matches">
              <div className="transcript-alignment-stage-heading">
                <div>
                  <strong>{pageData.page.pageKey}</strong>
                  <span>{pageData.transcriptSource.label}</span>
                </div>
                <div className="transcript-alignment-counts" aria-label="Alignment status counts">
                  <span className="is-accepted">
                    {pageData.summary.statusCounts.accepted} strong
                  </span>
                  <span className="is-ambiguous">
                    {pageData.summary.statusCounts.ambiguous} review
                  </span>
                  <span className="is-unlocated">
                    {pageData.summary.statusCounts.unlocated} not located
                  </span>
                </div>
              </div>

              <div className="transcript-alignment-image-scroll">
                <TranscriptAlignmentCanvas
                  page={pageData}
                  imageUrl={imageUrl}
                  selectedItemId={selectedItemId}
                  zoom={zoom}
                  onSelectItem={(itemId) => selectItem(itemId)}
                  correctionMode={correctionMode}
                  correctionSegmentIds={correctionSegmentIds}
                  onToggleCorrectionSegment={toggleCorrectionSegment}
                  disabled={savingReview}
                  onImageError={() => setImageError('The prepared letter image could not be decoded.')}
                />
                {imageError ? (
                  <div className="transcript-alignment-image-error" role="alert">
                    {imageError}
                  </div>
                ) : null}
              </div>

              <div className="transcript-alignment-legend" aria-label="Line overlay legend">
                <span className="is-selected">Selected proposal</span>
                <span className="is-accepted">Strong match</span>
                <span className="is-ambiguous">Needs review</span>
                <span className="is-deferred">Rotated text later</span>
                <span className="is-skipped">Unassigned detection</span>
                {correctionMode ? (
                  <span className="is-correction">Your correction</span>
                ) : null}
                {savedIncorrectReview ? (
                  <>
                    <span className="is-rejected">Rejected proposal</span>
                    {savedIncorrectReview.correctSegmentIds.length > 0 ? (
                      <span className="is-saved-correction">Saved correction</span>
                    ) : null}
                  </>
                ) : null}
              </div>
            </section>

            <aside className="transcript-alignment-inspector" aria-label="Selected transcript match">
              {selectedItem ? (
                <>
                  <header className="transcript-alignment-inspector-heading">
                    <div>
                      <span>Transcript line {selectedItem.sourceLineNumber}</span>
                      <strong className={
                        selectedIsPlaceholder
                          ? 'is-placeholder'
                          : `is-${selectedItem.mapping.status}`
                      }>
                        {selectedIsPlaceholder
                          ? 'Unresolved placeholder'
                          : statusLabel(selectedItem.mapping.status)}
                      </strong>
                    </div>
                    <div className="transcript-alignment-inspector-heading-actions">
                      <span>
                        {pageData.summary.reviewProgress.reviewedCount}
                        {' / '}
                        {pageData.summary.reviewProgress.totalCount}
                        {' judged'}
                      </span>
                      {selectedNeedsGeometryRepair ? (
                        repairGeometryHref ? (
                          <Link
                            className="transcript-alignment-repair-link"
                            to={repairGeometryHref}
                            aria-disabled={navigationLocked}
                            onClick={(event) => {
                              if (navigationLocked) event.preventDefault();
                            }}
                          >
                            Repair geometry
                          </Link>
                        ) : productionRepairResolution.kind === 'unavailable'
                          && productionRepairResolution.pageKey === pageData.page.pageKey ? (
                            <Link
                              className="transcript-alignment-repair-link is-fallback"
                              to="/admin"
                              title="This local result does not expose a database letter ID, and its filename did not uniquely match a live production page."
                            >
                              Find production letter
                            </Link>
                          ) : (
                            <span className="transcript-alignment-repair-resolving">
                              Finding editor…
                            </span>
                          )
                      ) : null}
                    </div>
                  </header>

                  <div className={[
                    'transcript-alignment-verdict-control',
                    correctionMode ? 'is-correction-mode' : '',
                  ].filter(Boolean).join(' ')}>
                    {correctionMode ? (
                      <>
                        <div className="transcript-alignment-correction-instructions">
                          <strong>Show the correct location</strong>
                          <span>
                            Select up to {MAXIMUM_CORRECTION_SEGMENTS} image lines
                            {' · '}
                            {correctionSegmentIds.length}
                            {' / '}
                            {MAXIMUM_CORRECTION_SEGMENTS} selected
                          </span>
                        </div>
                        <div
                          className="transcript-alignment-failure-modes"
                          role="group"
                          aria-label="What caused the wrong connection?"
                        >
                          {FAILURE_MODES.map((failureMode) => (
                            <button
                              key={failureMode.value}
                              type="button"
                              aria-pressed={correctionFailureModes.includes(failureMode.value)}
                              disabled={savingReview}
                              onClick={() => toggleFailureMode(failureMode.value)}
                            >
                              {failureMode.label}
                            </button>
                          ))}
                        </div>
                        <div className="transcript-alignment-correction-actions">
                          <button
                            type="button"
                            className="is-primary"
                            disabled={
                              savingReview
                              || correctionSegmentIds.length === 0
                              || correctionMatchesCandidate
                            }
                            onClick={() => saveCorrection(
                              correctionSegmentIds,
                              'selected-lines',
                            )}
                          >
                            Save correction
                          </button>
                          <button
                            type="button"
                            disabled={savingReview}
                            title="The transcript text is visible, but Kraken produced no usable line outline."
                            onClick={() => saveCorrection([], 'no-detected-line')}
                          >
                            No detected line
                          </button>
                          <button
                            type="button"
                            disabled={
                              savingReview
                              || selectedItem.mapping.segmentIds.length === 0
                            }
                            title="The transcript text is not present anywhere on this image."
                            onClick={() => saveCorrection([], 'not-on-page')}
                          >
                            Not on page
                          </button>
                          <button
                            type="button"
                            disabled={savingReview}
                            onClick={cancelCorrection}
                          >
                            Cancel
                          </button>
                        </div>
                        {correctionMatchesCandidate ? (
                          <span className="transcript-alignment-correction-help">
                            {correctionSegmentIds.length === 0
                              ? 'Visible text without a usable outline? Choose No detected line. If the text is absent, cancel and mark it Correct.'
                              : 'Choose different image lines, or cancel and mark this connection Correct.'}
                          </span>
                        ) : null}
                        {correctionError ? <span role="alert">{correctionError}</span> : null}
                      </>
                    ) : (
                      <>
                        <span>
                          {selectedIsPlaceholder
                            ? 'Is this unresolved placeholder handled correctly?'
                            : 'Is this connection right?'}
                        </span>
                        <div className="transcript-alignment-verdict-buttons">
                          <button
                            type="button"
                            className="is-correct"
                            aria-pressed={selectedItem.review?.verdict === 'correct'}
                            disabled={savingReview}
                            onClick={() => void saveReview('correct', {
                              correctSegmentIds: selectedItem.mapping.segmentIds,
                            })}
                          >
                            Correct
                          </button>
                          <button
                            type="button"
                            className="is-wrong"
                            aria-pressed={selectedItem.review?.verdict === 'incorrect'}
                            disabled={savingReview}
                            onClick={beginCorrection}
                          >
                            Wrong
                          </button>
                          <button
                            type="button"
                            aria-pressed={selectedItem.review?.verdict === 'unsure'}
                            disabled={savingReview}
                            onClick={() => void saveReview('unsure')}
                          >
                            Unsure
                          </button>
                        </div>
                      </>
                    )}
                    {reviewError ? <span role="alert">{reviewError}</span> : null}
                  </div>

                  <div className="transcript-alignment-inspector-scroll">
                    <section className={[
                      'transcript-alignment-text-block',
                      selectedIsPlaceholder ? 'is-placeholder' : '',
                    ].filter(Boolean).join(' ')}>
                      <header className="transcript-alignment-text-block-heading">
                        <h2>Reference transcript</h2>
                        <span>{pageData.transcriptSource.label}</span>
                      </header>
                      <p>{selectedItem.transcriptText}</p>
                      {selectedIsPlaceholder ? (
                        <span className="transcript-alignment-placeholder-help">
                          No transcribed wording is available yet, so this line cannot be
                          connected by text alone.
                        </span>
                      ) : null}
                    </section>

                    {savedIncorrectReview ? (
                      <section className="transcript-alignment-text-block is-saved-correction">
                        <h2>Saved correction</h2>
                        <p>{savedCorrectionDescription}</p>
                      </section>
                    ) : null}

                    <section className={[
                      'transcript-alignment-text-block',
                      'is-rough-ocr',
                      savedIncorrectReview ? 'is-rejected-proposal' : '',
                    ].filter(Boolean).join(' ')}>
                      <h2>
                        {savedIncorrectReview
                          ? 'Rejected algorithm proposal'
                          : selectedIsPlaceholder
                            ? 'Kraken clue (not verified wording)'
                            : 'Kraken’s rough reading'}
                      </h2>
                      <p>{selectedKrakenText}</p>
                    </section>

                    {selectedIsPlaceholder ? (
                      <section className="transcript-alignment-placeholder-state">
                        <h2>Placeholder state</h2>
                        <p>
                          The brackets record unreadable or missing wording. Any nearby
                          Kraken reading is only a clue, not a verified content match.
                        </p>
                      </section>
                    ) : (
                      <section className="transcript-alignment-match-summary">
                        <h2>
                          {savedIncorrectReview
                            ? 'Why the algorithm proposed it'
                            : 'Why these pieces are connected'}
                        </h2>
                        <p>{operationLabel(selectedItem.mapping.operation)}</p>
                        <dl>
                          <div>
                            <dt>Match confidence</dt>
                            <dd>{percent(selectedItem.mapping.confidence)}</dd>
                          </div>
                          <div>
                            <dt>Text similarity</dt>
                            <dd>{percent(selectedItem.mapping.similarity)}</dd>
                          </div>
                          <div>
                            <dt>Image lines</dt>
                            <dd>{selectedItem.mapping.segmentIds.length || 'None'}</dd>
                          </div>
                        </dl>
                      </section>
                    )}

                    {sharedConnectedItems.length > 1 ? (
                      <section className="transcript-alignment-shared-lines">
                        <h2>Transcript lines on this outline</h2>
                        <p>
                          This image outline connects to {sharedConnectedItems.length}
                          {' '}transcript lines. Choose a line explicitly.
                        </p>
                        <ul aria-label="Connected transcript lines">
                          {sharedConnectedItems.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                aria-pressed={item.id === selectedItem.id}
                                disabled={navigationLocked}
                                onClick={() => selectItem(item.id)}
                              >
                                <strong>Line {item.sourceLineNumber}</strong>
                                <span>{item.transcriptText}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {!selectedIsPlaceholder && selectedAlternatives.length > 0 ? (
                      <section className="transcript-alignment-alternatives">
                        <h2>Other plausible image matches</h2>
                        {selectedAlternatives.slice(0, 3).map((alternative, index) => (
                          <article key={`${alternative.segmentIds.join(':')}:${index}`}>
                            <div>
                              <strong>Alternative {index + 1}</strong>
                              <span>{percent(alternative.support)} support</span>
                            </div>
                            <p>{segmentText(alternative.segmentIds, segmentById)}</p>
                          </article>
                        ))}
                      </section>
                    ) : null}
                  </div>

                  <footer className="transcript-alignment-inspector-actions">
                    <button
                      type="button"
                      disabled={currentItemIndex <= 0 || navigationLocked}
                      onClick={() => moveItem(-1)}
                    >
                      Previous line
                    </button>
                    <button
                      type="button"
                      className="is-primary"
                      disabled={!hasUncertain || navigationLocked}
                      onClick={selectNextUncertain}
                    >
                      Next uncertain
                    </button>
                  </footer>
                </>
              ) : (
                <div className="transcript-alignment-inspector-empty">
                  No transcript lines are available on this page.
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
    </AdminLayout>
  );
}
