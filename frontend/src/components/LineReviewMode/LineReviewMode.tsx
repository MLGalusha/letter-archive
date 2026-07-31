import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { ApiError, getErrorMessage, getImageUrl } from '../../api/client';
import {
  getPageGeometry,
  savePageLineSegments,
  updatePageSegmentTrust,
  type PageGeometryEnvelope,
  type PageGeometryReviewState,
} from '../../api/admin/letters';
import type { Letter, LineSegment, LineSegmentWord, SpecialArea } from '../../types/Letter';
import {
  lineSegmentsSignature,
  useSegmentEditor,
} from '../../hooks/useSegmentEditor';
import SegmentEditorOverlay from './SegmentEditorOverlay';
import SegmentContextMenu from './SegmentContextMenu';
import {
  buildProductionReviewLines,
  type ProductionReviewLine as AlignedLine,
} from './productionAlignmentView';
import {
  useProductionTranscriptAlignment,
} from './useProductionTranscriptAlignment';
import { useToast } from '../../contexts/ToastContext';
import { highlightTranscriptMarkers } from '../../utils/transcriptHighlight';
import {
  CSS_BORDER_PADDING,
  computeAutoScrollTop,
  computeLineInputHeight,
  computeLineFontSize,
  measureRenderedTextWidth,
  mergeEditedTextWithOriginalSpacing,
  normalizeReviewLineText,
  splitTranscriptByPage,
} from './lineReviewUtils';
import './LineReviewMode.css';

interface LineReviewModeProps {
  letter: Letter;
  transcript: string;
  onTranscriptChange: (newFullTranscript: string) => void;
  onExit: () => void;
  onAutoSave: (data: { transcriptionText: string }) => void;
  handleMutationError: (error: unknown, fallback: string) => boolean;
  mutationsBlocked?: boolean;
  navigationPending?: boolean;
  debugMode?: boolean;
  onDebugModeChange?: (debugMode: boolean) => void;
  initialPageIndex?: number;
  /** When true, renders as full-viewport takeover (no admin header/sidebar visible). */
  fullViewport?: boolean;
  /** Transcript context for a geometry repair. Does not enter mapping mode. */
  repairText?: string;
}

export interface LineReviewModeHandle {
  saveCurrentLine: () => void;
  flushPendingChanges: () => Promise<boolean>;
  hasPendingChanges: () => boolean;
  reloadSegments: () => void;
  isLoading: boolean;
}

interface SegmentSaveState {
  page: Letter['images'][number];
  letterPageIndex: number;
  editRevision: number;
  isDirty: boolean;
  getSegmentsForSave: () => LineSegment[];
}

type GeometrySaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

interface PageGeometryState {
  geometryRevision: number;
  geometryChecksumSha256: string;
  lineSegmentsChecksumSha256: string;
  reviewState: PageGeometryReviewState;
}

function geometryFailureStatus(error: unknown): GeometrySaveStatus {
  if (
    error instanceof ApiError
    && error.code === 'SOURCE_REVISION_CHANGED'
  ) {
    return 'error';
  }
  if (
    error instanceof ApiError
    && (
      error.status === 409
      || error.code === 'GEOMETRY_REVISION_CHANGED'
      || error.code === 'LINE_SEGMENTS_CHANGED'
    )
  ) {
    return 'conflict';
  }
  return 'error';
}

function geometrySaveStatusLabel(status: GeometrySaveStatus): string {
  switch (status) {
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'conflict':
      return 'Newer edits exist — reload';
    case 'error':
      return 'Save failed';
    default:
      return 'Ready';
  }
}

/**
 * Computes a representative font size for the page (used as fallback).
 * Compares OCR line widths to rendered text widths using Pretext measurement.
 */
function computePageFontSize(
  alignedLines: AlignedLine[],
  scaleFactor: number,
): number {
  const REF_SIZE = 16;
  let totalOcrWidth = 0;
  let totalRenderedWidth = 0;

  for (let i = 0; i < alignedLines.length; i++) {
    const line = alignedLines[i];
    if (!line.words || line.words.length === 0) continue;
    const text = line.transcriptText.trim();
    if (!text) continue;

    const lineLeft = Math.min(...line.words.map(w => w.bbox[0]));
    const lineRight = Math.max(...line.words.map(w => w.bbox[2]));
    totalOcrWidth += (lineRight - lineLeft) * scaleFactor;
    totalRenderedWidth += measureRenderedTextWidth(text, REF_SIZE);
  }

  if (totalRenderedWidth <= 0 || totalOcrWidth <= 0) return 14;
  const fontSize = Math.round(REF_SIZE * totalOcrWidth / totalRenderedWidth);
  return Math.max(8, Math.min(36, fontSize));
}

/**
 * Fills a contentEditable div with transcript text, sized and spaced to match
 * the OCR line's horizontal span. Uses per-line font-size and word-spacing
 * so the text fills from the leftmost to rightmost OCR word coordinate.
 * Falls back to plain text when no OCR words are available.
 */
function buildWordPositionedContent(
  div: HTMLDivElement,
  text: string,
  ocrWords: LineSegmentWord[] | undefined,
  contentAreaLeftDisplay: number,
  scaleFactor: number,
  lineBbox?: [number, number, number, number],
  maxFontSize = 72,
): void {
  div.innerHTML = '';
  div.style.fontSize = '';
  div.style.wordSpacing = '';
  div.style.textIndent = '';

  if (!text) return;

  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return;
  const joined = words.join(' ');

  // Compute line text bounds from OCR word bboxes or fall back to line bbox
  let lineLeftX: number;
  let lineRightX: number;
  if (ocrWords && ocrWords.length > 0) {
    lineLeftX = Math.min(...ocrWords.map(w => w.bbox[0]));
    lineRightX = Math.max(...ocrWords.map(w => w.bbox[2]));
  } else if (lineBbox) {
    lineLeftX = lineBbox[0];
    lineRightX = lineBbox[2];
  } else {
    div.innerHTML = highlightTranscriptMarkers(joined);
    return;
  }

  const lineLeftDisplay = lineLeftX * scaleFactor;
  const lineRightDisplay = lineRightX * scaleFactor;
  const targetWidth = lineRightDisplay - lineLeftDisplay;

  if (targetWidth <= 0) {
    div.innerHTML = highlightTranscriptMarkers(joined);
    return;
  }

  // Left offset: where the text should start inside the content area
  const leftOffset = lineLeftDisplay - contentAreaLeftDisplay;

  const REF_SIZE = 16;
  const refWidth = measureRenderedTextWidth(joined, REF_SIZE);
  if (refWidth <= 0) { div.innerHTML = highlightTranscriptMarkers(joined); return; }

  const fontSize = Math.max(8, Math.min(maxFontSize, REF_SIZE * targetWidth / refWidth));

  // Fine-tune with word-spacing using real DOM-rendered widths.
  let wordSpacing = 0;
  if (words.length > 1) {
    const actualWidth = measureRenderedTextWidth(joined, fontSize);
    wordSpacing = (targetWidth - actualWidth) / (words.length - 1);
  }

  // Apply per-line styles
  div.style.fontSize = `${fontSize}px`;
  if (Math.abs(wordSpacing) > 0.1) {
    div.style.wordSpacing = `${wordSpacing}px`;
  }
  if (leftOffset > 0.5) {
    div.style.textIndent = `${leftOffset}px`;
  }

  div.innerHTML = highlightTranscriptMarkers(joined);
}

const LineReviewMode = forwardRef<LineReviewModeHandle, LineReviewModeProps>(function LineReviewMode({
  letter,
  transcript,
  onTranscriptChange,
  onExit,
  onAutoSave,
  handleMutationError,
  mutationsBlocked = false,
  navigationPending = false,
  debugMode: debugLines = false,
  onDebugModeChange,
  initialPageIndex,
  fullViewport = false,
  repairText,
}: LineReviewModeProps, ref) {
  const { showToast } = useToast();
  const mutationsBlockedRef = useRef(mutationsBlocked);
  const navigationPendingRef = useRef(navigationPending);
  mutationsBlockedRef.current = mutationsBlocked;
  navigationPendingRef.current = navigationPending;

  // All images (letter + extra content) for page navigation
  const allPages = useMemo(() => letter.images, [letter.images]);

  // Letter-only pages for transcript/line detection
  const letterPages = useMemo(
    () => letter.images.filter((img) => img.type === 'letter'),
    [letter.images],
  );
  const primarySourceRevision = letter.primarySourceRevision;
  const sourceExpectation = useCallback((page: Letter['images'][number]) => ({
    primarySourceRevision,
    sourceChecksum: page.sourceChecksum ?? null,
  }), [primarySourceRevision]);

  // Set of allPages indices that are letter-type
  const letterPageIndices = useMemo(() => {
    const set = new Set<number>();
    allPages.forEach((img, idx) => {
      if (img.type === 'letter') set.add(idx);
    });
    return set;
  }, [allPages]);

  // Map allPages index → letter-page-only index (for transcript splitting)
  const allToLetterIndex = useMemo(() => {
    const map = new Map<number, number>();
    let letterIdx = 0;
    allPages.forEach((img, idx) => {
      if (img.type === 'letter') {
        map.set(idx, letterIdx);
        letterIdx++;
      }
    });
    return map;
  }, [allPages]);

  const [currentPageIndex, setCurrentPageIndex] = useState(initialPageIndex ?? 0);
  // Letter-page index for transcript/detection lookups (undefined for non-letter pages)
  const currentLetterPageIndex = allToLetterIndex.get(currentPageIndex);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 });

  // AI-detected line segments per page (cached across page switches)
  // Keyed by letter-page index (not allPages index)
  // undefined = not attempted, null = in progress, LineSegment[] = done
  const [aiSegmentsMap, setAiSegmentsMap] = useState<Record<number, LineSegment[] | null | undefined>>(() => {
    const initial: Record<number, LineSegment[] | null | undefined> = {};
    letterPages.forEach((page, index) => {
      if (Array.isArray(page.lineSegments)) {
        initial[index] = page.lineSegments;
      }
    });
    return initial;
  });

  // Overlay toggle (dimmer + input strip)
  const [overlayEnabled, setOverlayEnabled] = useState(true);
  // Fit-height toggle
  const [fitHeight, setFitHeight] = useState(fullViewport);
  // Zoom + pan for fit-height mode
  const [fitZoom, setFitZoom] = useState(1);
  const [fitPan, setFitPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const minimapDragRef = useRef<{ pointerId: number; rect: DOMRect } | null>(null);

  // Debug overlay layer toggles
  const [showKrakenLines, setShowKrakenLines] = useState(true);
  const [showExcludedContent, setShowExcludedContent] = useState(false);

  // Raw Kraken line segments per page (for debug overlay, never reconciled)
  const [krakenSegmentsMap, setKrakenSegmentsMap] = useState<Record<number, LineSegment[] | undefined>>(() => {
    const initial: Record<number, LineSegment[] | undefined> = {};
    letterPages.forEach((page, index) => {
      if (Array.isArray(page.lineSegments)) {
        initial[index] = page.lineSegments;
      }
    });
    return initial;
  });

  const [geometryStateMap, setGeometryStateMap] = useState<Record<string, PageGeometryState>>(() => {
    const initial: Record<string, PageGeometryState> = {};
    for (const page of letterPages) {
      initial[page.id] = {
        geometryRevision: page.geometryRevision ?? 0,
        geometryChecksumSha256: page.geometryChecksumSha256 ?? '',
        lineSegmentsChecksumSha256:
          page.lineSegmentsChecksumSha256 ?? '',
        reviewState: {
          trustState: page.segmentTrustState ?? 'unverified',
          approvedGeometryRevision: page.segmentTrustState === 'trusted'
            ? page.geometryRevision ?? 0
            : null,
          approvedGeometryChecksumSha256: page.segmentTrustState === 'trusted'
            ? page.geometryChecksumSha256 ?? null
            : null,
          approvedBy: null,
          approvedAt: null,
        },
      };
    }
    return initial;
  });
  const geometryStateRef = useRef(geometryStateMap);
  geometryStateRef.current = geometryStateMap;
  const alignmentGeometryExpectations = useMemo(
    () => letterPages.map((page) => {
      const geometry = geometryStateMap[page.id];
      return {
        pageId: page.id,
        geometryRevision: geometry?.geometryRevision ?? 0,
        geometryChecksumSha256:
          geometry?.geometryChecksumSha256 ?? '',
        lineSegmentsChecksumSha256:
          geometry?.lineSegmentsChecksumSha256 ?? '',
      };
    }),
    [geometryStateMap, letterPages],
  );
  const {
    envelope: productionAlignment,
    status: productionAlignmentStatus,
    error: productionAlignmentError,
    refresh: refreshProductionAlignment,
  } = useProductionTranscriptAlignment(
    letter.id,
    primarySourceRevision,
    letter.transcriptRevision,
    letter.transcriptChecksumSha256,
    alignmentGeometryExpectations,
  );
  const [geometrySaveStatusMap, setGeometrySaveStatusMap] = useState<
    Record<string, GeometrySaveStatus>
  >({});

  const applyGeometryEnvelope = useCallback((
    pageId: string,
    letterPageIndex: number,
    envelope: PageGeometryEnvelope,
  ) => {
    const nextState: PageGeometryState = {
      geometryRevision: envelope.geometryRevision,
      geometryChecksumSha256: envelope.geometryChecksumSha256,
      lineSegmentsChecksumSha256: envelope.lineSegmentsChecksumSha256,
      reviewState: envelope.reviewState,
    };
    geometryStateRef.current = {
      ...geometryStateRef.current,
      [pageId]: nextState,
    };
    setGeometryStateMap((previous) => ({
      ...previous,
      [pageId]: nextState,
    }));
    setAiSegmentsMap((previous) => ({
      ...previous,
      [letterPageIndex]: envelope.lineSegments,
    }));
    setKrakenSegmentsMap((previous) => ({
      ...previous,
      [letterPageIndex]: envelope.lineSegments,
    }));
  }, []);

  // Segment editor — admin controls for editing Kraken segments
  const currentKrakenSegments = useMemo(
    () => (currentLetterPageIndex !== undefined ? krakenSegmentsMap[currentLetterPageIndex] ?? [] : []),
    [krakenSegmentsMap, currentLetterPageIndex],
  );
  const segmentEditor = useSegmentEditor(currentKrakenSegments, imageNaturalSize);

  // Keep a render-current save snapshot outside async callback closures. A
  // slow save may finish after another segment edit, so only the revision it
  // actually persisted is eligible to clear dirty state.
  const segmentEditRevisionRef = useRef(0);
  const previousSegmentEditRef = useRef<{
    pageId: string | null;
    projectionSignature: string;
  }>({
    pageId: null,
    projectionSignature: '',
  });
  const currentSegmentPage = currentLetterPageIndex === undefined
    ? undefined
    : letterPages[currentLetterPageIndex];
  const currentSegmentPageId = currentSegmentPage?.id ?? null;
  const currentSegmentProjectionSignature = lineSegmentsSignature(
    segmentEditor.getSegmentsForSave(),
  );
  if (
    previousSegmentEditRef.current.pageId !== currentSegmentPageId
    || previousSegmentEditRef.current.projectionSignature
      !== currentSegmentProjectionSignature
  ) {
    segmentEditRevisionRef.current += 1;
    previousSegmentEditRef.current = {
      pageId: currentSegmentPageId,
      projectionSignature: currentSegmentProjectionSignature,
    };
  }
  const latestSegmentSaveStateRef = useRef<SegmentSaveState | null>(null);
  latestSegmentSaveStateRef.current = currentSegmentPage
    && currentLetterPageIndex !== undefined
    ? {
        page: currentSegmentPage,
        letterPageIndex: currentLetterPageIndex,
        editRevision: segmentEditRevisionRef.current,
        isDirty: segmentEditor.isDirty,
        getSegmentsForSave: segmentEditor.getSegmentsForSave,
      }
    : null;
  const activeSegmentFlushRef = useRef<{
    pageId: string;
    promise: Promise<boolean>;
  } | null>(null);
  const [geometryApprovalPending, setGeometryApprovalPending] = useState(false);
  const geometryApprovalPendingRef = useRef(false);
  const geometryApprovalTokenRef = useRef(0);
  const [segmentReloadPending, setSegmentReloadPending] = useState(false);
  const segmentReloadPendingRef = useRef(false);
  const segmentReloadTokenRef = useRef(0);
  const segmentTransitionPendingRef = useRef(false);
  const geometryEditingLockedRef = useRef(false);

  // Sync segment editor when source segments change (page switch or redetect)
  const lastSourceRef = useRef<LineSegment[] | undefined>(currentKrakenSegments);
  useEffect(() => {
    if (currentKrakenSegments !== lastSourceRef.current) {
      lastSourceRef.current = currentKrakenSegments;
      segmentEditor.resetFromSource(currentKrakenSegments);
    }
  }, [currentKrakenSegments, segmentEditor]);

  const [repairContextVisible, setRepairContextVisible] = useState(!!repairText);
  useEffect(() => {
    setRepairContextVisible(!!repairText);
    if (repairText) {
      segmentEditor.setSegmentEditMode(true);
    }
  }, [repairText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-enter segment edit mode when opened with unverified segments
  useEffect(() => {
    if (fullViewport) {
      segmentEditor.setSegmentEditMode(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Edit mode: resize (default) or rotate
  const [editMode, setEditMode] = useState<'resize' | 'rotate'>('resize');
  // Draw tool: select (default), box, polygon, line
  const [drawTool, setDrawTool] = useState<'select' | 'box' | 'polygon' | 'draw'>('select');
  // Subtract mode: when on, drawn shapes subtract from selected segment instead of extending
  const [subtractMode, setSubtractMode] = useState(false);
  // Classification dropdown
  const [classDropdownOpen, setClassDropdownOpen] = useState(false);
  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; segId: string } | null>(null);
  // Clear to resize and close dropdown when selection changes
  useEffect(() => {
    setEditMode('resize');
    setClassDropdownOpen(false);
    if (!segmentEditor.selectedSegmentId) {
      setSubtractMode(false);
    }
  }, [segmentEditor.selectedSegmentId]);

  // Detection progress steps (shown in loading overlay for current page)

  // Keep the exact full transcript because backend sourceLineNumber addresses
  // physical lines in this authoritative string, including page markers,
  // decorative numbers, and blank lines.
  const [workingTranscript, setWorkingTranscript] = useState(transcript);
  const pageRawTexts = useMemo(
    () => splitTranscriptByPage(workingTranscript, letterPages.length),
    [workingTranscript, letterPages.length],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const lastGlobalLineIndexRef = useRef<number | null>(null);
  // Live font size override: tracks font size as user edits text (null = use render-time value)
  const [liveFontSize, setLiveFontSize] = useState<number | null>(null);

  const currentPage = allPages[currentPageIndex];
  const productionPageById = useMemo(
    () => new Map(
      (productionAlignment?.pages ?? []).map((page) => [page.pageId, page]),
    ),
    [productionAlignment],
  );
  const currentProductionPage = currentPage
    ? productionPageById.get(currentPage.id)
    : undefined;

  // The production envelope carries the same revision-bound geometry used by
  // its mappings. Adopt it for the editor only when there is no local draft;
  // an alignment response can never erase unsaved human work.
  useEffect(() => {
    if (productionAlignmentStatus !== 'ready' || !productionAlignment) return;
    productionAlignment.pages.forEach((alignmentPage) => {
      const letterPageIndex = letterPages.findIndex(
        (page) => page.id === alignmentPage.pageId,
      );
      if (letterPageIndex < 0) return;
      const activeDraft = latestSegmentSaveStateRef.current;
      if (
        activeDraft?.page.id === alignmentPage.pageId
        && activeDraft.isDirty
      ) {
        return;
      }
      const existingSegments = krakenSegmentsMap[letterPageIndex];
      const existingGeometry = geometryStateRef.current[alignmentPage.pageId];
      if (
        existingGeometry
        && (
          alignmentPage.geometry.geometryRevision
            < existingGeometry.geometryRevision
          || (
            alignmentPage.geometry.geometryRevision
              === existingGeometry.geometryRevision
            && (
              (
                existingGeometry.geometryChecksumSha256.length > 0
                && alignmentPage.geometry.geometryChecksumSha256
                  !== existingGeometry.geometryChecksumSha256
              )
              || (
                existingGeometry.lineSegmentsChecksumSha256.length > 0
                && alignmentPage.geometry.lineSegmentsChecksumSha256
                  !== existingGeometry.lineSegmentsChecksumSha256
              )
            )
          )
        )
      ) {
        return;
      }
      if (
        existingSegments !== undefined
        && existingGeometry?.geometryRevision
          === alignmentPage.geometry.geometryRevision
        && existingGeometry.lineSegmentsChecksumSha256
          === alignmentPage.geometry.lineSegmentsChecksumSha256
      ) {
        return;
      }
      applyGeometryEnvelope(
        alignmentPage.pageId,
        letterPageIndex,
        alignmentPage.geometry,
      );
    });
  }, [
    productionAlignment,
    productionAlignmentStatus,
    letterPages,
    krakenSegmentsMap,
    applyGeometryEnvelope,
  ]);

  const currentGeometryState = currentPage
    ? geometryStateMap[currentPage.id]
    : undefined;
  const currentPageTrusted = Boolean(
    currentGeometryState
    && !segmentEditor.isDirty
    && currentGeometryState.reviewState.trustState === 'trusted'
    && currentGeometryState.reviewState.approvedGeometryRevision
      === currentGeometryState.geometryRevision
    && currentGeometryState.reviewState.approvedGeometryChecksumSha256
      === currentGeometryState.geometryChecksumSha256,
  );
  const geometryEditingLocked = (
    currentPageTrusted
    || geometryApprovalPending
    || segmentReloadPending
    || navigationPending
  );
  geometryEditingLockedRef.current = geometryEditingLocked;
  const currentGeometrySaveStatus: GeometrySaveStatus = currentPage
    ? geometrySaveStatusMap[currentPage.id] ?? (segmentEditor.isDirty ? 'dirty' : 'idle')
    : 'idle';
  const selectedGeometryProvenance = segmentEditor.editedSegments.find(
    (segment) => segment._id === segmentEditor.selectedSegmentId,
  )?.geometryProvenance;
  const selectedGeometryLabel = selectedGeometryProvenance?.source === 'human-created'
    ? 'Human-created'
    : selectedGeometryProvenance?.source === 'human-adjusted'
      ? 'Human-adjusted'
      : 'Machine outline';

  useEffect(() => {
    if (!currentSegmentPageId || !segmentEditor.isDirty) return;
    setGeometrySaveStatusMap((previous) => (
      previous[currentSegmentPageId] === 'dirty'
        ? previous
        : { ...previous, [currentSegmentPageId]: 'dirty' }
    ));
  }, [currentSegmentPageId, segmentEditor.isDirty, segmentEditor.editedSegments]);

  // Reset image sizes and zoom when switching pages so overlay doesn't render
  // at stale positions from the previous page's dimensions
  useEffect(() => {
    setImageNaturalSize({ width: 0, height: 0 });
    setImageDisplaySize({ width: 0, height: 0 });
    setFitZoom(1);
    setFitPan({ x: 0, y: 0 });
  }, [currentPageIndex]);

  // Fetch stored line segments from DB when a letter page loads.
  useEffect(() => {
    if (!currentPage || currentLetterPageIndex === undefined) return;

    const lpIdx = currentLetterPageIndex;
    if (aiSegmentsMap[lpIdx] !== undefined) return; // already cached
    if (aiSegmentsMap[lpIdx] === null) return; // fetch in progress

    const pageText = pageRawTexts[lpIdx] ?? '';
    if (!pageText.trim()) return;

    setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: null }));

    getPageGeometry(currentPage.id)
      .then((envelope) => {
        applyGeometryEnvelope(currentPage.id, lpIdx, envelope);
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: [] }));
        showToast(getErrorMessage(err, 'Failed to load segments'), 'error');
      });
  }, [
    currentPage,
    currentLetterPageIndex,
    aiSegmentsMap,
    pageRawTexts,
    showToast,
    applyGeometryEnvelope,
  ]);

  // Background pre-fetch: load segments for upcoming pages.
  useEffect(() => {
    if (currentLetterPageIndex !== undefined) {
      if (aiSegmentsMap[currentLetterPageIndex] === null || aiSegmentsMap[currentLetterPageIndex] === undefined) return;
    }

    for (let i = 0; i < letterPages.length; i++) {
      const idx = (((currentLetterPageIndex ?? -1) + 1 + i) % letterPages.length);
      if (aiSegmentsMap[idx] !== undefined || aiSegmentsMap[idx] === null) continue;

      const pageText = pageRawTexts[idx] ?? '';
      if (!pageText.trim()) continue;

      const page = letterPages[idx];
      setAiSegmentsMap(prev => ({ ...prev, [idx]: null }));

      getPageGeometry(page.id)
        .then((envelope) => {
          applyGeometryEnvelope(page.id, idx, envelope);
        })
        .catch(() => {
          setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        });

      break;
    }
  }, [
    aiSegmentsMap,
    currentLetterPageIndex,
    letterPages,
    pageRawTexts,
    applyGeometryEnvelope,
  ]);

  // Geometry and transcript placement have separate owners. Transcript review
  // waits for both; segment editing may continue to use loaded geometry.
  const geometryIsLoading = currentLetterPageIndex !== undefined
    && aiSegmentsMap[currentLetterPageIndex] === null;
  const alignmentIsLoading = productionAlignmentStatus === 'loading';
  const isLoading = geometryIsLoading || alignmentIsLoading;
  const imageReady = imageNaturalSize.width > 0;
  const onLetterPage = currentLetterPageIndex !== undefined;

  // Backend mappings are the only transcript-placement source. Geometry is
  // resolved by stable segment IDs; response array order is never trusted.
  const alignmentView = useMemo<{
    lines: AlignedLine[];
    error: Error | null;
  }>(() => {
    if (
      !currentPage
      || !onLetterPage
      || currentLetterPageIndex === undefined
      || productionAlignmentStatus !== 'ready'
    ) {
      return { lines: [], error: null };
    }
    if (!currentProductionPage) {
      return {
        lines: [],
        error: new Error('This letter page is missing from transcript placement'),
      };
    }
    try {
      return {
        lines: buildProductionReviewLines(
          currentProductionPage,
          currentProductionPage.mappings.reduce<string[]>(
            (lines, mapping) => {
              lines[mapping.transcriptLineIndex] =
                workingTranscript.split('\n')[mapping.sourceLineNumber - 1]
                ?? mapping.transcriptText;
              return lines;
            },
            [],
          ),
        ),
        error: null,
      };
    } catch (error) {
      return {
        lines: [],
        error: error instanceof Error
          ? error
          : new Error('Transcript placement could not be displayed'),
      };
    }
  }, [
    currentPage,
    currentLetterPageIndex,
    currentProductionPage,
    onLetterPage,
    productionAlignmentStatus,
    workingTranscript,
  ]);
  const alignedLines = alignmentView.lines;
  const currentAlignmentError = productionAlignmentError
    ?? alignmentView.error;
  const hasTranscriptLinesOnPage = onLetterPage
    && (currentProductionPage?.mappings.length ?? 0) > 0;

  // Only expose currentLine when the image for this page has loaded,
  // so overlays never render at positions scaled from a previous page's dimensions
  const currentLine = imageReady ? alignedLines[currentLineIndex] : undefined;
  // Line counts per letter page (indexed by letter page index)
  const pageLineCounts = useMemo(
    () => letterPages.map((page) => (
      productionPageById.get(page.id)?.mappings.length ?? 0
    )),
    [letterPages, productionPageById],
  );

  const totalLines = useMemo(
    () => pageLineCounts.reduce((sum, count) => sum + count, 0),
    [pageLineCounts],
  );

  const globalLineIndex = useMemo(() => {
    if (currentLetterPageIndex === undefined) return 0;
    let sum = 0;
    for (let i = 0; i < currentLetterPageIndex; i++) {
      sum += pageLineCounts[i] || 0;
    }
    return sum + currentLineIndex + 1;
  }, [currentLetterPageIndex, currentLineIndex, pageLineCounts]);

  // Special area data for the current letter page
  // Maps each non-blank line index → areaId, and collects SpecialArea metadata
  const specialAreaInfo = useMemo(() => {
    if (currentLetterPageIndex === undefined) return null;
    const structuredPages = letter.transcript.structuredPages;
    if (!structuredPages) return null;
    const structuredPage = structuredPages[currentLetterPageIndex];
    if (!structuredPage) return null;
    const areas = structuredPage.specialAreas;
    if (!areas || areas.length === 0) return null;

    // Build non-blank line index → areaId mapping
    const lineAreaIds: (number | null)[] = [];
    for (const line of structuredPage.lines) {
      if (line.text !== '') {
        lineAreaIds.push(line.areaId ?? null);
      }
    }

    const areaMap = new Map<number, SpecialArea>();
    for (const area of areas) {
      areaMap.set(area.id, area);
    }

    return { lineAreaIds, areaMap };
  }, [letter.transcript.structuredPages, currentLetterPageIndex]);

  // Scale factor: displayed size vs natural image size
  const scaleFactor = imageNaturalSize.width > 0
    ? imageDisplaySize.width / imageNaturalSize.width
    : 1;

  // Page-global font size: one consistent size derived from OCR word widths across all lines
  const pageFontSize = useMemo(
    () => computePageFontSize(alignedLines, scaleFactor),
    [alignedLines, scaleFactor],
  );

  // Track image natural size
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setImageDisplaySize({ width: img.clientWidth, height: img.clientHeight });
  }, []);

  // Update display size on resize (ResizeObserver catches sidebar toggles too)
  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setImageDisplaySize({ width, height });
        }
      }
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [currentPageIndex]);

  // Wheel zoom for fit-height mode (Ctrl/Cmd + scroll, smooth)
  const fitZoomRef = useRef(fitZoom);
  fitZoomRef.current = fitZoom;

  // Clamp pan so the image edges never cross inside the viewport
  const clampPan = useCallback((pan: { x: number; y: number }, zoom: number) => {
    const container = containerRef.current;
    if (!container) return pan;
    const dw = imageDisplaySize.width;
    const dh = imageDisplaySize.height;
    if (dw === 0 || dh === 0) return pan;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const maxX = Math.max(0, (zoom * dw - cw) / 2);
    const maxY = Math.max(0, (zoom * dh - ch) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, pan.x)),
      y: Math.max(-maxY, Math.min(maxY, pan.y)),
    };
  }, [imageDisplaySize.width, imageDisplaySize.height]);

  useEffect(() => {
    if (!fitHeight) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        // Smooth exponential zoom (matches public LetterViewer feel)
        const factor = Math.pow(1.01, -e.deltaY);
        setFitZoom(prev => {
          const next = prev * factor;
          const clamped = Math.min(50, Math.max(1, next));
          // Scale pan proportionally so the view center stays put, then clamp to bounds
          setFitPan(prevPan => {
            if (clamped === 1) return { x: 0, y: 0 };
            const ratio = clamped / prev;
            return clampPan({ x: prevPan.x * ratio, y: prevPan.y * ratio }, clamped);
          });
          return clamped;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [fitHeight, clampPan]);

  const canPanZoomedImage = fitHeight && fitZoom > 1 && !segmentEditor.segmentEditMode;

  // Pan handlers for fit-height zoom
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    if (!canPanZoomedImage) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - fitPan.x, y: e.clientY - fitPan.y };
  }, [canPanZoomedImage, fitPan]);

  const handlePanMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setFitPan(clampPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    }, fitZoom));
  }, [isPanning, fitZoom, clampPan]);

  const handlePanMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const panToMinimapPoint = useCallback((clientX: number, clientY: number, rect: DOMRect) => {
    const dw = imageDisplaySize.width;
    const dh = imageDisplaySize.height;
    if (dw === 0 || dh === 0) return;

    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    const tx = -(nx * dw - dw / 2) * fitZoom;
    const ty = -(ny * dh - dh / 2) * fitZoom;
    setFitPan(clampPan({ x: tx, y: ty }, fitZoom));
  }, [imageDisplaySize.width, imageDisplaySize.height, fitZoom, clampPan]);

  const handleMinimapPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    minimapDragRef.current = { pointerId: e.pointerId, rect };
    e.currentTarget.setPointerCapture(e.pointerId);
    panToMinimapPoint(e.clientX, e.clientY, rect);
  }, [panToMinimapPoint]);

  const handleMinimapPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!minimapDragRef.current || minimapDragRef.current.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    panToMinimapPoint(e.clientX, e.clientY, minimapDragRef.current.rect);
  }, [panToMinimapPoint]);

  const handleMinimapPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!minimapDragRef.current || minimapDragRef.current.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    minimapDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // Save current line text and trigger auto-save (only if user actually edited)
  const hasPendingCurrentLineChanges = useCallback(() => {
    if (!inputRef.current || currentLetterPageIndex === undefined) {
      return false;
    }
    const currentAligned = alignedLines[currentLineIndex];
    if (!currentAligned) return false;

    return normalizeReviewLineText(inputRef.current.textContent || '')
      !== normalizeReviewLineText(currentAligned.transcriptText);
  }, [
    alignedLines,
    currentLetterPageIndex,
    currentLineIndex,
  ]);

  const saveCurrentLine = useCallback(() => {
    if (mutationsBlockedRef.current) return;
    if (!inputRef.current || currentLetterPageIndex === undefined) return;
    const currentAligned = alignedLines[currentLineIndex];
    if (!currentAligned) return;

    const rawText = inputRef.current.textContent || '';
    const newText = normalizeReviewLineText(rawText);
    const originalText = currentAligned.transcriptText;
    const originalNormalized = normalizeReviewLineText(originalText);

    // Skip save if the word content hasn't changed. Line review spacing is
    // intentionally independent from transcript spacing.
    if (newText === originalNormalized) return;

    // sourceLineNumber is the backend's authoritative, one-based physical
    // line address in the exact full transcript. Never infer it again from
    // page-local nonblank lines or geometry order.
    const fullLines = workingTranscript.split('\n');
    const rawLineIndex = currentAligned.sourceLineNumber - 1;
    if (rawLineIndex < 0 || rawLineIndex >= fullLines.length) return;
    fullLines[rawLineIndex] = mergeEditedTextWithOriginalSpacing(
      fullLines[rawLineIndex],
      newText,
    );
    const fullText = fullLines.join('\n');
    setWorkingTranscript(fullText);

    // Flush parent updates synchronously so exiting review mode does not
    // discard the line edit before the child unmounts.
    onTranscriptChange(fullText);
    onAutoSave({ transcriptionText: fullText });
  }, [
    currentLetterPageIndex,
    currentLineIndex,
    alignedLines,
    onTranscriptChange,
    onAutoSave,
    workingTranscript,
  ]);

  // Save edits as a new immutable page-geometry revision. The expected
  // revision prevents a stale browser tab from overwriting another reviewer.
  const autoSaveSegments = useCallback((
    failureFallback = 'Failed to save segment edits',
  ): Promise<boolean> => {
    if (
      mutationsBlockedRef.current
      || geometryApprovalPendingRef.current
    ) {
      return Promise.resolve(false);
    }
    const initialState = latestSegmentSaveStateRef.current;
    if (!initialState) return Promise.resolve(true);

    const activeFlush = activeSegmentFlushRef.current;
    if (activeFlush?.pageId === initialState.page.id) {
      return activeFlush.promise;
    }
    if (!initialState.isDirty) return Promise.resolve(true);

    const targetPageId = initialState.page.id;
    const targetLetterPageIndex = initialState.letterPageIndex;
    const targetSourceExpectation = sourceExpectation(initialState.page);
    let expectedGeometryRevision = geometryStateRef.current[targetPageId]?.geometryRevision;
    let expectedLineSegmentsChecksumSha256 =
      geometryStateRef.current[targetPageId]?.lineSegmentsChecksumSha256;
    if (
      expectedGeometryRevision === undefined
      || !expectedLineSegmentsChecksumSha256
    ) {
      setGeometrySaveStatusMap((previous) => ({
        ...previous,
        [targetPageId]: 'error',
      }));
      return Promise.resolve(false);
    }

    const flushPromise = (async () => {
      setGeometrySaveStatusMap((previous) => ({
        ...previous,
        [targetPageId]: 'saving',
      }));
      while (true) {
        if (
          mutationsBlockedRef.current
          || geometryApprovalPendingRef.current
        ) {
          return false;
        }
        const state = latestSegmentSaveStateRef.current;
        if (
          !state
          || state.page.id !== targetPageId
          || state.letterPageIndex !== targetLetterPageIndex
        ) {
          return false;
        }

        const savedEditRevision = state.editRevision;
        const segments = state.getSegmentsForSave();
        let envelope: PageGeometryEnvelope;
        try {
          envelope = await savePageLineSegments(
            targetPageId,
            segments,
            {
              ...targetSourceExpectation,
              expectedGeometryRevision,
              expectedLineSegmentsChecksumSha256,
            },
          );
        } catch (err) {
          setGeometrySaveStatusMap((previous) => ({
            ...previous,
            [targetPageId]: geometryFailureStatus(err),
          }));
          handleMutationError(err, failureFallback);
          return false;
        }
        expectedGeometryRevision = envelope.geometryRevision;
        expectedLineSegmentsChecksumSha256 =
          envelope.lineSegmentsChecksumSha256;
        lastSourceRef.current = envelope.lineSegments;
        applyGeometryEnvelope(targetPageId, targetLetterPageIndex, envelope);

        const latestState = latestSegmentSaveStateRef.current;
        if (
          !latestState
          || latestState.page.id !== targetPageId
          || latestState.letterPageIndex !== targetLetterPageIndex
        ) {
          return false;
        }

        // Another edit landed while the request was in flight. Persist that
        // newer snapshot before allowing the page or mode to change.
        if (latestState.editRevision !== savedEditRevision) {
          setGeometrySaveStatusMap((previous) => ({
            ...previous,
            [targetPageId]: 'saving',
          }));
          continue;
        }

        latestSegmentSaveStateRef.current = {
          ...latestState,
          isDirty: false,
        };
        segmentEditor.markSaved(envelope.lineSegments);
        setGeometrySaveStatusMap((previous) => ({
          ...previous,
          [targetPageId]: 'saved',
        }));
        // A geometry revision changes the aligner's exact input identity.
        // Wait for its new stable-ID mapping before navigation can resume.
        await refreshProductionAlignment();
        return true;
      }
    })();

    activeSegmentFlushRef.current = {
      pageId: targetPageId,
      promise: flushPromise,
    };
    void flushPromise.then(
      () => {
        if (activeSegmentFlushRef.current?.promise === flushPromise) {
          activeSegmentFlushRef.current = null;
        }
      },
      () => {
        if (activeSegmentFlushRef.current?.promise === flushPromise) {
          activeSegmentFlushRef.current = null;
        }
      },
    );
    return flushPromise;
  }, [
    handleMutationError,
    segmentEditor,
    sourceExpectation,
    applyGeometryEnvelope,
    refreshProductionAlignment,
  ]);

  // Auto-save on a debounced timer when dirty
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mutationsBlocked || segmentReloadPending) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      return;
    }
    if (!segmentEditor.isDirty) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      void autoSaveSegments();
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [
    autoSaveSegments,
    mutationsBlocked,
    segmentReloadPending,
    segmentEditor.editedSegments,
    segmentEditor.isDirty,
  ]);

  // Approve the exact current revision for this page only.
  const handleVerifySegments = useCallback(async () => {
    if (
      mutationsBlockedRef.current
      || geometryApprovalPendingRef.current
      || segmentReloadPendingRef.current
      || segmentTransitionPendingRef.current
    ) {
      return;
    }
    if (segmentEditor.isDirty && !(await autoSaveSegments())) return;
    // Multiple clicks can wait on the same segment save. Re-check ownership
    // after the await so only one approval request can acquire the page.
    if (
      mutationsBlockedRef.current
      || geometryApprovalPendingRef.current
      || segmentReloadPendingRef.current
      || segmentTransitionPendingRef.current
      || !currentPage
      || currentLetterPageIndex === undefined
    ) {
      return;
    }
    const latestPage = latestSegmentSaveStateRef.current;
    if (
      latestPage?.page.id !== currentPage.id
      || latestPage.letterPageIndex !== currentLetterPageIndex
    ) {
      return;
    }
    const targetPageId = currentPage.id;
    const targetLetterPageIndex = currentLetterPageIndex;
    const geometryState = geometryStateRef.current[targetPageId];
    if (!geometryState?.geometryChecksumSha256) {
      handleMutationError(
        new Error('This page has no saved geometry revision to approve'),
        'This page has no saved geometry revision to approve',
      );
      return;
    }
    const token = geometryApprovalTokenRef.current + 1;
    geometryApprovalTokenRef.current = token;
    geometryApprovalPendingRef.current = true;
    setGeometryApprovalPending(true);
    setContextMenu(null);
    setGeometrySaveStatusMap((previous) => ({
      ...previous,
      [targetPageId]: 'saving',
    }));
    try {
      const envelope = await updatePageSegmentTrust(
        targetPageId,
        'trusted',
        {
          ...sourceExpectation(currentPage),
          expectedGeometryRevision: geometryState.geometryRevision,
          expectedGeometryChecksumSha256: geometryState.geometryChecksumSha256,
        },
      );
      const latestSaveState = latestSegmentSaveStateRef.current;
      const latestGeometryState = geometryStateRef.current[targetPageId];
      const responseIsCurrent = (
        geometryApprovalTokenRef.current === token
        && geometryApprovalPendingRef.current
        && !mutationsBlockedRef.current
        && latestSaveState?.page.id === targetPageId
        && latestSaveState.letterPageIndex === targetLetterPageIndex
        && latestGeometryState?.geometryRevision === geometryState.geometryRevision
        && latestGeometryState.geometryChecksumSha256 === geometryState.geometryChecksumSha256
        && latestGeometryState.lineSegmentsChecksumSha256
          === geometryState.lineSegmentsChecksumSha256
        && envelope.geometryRevision === geometryState.geometryRevision
        && envelope.geometryChecksumSha256 === geometryState.geometryChecksumSha256
        && envelope.lineSegmentsChecksumSha256
          === geometryState.lineSegmentsChecksumSha256
      );
      if (responseIsCurrent) {
        lastSourceRef.current = envelope.lineSegments;
        applyGeometryEnvelope(
          targetPageId,
          targetLetterPageIndex,
          envelope,
        );
        setGeometrySaveStatusMap((previous) => ({
          ...previous,
          [targetPageId]: 'saved',
        }));
      } else if (geometryApprovalTokenRef.current === token) {
        setGeometrySaveStatusMap((previous) => ({
          ...previous,
          [targetPageId]: 'conflict',
        }));
      }
    } catch (err) {
      if (geometryApprovalTokenRef.current === token) {
        setGeometrySaveStatusMap((previous) => ({
          ...previous,
          [targetPageId]: geometryFailureStatus(err),
        }));
        handleMutationError(err, 'Failed to verify segments');
      }
    } finally {
      if (geometryApprovalTokenRef.current === token) {
        geometryApprovalPendingRef.current = false;
        setGeometryApprovalPending(false);
      }
    }
  }, [
    segmentEditor,
    autoSaveSegments,
    handleMutationError,
    currentPage,
    currentLetterPageIndex,
    sourceExpectation,
    applyGeometryEnvelope,
  ]);

  // Reopen this page for editing while retaining its approved revision in history.
  const handleUnverifySegments = useCallback(async () => {
    if (
      mutationsBlockedRef.current
      || geometryApprovalPendingRef.current
      || segmentReloadPendingRef.current
      || segmentTransitionPendingRef.current
    ) {
      return;
    }
    if (!currentPage || currentLetterPageIndex === undefined) return;
    const targetPageId = currentPage.id;
    const targetLetterPageIndex = currentLetterPageIndex;
    const geometryState = geometryStateRef.current[targetPageId];
    if (!geometryState?.geometryChecksumSha256) return;
    const token = geometryApprovalTokenRef.current + 1;
    geometryApprovalTokenRef.current = token;
    geometryApprovalPendingRef.current = true;
    setGeometryApprovalPending(true);
    setContextMenu(null);
    setGeometrySaveStatusMap((previous) => ({
      ...previous,
      [targetPageId]: 'saving',
    }));
    try {
      const envelope = await updatePageSegmentTrust(
        targetPageId,
        'unverified',
        {
          ...sourceExpectation(currentPage),
          expectedGeometryRevision: geometryState.geometryRevision,
          expectedGeometryChecksumSha256: geometryState.geometryChecksumSha256,
        },
      );
      const latestSaveState = latestSegmentSaveStateRef.current;
      const latestGeometryState = geometryStateRef.current[targetPageId];
      const responseIsCurrent = (
        geometryApprovalTokenRef.current === token
        && geometryApprovalPendingRef.current
        && !mutationsBlockedRef.current
        && latestSaveState?.page.id === targetPageId
        && latestSaveState.letterPageIndex === targetLetterPageIndex
        && latestGeometryState?.geometryRevision === geometryState.geometryRevision
        && latestGeometryState.geometryChecksumSha256 === geometryState.geometryChecksumSha256
        && latestGeometryState.lineSegmentsChecksumSha256
          === geometryState.lineSegmentsChecksumSha256
        && envelope.geometryRevision === geometryState.geometryRevision
        && envelope.geometryChecksumSha256 === geometryState.geometryChecksumSha256
        && envelope.lineSegmentsChecksumSha256
          === geometryState.lineSegmentsChecksumSha256
      );
      if (responseIsCurrent) {
        lastSourceRef.current = envelope.lineSegments;
        applyGeometryEnvelope(
          targetPageId,
          targetLetterPageIndex,
          envelope,
        );
        setGeometrySaveStatusMap((previous) => ({
          ...previous,
          [targetPageId]: 'saved',
        }));
        setLockHintVisible(false);
      } else if (geometryApprovalTokenRef.current === token) {
        setGeometrySaveStatusMap((previous) => ({
          ...previous,
          [targetPageId]: 'conflict',
        }));
      }
    } catch (err) {
      if (geometryApprovalTokenRef.current === token) {
        setGeometrySaveStatusMap((previous) => ({
          ...previous,
          [targetPageId]: geometryFailureStatus(err),
        }));
        handleMutationError(err, 'Failed to unverify segments');
      }
    } finally {
      if (geometryApprovalTokenRef.current === token) {
        geometryApprovalPendingRef.current = false;
        setGeometryApprovalPending(false);
      }
    }
  }, [
    handleMutationError,
    currentPage,
    currentLetterPageIndex,
    sourceExpectation,
    applyGeometryEnvelope,
  ]);

  // Lock hint for toolbar tooltip when trusted
  const [lockHintVisible, setLockHintVisible] = useState(false);
  const lockHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLockHint = useCallback(() => {
    setLockHintVisible(true);
    if (lockHintTimerRef.current) clearTimeout(lockHintTimerRef.current);
    lockHintTimerRef.current = setTimeout(() => setLockHintVisible(false), 2000);
  }, []);

  const runAfterSegmentFlush = useCallback(async (
    transition: () => void,
    saveTranscriptLine = false,
  ): Promise<boolean> => {
    if (
      segmentTransitionPendingRef.current
      || geometryApprovalPendingRef.current
      || segmentReloadPendingRef.current
    ) {
      return false;
    }
    segmentTransitionPendingRef.current = true;
    try {
      if (saveTranscriptLine) {
        saveCurrentLine();
      }
      if (!(await autoSaveSegments())) return false;
      if (geometryApprovalPendingRef.current) return false;
      transition();
      return true;
    } finally {
      segmentTransitionPendingRef.current = false;
    }
  }, [autoSaveSegments, saveCurrentLine]);

  const handleExitSegmentEditMode = useCallback(async () => {
    if (navigationPendingRef.current) return;
    await runAfterSegmentFlush(() => {
      setSubtractMode(false);
      segmentEditor.clearSessionHistory();
      segmentEditor.setSegmentEditMode(false);
    });
  }, [
    runAfterSegmentFlush,
    segmentEditor,
  ]);

  const flushPendingChanges = useCallback(
    () => runAfterSegmentFlush(() => undefined, true),
    [runAfterSegmentFlush],
  );

  const hasPendingChanges = useCallback(() => (
    (latestSegmentSaveStateRef.current?.isDirty ?? false)
    || activeSegmentFlushRef.current !== null
    || hasPendingCurrentLineChanges()
  ), [hasPendingCurrentLineChanges]);

  // Navigate to next line (cross-page: skips to next letter page)
  const goToNextLine = useCallback(async () => {
    if (navigationPendingRef.current) return;
    if (currentLineIndex < alignedLines.length - 1) {
      saveCurrentLine();
      setCurrentLineIndex(currentLineIndex + 1);
    } else {
      // Crossing a page replaces the segment editor source, so persist the
      // current draft before leaving it.
      for (let i = currentPageIndex + 1; i < allPages.length; i++) {
        if (letterPageIndices.has(i)) {
          await runAfterSegmentFlush(() => {
            setCurrentPageIndex(i);
            setCurrentLineIndex(0);
            containerRef.current?.scrollTo({ top: 0 });
          }, true);
          return;
        }
      }
    }
  }, [
    saveCurrentLine,
    currentLineIndex,
    alignedLines.length,
    currentPageIndex,
    allPages.length,
    letterPageIndices,
    runAfterSegmentFlush,
  ]);

  // Navigate to previous line (cross-page: skips to prev letter page)
  const goToPrevLine = useCallback(async () => {
    if (navigationPendingRef.current) return;
    if (currentLineIndex > 0) {
      saveCurrentLine();
      setCurrentLineIndex(currentLineIndex - 1);
    } else {
      // Find previous letter page in allPages
      for (let i = currentPageIndex - 1; i >= 0; i--) {
        if (letterPageIndices.has(i)) {
          await runAfterSegmentFlush(() => {
            setCurrentPageIndex(i);
            // Set to high number — will be clamped in the effect below
            setCurrentLineIndex(999);
          }, true);
          return;
        }
      }
    }
  }, [
    saveCurrentLine,
    currentLineIndex,
    currentPageIndex,
    letterPageIndices,
    runAfterSegmentFlush,
  ]);

  // Navigate to next page (any type)
  const goToNextPage = useCallback(async () => {
    if (navigationPendingRef.current) return;
    if (currentPageIndex >= allPages.length - 1) return;
    await runAfterSegmentFlush(() => {
      setCurrentPageIndex(currentPageIndex + 1);
      setCurrentLineIndex(0);
      containerRef.current?.scrollTo({ top: 0 });
    }, true);
  }, [currentPageIndex, allPages.length, runAfterSegmentFlush]);

  // Navigate to previous page (any type)
  const goToPrevPage = useCallback(async () => {
    if (navigationPendingRef.current) return;
    if (currentPageIndex <= 0) return;
    await runAfterSegmentFlush(() => {
      setCurrentPageIndex(currentPageIndex - 1);
      setCurrentLineIndex(0);
      containerRef.current?.scrollTo({ top: 0 });
    }, true);
  }, [currentPageIndex, runAfterSegmentFlush]);

  // Clamp line index when aligned lines change (e.g., after page switch)
  useEffect(() => {
    if (alignedLines.length > 0 && currentLineIndex >= alignedLines.length) {
      setCurrentLineIndex(alignedLines.length - 1);
    }
  }, [alignedLines.length, currentLineIndex]);

  // Auto-scroll to keep current line visible (highlight + input region)
  useEffect(() => {
    if (!currentLine?.bbox || !containerRef.current || fitHeight) return;

    // Visible region: from highlight top (bbox[1]) to bottom of input
    const lineInputH = computeLineInputHeight(currentLine.bbox, scaleFactor, pageFontSize);
    const regionTop = currentLine.bbox[1] * scaleFactor;
    const regionBottom = currentLine.bbox[3] * scaleFactor + lineInputH;
    const container = containerRef.current;
    const previousGlobalLineIndex = lastGlobalLineIndexRef.current;
    let movementDirection: 'up' | 'down' | 'none' = 'none';

    if (previousGlobalLineIndex !== null) {
      if (globalLineIndex > previousGlobalLineIndex) {
        movementDirection = 'down';
      } else if (globalLineIndex < previousGlobalLineIndex) {
        movementDirection = 'up';
      }
    }

    lastGlobalLineIndexRef.current = globalLineIndex;

    const nextScrollTop = computeAutoScrollTop({
      currentLineIndex,
      movementDirection,
      currentScrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
      contentHeight: container.scrollHeight,
      regionTop,
      regionBottom,
    });

    if (nextScrollTop === null) return;

    if (nextScrollTop === 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    container.scrollTo({
      top: nextScrollTop,
      behavior: 'smooth',
    });
  }, [currentLine, currentLineIndex, globalLineIndex, scaleFactor, pageFontSize, fitHeight]);

  // Build word-positioned content and focus when line changes
  useEffect(() => {
    if (!inputRef.current) return;
    const line = alignedLines[currentLineIndex];
    if (!line) return;
    const vertical = line.providerTextDirection === 'vertical-lr'
      || line.providerTextDirection === 'vertical-rl';

    if (!line.bbox || vertical) {
      inputRef.current.innerHTML = highlightTranscriptMarkers(
        line.transcriptText.split(/\s+/).filter(Boolean).join(' '),
      );
      inputRef.current.style.fontSize = '';
      inputRef.current.style.wordSpacing = '';
      inputRef.current.style.textIndent = '';
    } else {
      // Input left must match the overlay left computed at render time.
      // Use the wider of line bbox and OCR word extent (same logic as inputLeft above).
      const pad = imageNaturalSize.width * 0.01;
      let leftX = line.bbox[0];
      if (line.words && line.words.length > 0) {
        leftX = Math.min(leftX, ...line.words.map(w => w.bbox[0]));
      }
      const overlayLeft = Math.max(0, (leftX - pad) * scaleFactor);
      const contentAreaLeft = overlayLeft + CSS_BORDER_PADDING;

      // Compute max font for this line (matches render-time computation)
      const displayedImgH = imageDisplaySize.height || (imageNaturalSize.height * scaleFactor);
      const lineBottom = line.bbox[3] * scaleFactor + 4; // LINE_GAP
      const maxH = Math.min(displayedImgH - lineBottom, 150);
      const lineFontMax = computeLineFontSize(line.transcriptText, line.words, line.bbox, scaleFactor, maxH);

      buildWordPositionedContent(
        inputRef.current,
        line.transcriptText,
        line.words,
        contentAreaLeft,
        scaleFactor,
        line.bbox,
        lineFontMax,
      );
    }

    setLiveFontSize(null); // Reset live override — buildWordPositionedContent set correct styles
    inputRef.current.focus();
    const sel = window.getSelection();
    if (sel && inputRef.current.firstChild) {
      sel.collapse(inputRef.current.firstChild, 0);
    }
  }, [currentLineIndex, currentPageIndex, alignedLines, scaleFactor, imageNaturalSize.width, imageDisplaySize.height, imageNaturalSize.height, segmentEditor.segmentEditMode, overlayEnabled]);

  // Recalculate font-size and word-spacing as the user edits text (without replacing innerHTML)
  const handleInputChange = useCallback(() => {
    const div = inputRef.current;
    const line = alignedLines[currentLineIndex];
    if (!div || !line?.bbox) return;
    if (
      line.providerTextDirection === 'vertical-lr'
      || line.providerTextDirection === 'vertical-rl'
    ) {
      return;
    }

    const editedText = div.textContent || '';
    const words = editedText.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return;
    const joined = words.join(' ');

    // Determine OCR line extent
    let lineLeftX: number;
    let lineRightX: number;
    if (line.words && line.words.length > 0) {
      lineLeftX = Math.min(...line.words.map(w => w.bbox[0]));
      lineRightX = Math.max(...line.words.map(w => w.bbox[2]));
    } else if (line.bbox) {
      lineLeftX = line.bbox[0];
      lineRightX = line.bbox[2];
    } else {
      return;
    }

    const targetWidth = (lineRightX - lineLeftX) * scaleFactor;
    if (targetWidth <= 0) return;

    const displayedImgH = imageDisplaySize.height || (imageNaturalSize.height * scaleFactor);
    const lineBottom = line.bbox[3] * scaleFactor + 4;
    const maxH = Math.min(displayedImgH - lineBottom, 150);
    const maxFontFromHeight = maxH - CSS_BORDER_PADDING * 2;

    const REF_SIZE = 16;
    const refWidth = measureRenderedTextWidth(joined, REF_SIZE);
    if (refWidth <= 0) return;

    const newFontSize = Math.max(8, Math.min(REF_SIZE * targetWidth / refWidth, maxFontFromHeight, 72));

    // Recalculate word-spacing
    let wordSpacing = 0;
    if (words.length > 1) {
      const actualWidth = measureRenderedTextWidth(joined, newFontSize);
      wordSpacing = (targetWidth - actualWidth) / (words.length - 1);
    }

    div.style.fontSize = `${newFontSize}px`;
    div.style.wordSpacing = Math.abs(wordSpacing) > 0.1 ? `${wordSpacing}px` : '';

    setLiveFontSize(newFontSize);
  }, [alignedLines, currentLineIndex, scaleFactor, imageDisplaySize.height, imageNaturalSize.height]);

  // Re-fetch line segments from the database for the current page
  const reloadSegments = useCallback(async (
    discardUnsaved = false,
  ): Promise<boolean> => {
    if (
      !currentPage
      || isLoading
      || currentLetterPageIndex === undefined
      || mutationsBlockedRef.current
      || geometryApprovalPendingRef.current
      || segmentTransitionPendingRef.current
      || segmentReloadPendingRef.current
    ) {
      return false;
    }

    const targetPageId = currentPage.id;
    const targetLetterPageIndex = currentLetterPageIndex;
    const token = segmentReloadTokenRef.current + 1;
    segmentReloadTokenRef.current = token;
    segmentReloadPendingRef.current = true;
    setSegmentReloadPending(true);

    const stillOwnsTarget = () => {
      const latest = latestSegmentSaveStateRef.current;
      return (
        segmentReloadTokenRef.current === token
        && segmentReloadPendingRef.current
        && !mutationsBlockedRef.current
        && latest?.page.id === targetPageId
        && latest.letterPageIndex === targetLetterPageIndex
      );
    };

    try {
      if (discardUnsaved) {
        // A conflict reload is the explicit "take the server copy" action.
        // Let any request already leaving the browser settle first so its late
        // response cannot race the replacement below.
        const activeFlush = activeSegmentFlushRef.current;
        if (activeFlush?.pageId === targetPageId) {
          await activeFlush.promise;
        }
      } else if (!(await autoSaveSegments(
        'Failed to save segment edits before reloading',
      ))) {
        return false;
      }

      if (!stillOwnsTarget()) return false;
      const envelope = await getPageGeometry(targetPageId);
      if (!stillOwnsTarget()) return false;

      // Keep the local draft mounted until an authoritative replacement is
      // actually available. A failed or stale reload must never erase work.
      lastSourceRef.current = envelope.lineSegments;
      applyGeometryEnvelope(
        targetPageId,
        targetLetterPageIndex,
        envelope,
      );
      segmentEditor.resetFromSource(envelope.lineSegments);
      setCurrentLineIndex(0);
      setGeometrySaveStatusMap((previous) => ({
        ...previous,
        [targetPageId]: 'idle',
      }));
      await refreshProductionAlignment();
      return true;
    } catch (err) {
      if (stillOwnsTarget()) {
        showToast(getErrorMessage(err, 'Failed to load segments'), 'error');
      }
      return false;
    } finally {
      if (segmentReloadTokenRef.current === token) {
        segmentReloadPendingRef.current = false;
        setSegmentReloadPending(false);
      }
    }
  }, [
    currentPage,
    currentLetterPageIndex,
    isLoading,
    autoSaveSegments,
    showToast,
    applyGeometryEnvelope,
    segmentEditor,
    refreshProductionAlignment,
  ]);

  const segmentControlsLoading = isLoading || segmentReloadPending;

  // The workspace stores this handle in parent state so its loading flag can
  // drive the reload control. Keep the handle stable while loading is
  // unchanged: callback churn here otherwise creates a parent/child render
  // loop whenever either command closes over fresh editor state.
  const saveCurrentLineHandleRef = useRef(saveCurrentLine);
  const flushPendingChangesHandleRef = useRef(flushPendingChanges);
  const hasPendingChangesHandleRef = useRef(hasPendingChanges);
  const reloadSegmentsHandleRef = useRef(reloadSegments);
  saveCurrentLineHandleRef.current = saveCurrentLine;
  flushPendingChangesHandleRef.current = flushPendingChanges;
  hasPendingChangesHandleRef.current = hasPendingChanges;
  reloadSegmentsHandleRef.current = reloadSegments;
  useImperativeHandle(ref, () => ({
    saveCurrentLine: () => saveCurrentLineHandleRef.current(),
    flushPendingChanges: () => flushPendingChangesHandleRef.current(),
    hasPendingChanges: () => hasPendingChangesHandleRef.current(),
    reloadSegments: () => {
      void reloadSegmentsHandleRef.current();
    },
    isLoading: segmentControlsLoading,
  }), [segmentControlsLoading]);

  // Keyboard handler
  useEffect(() => {
    const blurFocusedToolbarButton = () => {
      const activeEl = document.activeElement;
      if (activeEl instanceof HTMLElement && activeEl.classList.contains('segment-editor-toolbar-btn')) {
        activeEl.blur();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (navigationPendingRef.current) return;
      if (
        geometryApprovalPendingRef.current
        || segmentReloadPendingRef.current
      ) {
        const lowerKey = e.key.toLowerCase();
        if (
          [
            'escape',
            'enter',
            'arrowdown',
            'arrowup',
            'arrowleft',
            'arrowright',
            'pagedown',
            'pageup',
            'delete',
            'backspace',
            's',
            'b',
            'p',
            'd',
            'r',
            't',
            'z',
          ].includes(lowerKey)
        ) {
          e.preventDefault();
        }
        return;
      }
      if (
        geometryEditingLockedRef.current
        && segmentEditor.segmentEditMode
      ) {
        if (e.key === 'PageDown') {
          e.preventDefault();
          void goToNextPage();
          return;
        }
        if (e.key === 'PageUp') {
          e.preventDefault();
          void goToPrevPage();
          return;
        }

        const lowerKey = e.key.toLowerCase();
        const isUndoOrRedo = lowerKey === 'z' && (e.ctrlKey || e.metaKey);
        if (
          isUndoOrRedo
          || [
            'delete',
            'backspace',
            's',
            'b',
            'p',
            'd',
            'r',
            't',
          ].includes(lowerKey)
        ) {
          e.preventDefault();
        }
        return;
      }
      // Segment edit mode keyboard handling
      if (segmentEditor.segmentEditMode) {
        if (e.key === 'Escape') {
          e.preventDefault();
          // Cancel active drawing tool — return to select mode
          setDrawTool('select');
          blurFocusedToolbarButton();
          return;
        }
        if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
          if (e.shiftKey && segmentEditor.canRedo) {
            e.preventDefault();
            segmentEditor.redo();
            return;
          }
          if (!e.shiftKey && segmentEditor.canUndo) {
            e.preventDefault();
            segmentEditor.undo();
            return;
          }
        }
        // Block line navigation keys in edit mode
        if (['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          return;
        }
        // Single-key tool shortcuts (only when not typing in an input)
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && tag !== 'INPUT' && tag !== 'TEXTAREA') {
          const key = e.key.toLowerCase();
          if (key === 's') { setDrawTool('select'); blurFocusedToolbarButton(); return; }
          if (key === 'b') { setDrawTool('box'); blurFocusedToolbarButton(); return; }
          if (key === 'p') { setDrawTool('polygon'); blurFocusedToolbarButton(); return; }
          if (key === 'd') { setDrawTool('draw'); blurFocusedToolbarButton(); return; }
          if (key === 'r') {
            // Toggle subtract mode
            setSubtractMode((v) => !v);
            blurFocusedToolbarButton();
            return;
          }
          if (key === 't') {
            const sel = segmentEditor.editedSegments.find((s) => s._id === segmentEditor.selectedSegmentId);
            if (sel) {
              if (editMode !== 'rotate') { segmentEditor.ensureBoundary(sel._id); setEditMode('rotate'); }
              else { setEditMode('resize'); }
            }
            return;
          }
        }
        return; // Don't process other keys in edit mode
      }

      if (e.key === 'D' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        onDebugModeChange?.(!debugLines);
        return;
      }

      if (e.key === 'R' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        reloadSegments();
        return;
      }

      // Page navigation: PageUp/PageDown always work, Left/Right on non-letter pages
      if (e.key === 'PageDown') {
        e.preventDefault();
        goToNextPage();
        return;
      }
      if (e.key === 'PageUp') {
        e.preventDefault();
        goToPrevPage();
        return;
      }

      // On non-letter pages or when overlay is off, arrows navigate pages
      if (!onLetterPage || !overlayEnabled) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          goToNextPage();
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          goToPrevPage();
          return;
        }
      }

      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        goToNextLine();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        goToPrevLine();
        return;
      }

      // ArrowLeft / ArrowRight: let native input behavior handle it
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNextLine, goToPrevLine, goToNextPage, goToPrevPage, onLetterPage, overlayEnabled, reloadSegments, debugLines, onDebugModeChange, segmentEditor, editMode]);

  // Dynamic height for the editable strip — based on current line's word heights and font size
  // Compute overlay positions
  const displayedImageHeight = imageDisplaySize.height || (imageNaturalSize.height * scaleFactor);
  const imgW = imageDisplaySize.width;

  // Input position — derived from line bbox, below the clear strip.
  // The overlay must be wide enough for the actual OCR word extent (which can
  // exceed the line bbox), plus border/padding/rendering tolerance.
  const LINE_GAP = 4;
  const isVerticalLine = currentLine?.providerTextDirection === 'vertical-lr'
    || currentLine?.providerTextDirection === 'vertical-rl';
  const isRightToLeftLine = currentLine?.providerTextDirection === 'horizontal-rl';
  const currentLineBbox = currentLine?.bbox;
  const horizontalInputTop = currentLineBbox
    ? currentLineBbox[3] * scaleFactor + LINE_GAP
    : 0;
  const linePad = imageNaturalSize.width * 0.01;
  const rightExtra = CSS_BORDER_PADDING * 2 + 8; // both-side border+padding + rendering tolerance

  // Use the wider of line bbox and OCR word extent so text is never clipped
  let ocrRightX = currentLineBbox?.[2] ?? 0;
  let ocrLeftX = currentLineBbox?.[0] ?? 0;
  if (currentLine?.words && currentLine.words.length > 0) {
    ocrLeftX = Math.min(ocrLeftX, ...currentLine.words.map(w => w.bbox[0]));
    ocrRightX = Math.max(ocrRightX, ...currentLine.words.map(w => w.bbox[2]));
  }
  const horizontalInputLeft = currentLineBbox ? Math.max(0, (ocrLeftX - linePad) * scaleFactor) : 0;
  const inputRight = currentLineBbox ? Math.min(imgW, (ocrRightX + linePad) * scaleFactor + rightExtra) : imgW;
  const horizontalInputWidth = inputRight - horizontalInputLeft;

  // Per-line font size: scales up for short text, bounded by available height below line
  const maxInputHeight = Math.min(displayedImageHeight - horizontalInputTop, 150);
  const baseFontSize = currentLine && currentLineBbox
    ? isVerticalLine
      ? Math.max(12, Math.min(pageFontSize, 24))
      : computeLineFontSize(currentLine.transcriptText, currentLine.words, currentLineBbox, scaleFactor, maxInputHeight)
    : pageFontSize;
  // Use live font size (updated on each keystroke) if available, otherwise use base
  const fontSize = liveFontSize ?? baseFontSize;
  const inputThickness = fontSize + CSS_BORDER_PADDING * 2;
  let inputTop = horizontalInputTop;
  let inputLeft = horizontalInputLeft;
  let inputWidth = horizontalInputWidth;
  let inputHeight = inputThickness;
  if (currentLine && currentLineBbox && isVerticalLine) {
    inputTop = Math.max(0, currentLineBbox[1] * scaleFactor);
    inputHeight = Math.max(
      inputThickness,
      (currentLineBbox[3] - currentLineBbox[1]) * scaleFactor,
    );
    inputWidth = inputThickness;
    const preferRight = currentLine.providerTextDirection === 'vertical-lr';
    const preferredLeft = preferRight
      ? currentLineBbox[2] * scaleFactor + LINE_GAP
      : currentLineBbox[0] * scaleFactor - inputWidth - LINE_GAP;
    const fallbackLeft = preferRight
      ? currentLineBbox[0] * scaleFactor - inputWidth - LINE_GAP
      : currentLineBbox[2] * scaleFactor + LINE_GAP;
    inputLeft = preferredLeft >= 0 && preferredLeft + inputWidth <= imgW
      ? preferredLeft
      : Math.min(Math.max(fallbackLeft, 0), Math.max(0, imgW - inputWidth));
  }

  const handleFullExit = useCallback(async () => {
    if (navigationPendingRef.current) return;
    await runAfterSegmentFlush(() => {
      if (segmentEditor.segmentEditMode) {
        setSubtractMode(false);
        segmentEditor.clearSessionHistory();
      }
      onExit();
    }, true);
  }, [
    runAfterSegmentFlush,
    segmentEditor,
    onExit,
  ]);

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only exit when clicking directly on the dark background (not the image or overlays)
    if (e.target === containerRef.current) {
      handleFullExit();
    }
  }, [handleFullExit]);

  if (!currentPage) return null;

  return (
    <div
      className={`line-review-mode${fitHeight ? ' line-review-fit-height' : ''}`}
      ref={containerRef}
      onClick={handleContainerClick}
    >
      {/* Close button */}
      <button
        className="line-review-close-btn"
        onClick={handleFullExit}
        disabled={navigationPending}
        aria-label="Exit review mode"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Geometry repair context guides the edit without changing segment behavior. */}
      {repairContextVisible && repairText && (
        <div className="line-review-repair-banner" role="status">
          <span className="repair-banner-label">Repair location for:</span>
          <span className="repair-banner-text">
            &ldquo;{repairText.length > 80 ? `${repairText.slice(0, 80)}…` : repairText}&rdquo;
          </span>
          <span className="repair-banner-hint">
            Draw or adjust its outline. Saving geometry reruns placement;
            this text is not assigned directly to a box.
          </span>
          <button
            className="repair-banner-dismiss"
            onClick={() => setRepairContextVisible(false)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div
        className="line-review-image-container"
        style={{
          maxWidth: imageNaturalSize.width > 0 ? imageNaturalSize.width : undefined,
          transform: fitHeight && fitZoom !== 1
            ? `scale(${fitZoom}) translate(${fitPan.x / fitZoom}px, ${fitPan.y / fitZoom}px)`
            : undefined,
          transformOrigin: 'center center',
          cursor: canPanZoomedImage ? (isPanning ? 'grabbing' : 'grab') : undefined,
        }}
        onMouseDown={handlePanMouseDown}
        onMouseMove={handlePanMouseMove}
        onMouseUp={handlePanMouseUp}
        onMouseLeave={handlePanMouseUp}
      >
        <img
          ref={imageRef}
          src={getImageUrl(currentPage.imageUrl)}
          alt={`Page ${currentPageIndex + 1}`}
          onLoad={handleImageLoad}
          draggable={false}
        />

        {/* Dimmer with polygon cutout — shadows everything except the active line */}
        {overlayEnabled && currentLine?.bbox && imgW > 0 && !segmentEditor.segmentEditMode && (
          <svg
            className="line-review-highlight-svg"
            width={imgW}
            height={displayedImageHeight}
          >
            <defs>
              <filter id="lr-feather">
                <feGaussianBlur stdDeviation="4" />
              </filter>
              <mask id="lr-highlight-mask">
                <rect width={imgW} height={displayedImageHeight} fill="white" />
                {currentLine.segmentGeometries.map((segment) => (
                  segment.boundary && segment.boundary.length > 2
                    ? (
                        <polygon
                          key={`feather-${segment.id ?? segment.line}`}
                          points={segment.boundary
                            .map((point) => (
                              `${point.x * scaleFactor},${point.y * scaleFactor}`
                            ))
                            .join(' ')}
                          fill="black"
                          filter="url(#lr-feather)"
                        />
                      )
                    : (
                        <rect
                          key={`feather-${segment.id ?? segment.line}`}
                          x={segment.bbox[0] * scaleFactor}
                          y={segment.bbox[1] * scaleFactor}
                          width={(segment.bbox[2] - segment.bbox[0]) * scaleFactor}
                          height={(segment.bbox[3] - segment.bbox[1]) * scaleFactor}
                          fill="black"
                          filter="url(#lr-feather)"
                        />
                      )
                ))}
                {currentLine.segmentGeometries.map((segment) => (
                  segment.boundary && segment.boundary.length > 2
                    ? (
                        <polygon
                          key={`solid-${segment.id ?? segment.line}`}
                          points={segment.boundary
                            .map((point) => (
                              `${point.x * scaleFactor},${point.y * scaleFactor}`
                            ))
                            .join(' ')}
                          fill="black"
                        />
                      )
                    : (
                        <rect
                          key={`solid-${segment.id ?? segment.line}`}
                          x={segment.bbox[0] * scaleFactor}
                          y={segment.bbox[1] * scaleFactor}
                          width={(segment.bbox[2] - segment.bbox[0]) * scaleFactor}
                          height={(segment.bbox[3] - segment.bbox[1]) * scaleFactor}
                          fill="black"
                        />
                      )
                ))}
              </mask>
            </defs>
            <rect
              width={imgW}
              height={displayedImageHeight}
              className="line-review-dimmer-fill"
              mask="url(#lr-highlight-mask)"
            />
          </svg>
        )}

        {/* Input overlay — positioned below the clear strip, sized to the line */}
        {overlayEnabled && currentLine?.bbox && !segmentEditor.segmentEditMode && (() => {
          const lineIdx = currentLine.transcriptLineIndex;
          const currentAreaId = specialAreaInfo && lineIdx >= 0 && lineIdx < specialAreaInfo.lineAreaIds.length
            ? specialAreaInfo.lineAreaIds[lineIdx]
            : null;
          const currentArea = currentAreaId != null ? specialAreaInfo?.areaMap.get(currentAreaId) : null;
          const areaBorder = currentArea
            ? `3px solid ${currentArea.type === 'continuation' ? 'rgb(217, 119, 6)' : 'rgb(59, 130, 246)'}`
            : undefined;
          const directionLabel = currentLine.providerTextDirection === 'vertical-lr'
            ? 'Vertical L→R'
            : currentLine.providerTextDirection === 'vertical-rl'
              ? 'Vertical R→L'
              : currentLine.providerTextDirection === 'horizontal-rl'
                ? 'Horizontal R→L'
                : null;

          return (
          <div
            className="line-review-input-overlay"
            style={{
              top: inputTop,
              left: inputLeft,
              width: inputWidth,
              height: inputHeight,
              borderLeft: areaBorder,
            }}
          >
            {directionLabel && (
              <span
                className="line-review-direction-badge"
                title="Direction reported by the native layout detector"
              >
                {directionLabel}
              </span>
            )}
            <div
              ref={inputRef}
              contentEditable={!navigationPending}
              suppressContentEditableWarning
              className="line-review-editable"
              dir={isRightToLeftLine ? 'rtl' : 'ltr'}
              style={{
                fontSize,
                writingMode: isVerticalLine ? 'vertical-rl' : undefined,
                textOrientation: isVerticalLine ? 'mixed' : undefined,
                textAlign: isRightToLeftLine ? 'right' : undefined,
              }}
              onInput={() => {
                if (navigationPendingRef.current) return;
                handleInputChange();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
            />

          </div>
          );
        })()}

        {/* Debug overlay — Kraken polygon boundaries */}
        {debugLines && showKrakenLines && imageDisplaySize.width > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: imageDisplaySize.width,
              height: displayedImageHeight,
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            {(currentLetterPageIndex !== undefined ? krakenSegmentsMap[currentLetterPageIndex] ?? [] : []).map((seg, i) =>
              seg.boundary && seg.boundary.length > 2 ? (
                <polygon
                  key={`poly-${i}`}
                  className="line-review-debug-polygon"
                  points={seg.boundary
                    .map(p => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                    .join(' ')}
                />
              ) : (
                <rect
                  key={`rect-${i}`}
                  className="line-review-debug-polygon"
                  x={seg.bbox[0] * scaleFactor}
                  y={seg.bbox[1] * scaleFactor}
                  width={(seg.bbox[2] - seg.bbox[0]) * scaleFactor}
                  height={(seg.bbox[3] - seg.bbox[1]) * scaleFactor}
                />
              ),
            )}
          </svg>
        )}

        {/* Debug overlay — Excluded content (gray dashed) */}
        {debugLines && showExcludedContent && imageDisplaySize.width > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: imageDisplaySize.width,
              height: displayedImageHeight,
              pointerEvents: 'none',
              zIndex: 7,
            }}
          >
            {(currentLetterPageIndex !== undefined
              ? krakenSegmentsMap[currentLetterPageIndex] ?? []
              : [])
              .filter((segment) => segment.excluded)
              .map((segment, index) => (
              <rect
                key={`excluded-${segment.id ?? index}`}
                className="line-review-debug-excluded"
                x={segment.bbox[0] * scaleFactor}
                y={segment.bbox[1] * scaleFactor}
                width={(segment.bbox[2] - segment.bbox[0]) * scaleFactor}
                height={(segment.bbox[3] - segment.bbox[1]) * scaleFactor}
              />
            ))}
          </svg>
        )}

        {/* Segment editor overlay — interactive segment editing */}
        {overlayEnabled && segmentEditor.segmentEditMode && imageDisplaySize.width > 0 && (
          <SegmentEditorOverlay
            key={`${drawTool}:${geometryEditingLocked ? 'locked' : 'editable'}`}
            segments={segmentEditor.editedSegments}
            selectedSegmentId={segmentEditor.selectedSegmentId}
            scaleFactor={scaleFactor}
            imageWidth={imageDisplaySize.width}
            imageHeight={displayedImageHeight}
            onSelect={segmentEditor.selectSegment}
            onResize={segmentEditor.resizeSegment}
            onResizeStart={segmentEditor.snapshotForUndo}
            onDelete={segmentEditor.deleteSegment}
            onToggleExcluded={segmentEditor.toggleExcluded}
            onAddSegment={(bbox) => { segmentEditor.addSegment(bbox); }}
            onAddPolygonSegment={(b) => { segmentEditor.addPolygonSegment(b); }}
            onAddFreehandSegment={(pts) => { segmentEditor.addFreehandSegment(pts); }}
            onExtendSelected={segmentEditor.extendSelectedWithShape}
            onSubtractFromSelected={segmentEditor.subtractShapeFromSelected}
            drawTool={drawTool}
            reshapeMode={false}
            rotateMode={editMode === 'rotate'}
            subtractMode={subtractMode}
            onSetBoundary={segmentEditor.setBoundary}
            onTransformBoundary={segmentEditor.transformBoundary}
            movable={editMode === 'resize'}
            readOnly={geometryEditingLocked}
            onMoveSegment={segmentEditor.moveSegment}
            onSegmentContextMenu={(cx, cy, segId) => {
              if (geometryEditingLockedRef.current) return;
              segmentEditor.selectSegment(segId);
              setContextMenu({ x: cx, y: cy, segId });
            }}
          />
        )}


        {/* Segment context menu */}
        {contextMenu && !geometryEditingLocked && (() => {
          const seg = segmentEditor.editedSegments.find((s) => s._id === contextMenu.segId);
          if (!seg) return null;
          return (
            <SegmentContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              currentClass={seg.segmentClass}
              excluded={!!seg.excluded}
              onClassify={(cls) => segmentEditor.classifySegment(seg._id, cls)}
              onToggleExcluded={() => segmentEditor.toggleExcluded(seg._id)}
              onDelete={() => segmentEditor.deleteSegment(seg._id)}
              onDuplicate={() => segmentEditor.duplicateSegment(seg._id)}
              onClose={() => setContextMenu(null)}
            />
          );
        })()}

        {/* Special area overlays — colored bounding regions for continuation/addition areas */}
        {specialAreaInfo && alignedLines.length > 0 && imgW > 0 && !segmentEditor.segmentEditMode && (() => {
          // Group aligned lines by areaId to compute bounding boxes per area
          const areaBounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
          for (const line of alignedLines) {
            const idx = line.transcriptLineIndex;
            if (!line.bbox || idx < 0 || idx >= specialAreaInfo.lineAreaIds.length) continue;
            const areaId = specialAreaInfo.lineAreaIds[idx];
            if (areaId == null) continue;
            const [x1, y1, x2, y2] = line.bbox;
            const existing = areaBounds.get(areaId);
            if (existing) {
              existing.minX = Math.min(existing.minX, x1);
              existing.minY = Math.min(existing.minY, y1);
              existing.maxX = Math.max(existing.maxX, x2);
              existing.maxY = Math.max(existing.maxY, y2);
            } else {
              areaBounds.set(areaId, { minX: x1, minY: y1, maxX: x2, maxY: y2 });
            }
          }

          if (areaBounds.size === 0) return null;

          const PAD = 6; // px padding around area bounds
          return (
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: imgW,
                height: displayedImageHeight,
                pointerEvents: 'none',
                zIndex: 4,
              }}
            >
              {[...areaBounds.entries()].map(([areaId, bounds]) => {
                const area = specialAreaInfo.areaMap.get(areaId);
                if (!area) return null;
                const isContinuation = area.type === 'continuation';
                const color = isContinuation ? 'rgba(217, 119, 6, 0.25)' : 'rgba(59, 130, 246, 0.25)';
                const stroke = isContinuation ? 'rgba(217, 119, 6, 0.7)' : 'rgba(59, 130, 246, 0.7)';
                const x = bounds.minX * scaleFactor - PAD;
                const y = bounds.minY * scaleFactor - PAD;
                const w = (bounds.maxX - bounds.minX) * scaleFactor + PAD * 2;
                const h = (bounds.maxY - bounds.minY) * scaleFactor + PAD * 2;

                return (
                  <g key={`area-${areaId}`}>
                    <rect
                      x={x} y={y} width={w} height={h}
                      fill={color}
                      stroke={stroke}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      rx={3}
                    />
                    <text
                      x={x + 4} y={y - 4}
                      fill={stroke}
                      fontSize={10}
                      fontWeight="600"
                      fontFamily="system-ui, sans-serif"
                    >
                      {area.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          );
        })()}

        {/* Loading the revision-bound geometry + transcript placement. */}
        {onLetterPage && isLoading && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            <div className="line-review-spinner" />
            <div className="detection-status">
              {alignmentIsLoading
                ? 'Loading transcript placement...'
                : 'Loading line segments...'}
            </div>
          </div>
        )}

        {onLetterPage
          && !isLoading
          && currentAlignmentError
          && imageNaturalSize.width > 0
          && (
          <div className="line-review-analyzing">
            Transcript placement could not be loaded.
            <br />
            <small>{currentAlignmentError.message}</small>
            <br />
            <button
              type="button"
              onClick={() => {
                void refreshProductionAlignment();
              }}
            >
              Try again
            </button>
          </div>
        )}

        {!isLoading
          && !currentAlignmentError
          && hasTranscriptLinesOnPage
          && alignedLines.length === 0
          && imageNaturalSize.width > 0
          && (
          <div className="line-review-analyzing">
            {currentProductionPage?.statusMessage
              ?? 'No transcript placement is available for this page.'}
          </div>
        )}
      </div>

      {overlayEnabled
        && currentLine?.geometrySource === 'unlocated'
        && !segmentEditor.segmentEditMode
        && (
          <div
            className="line-review-unlocated-editor"
            role="group"
            aria-label="Transcript line without a detected page location"
          >
            <div className="line-review-unlocated-heading">
              <strong>No detected location</strong>
              <span>
                {currentLine.pageStatus === 'recognition-missing'
                  ? (
                      currentLine.statusMessage
                      ?? 'The current geometry still needs local handwriting recognition before it can be matched.'
                    )
                  : currentLine.pageStatus === 'geometry-missing'
                    ? 'No line outline exists for this transcript line. Add or adjust a segment in edit mode if needed.'
                    : 'The aligner could not confidently connect this transcript line to a page outline.'}
              </span>
            </div>
            <div
              ref={inputRef}
              contentEditable={!navigationPending}
              suppressContentEditableWarning
              className="line-review-editable"
              onInput={() => {
                if (navigationPendingRef.current) return;
                handleInputChange();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault();
              }}
            />
          </div>
        )}

      {/* Progress indicator */}
      <div className="line-review-progress">
        {onLetterPage && totalLines > 0 && (
          <span className="progress-line">
            <strong>Line {globalLineIndex}</strong> / {totalLines}
          </span>
        )}
        {!onLetterPage && (
          <span className="progress-line" style={{ color: '#999' }}>
            {currentPage.type.replace(/_/g, ' ')}
          </span>
        )}
        {allPages.length > 1 && (
          <span className="progress-line">
            Page {currentPageIndex + 1} / {allPages.length}
          </span>
        )}
      </div>

      {/* Debug legend — Detection Layers panel */}
      {debugLines && (
        <div className="line-review-debug-legend">
          <span className="debug-legend-title">Detection Layers</span>
          <button
            className={`debug-legend-toggle${showKrakenLines ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowKrakenLines(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-kraken" />
            Kraken Lines
          </button>
          <button
            className={`debug-legend-toggle${showExcludedContent ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowExcludedContent(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-excluded" />
            Excluded Content
          </button>
        </div>
      )}

      {/* Fixed page navigation buttons */}
      {allPages.length > 1 && (
        <>
          <button
            className="line-review-page-nav line-review-page-nav-left"
            onClick={goToPrevPage}
            disabled={
              currentPageIndex === 0
              || geometryApprovalPending
              || segmentReloadPending
              || navigationPending
            }
            aria-label="Previous page"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="line-review-page-nav line-review-page-nav-right"
            onClick={goToNextPage}
            disabled={
              currentPageIndex === allPages.length - 1
              || geometryApprovalPending
              || segmentReloadPending
              || navigationPending
            }
            aria-label="Next page"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8 4L14 10L8 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </>
      )}

      {/* Minimap — shown when fit-height mode is zoomed in */}
      {fitHeight && fitZoom > 1 && imageDisplaySize.width > 0 && containerRef.current && (() => {
        const dw = imageDisplaySize.width;
        const dh = imageDisplaySize.height;
        const cw = containerRef.current.clientWidth;
        const ch = containerRef.current.clientHeight;
        const leftPct = Math.max(0, (0.5 - (cw / 2 + fitPan.x) / (fitZoom * dw)) * 100);
        const topPct = Math.max(0, (0.5 - (ch / 2 + fitPan.y) / (fitZoom * dh)) * 100);
        const widthPct = Math.min(100, (cw / (fitZoom * dw)) * 100);
        const heightPct = Math.min(100, (ch / (fitZoom * dh)) * 100);
        return (
          <div
            className="line-review-minimap"
            onPointerDown={handleMinimapPointerDown}
            onPointerMove={handleMinimapPointerMove}
            onPointerUp={handleMinimapPointerEnd}
            onPointerCancel={handleMinimapPointerEnd}
          >
            <img
              src={getImageUrl(currentPage.imageUrl, { width: 200 })}
              alt=""
              className="line-review-minimap-thumb"
              draggable={false}
            />
            <div
              className="line-review-minimap-viewport"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${widthPct}%`,
                height: `${heightPct}%`,
              }}
            />
          </div>
        );
      })()}

      {/* An approved revision is read-only until the reviewer explicitly reopens it. */}
      {overlayEnabled && segmentEditor.segmentEditMode && currentPageTrusted && (
        <div
          className="seg-lock-overlay"
          onClick={showLockHint}
          onDoubleClick={handleUnverifySegments}
          onWheel={(e) => {
            // Forward scroll to the container so the page still scrolls normally while locked
            const el = containerRef.current;
            if (el) el.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: 'auto' });
          }}
        >
          {lockHintVisible && (
            <span className="seg-lock-overlay-hint">This page is approved. Choose Reopen to edit it.</span>
          )}
        </div>
      )}

      {/* Compact page-revision controls. Geometry remains the visual focus. */}
      {overlayEnabled && segmentEditor.segmentEditMode && (
        <div
          className="seg-editor-actions"
          aria-busy={geometryApprovalPending || segmentReloadPending}
        >
          <span
            className={`seg-editor-save-state is-${currentGeometrySaveStatus}`}
            role="status"
          >
            {geometrySaveStatusLabel(currentGeometrySaveStatus)}
          </span>
          {segmentEditor.selectedSegmentId && (
            <span
              className={`seg-editor-provenance is-${selectedGeometryProvenance?.source ?? 'machine'}`}
              title={selectedGeometryProvenance
                ? `Last geometry action: ${selectedGeometryProvenance.operation}`
                : 'Original detector geometry'}
            >
              {selectedGeometryLabel}
            </span>
          )}
          {currentPageTrusted ? (
            <>
              <span className="seg-editor-verified-info">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7.5l2.5 2.5 5.5-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Page approved
              </span>
              <button
                className="seg-editor-action-btn"
                onClick={handleUnverifySegments}
                disabled={geometryApprovalPending || segmentReloadPending}
              >
                Reopen
              </button>
            </>
          ) : (
            <button
              className="seg-editor-verify-btn"
              onClick={handleVerifySegments}
              disabled={
                currentGeometrySaveStatus === 'saving'
                || currentGeometrySaveStatus === 'conflict'
                || geometryApprovalPending
                || segmentReloadPending
                || (!currentGeometryState?.geometryChecksumSha256 && !segmentEditor.isDirty)
              }
            >
              Approve page
            </button>
          )}
          {currentGeometrySaveStatus === 'conflict' && (
            <button
              className="seg-editor-action-btn"
              onClick={() => {
                void reloadSegments(true);
              }}
              disabled={geometryApprovalPending || segmentReloadPending}
            >
              Reload
            </button>
          )}
          <button
            className="seg-editor-action-btn danger"
            onClick={() => {
              if (geometryEditingLockedRef.current) return;
              segmentEditor.resetFromSource(currentKrakenSegments, { preserveSelection: true });
              if (currentPage) {
                setGeometrySaveStatusMap((previous) => ({
                  ...previous,
                  [currentPage.id]: 'idle',
                }));
              }
            }}
            disabled={
              !segmentEditor.isDirty
              || geometryEditingLocked
            }
          >
            Undo unsaved
          </button>
        </div>
      )}


      {/* Segment editor mini-toolbar — shown only in edit mode */}
      {overlayEnabled && segmentEditor.segmentEditMode && (
        <div
          className={`segment-editor-toolbar${currentPageTrusted ? ' locked' : ''}${subtractMode ? ' subtract-mode' : ''}`}
          aria-disabled={geometryEditingLocked}
          style={{
            pointerEvents: geometryEditingLocked ? 'none' : undefined,
          }}
        >
          {/* Undo/Redo */}
          <div className="seg-toolbar-group">
            <button
              className="segment-editor-toolbar-btn segment-editor-toolbar-btn-icon"
              onClick={() => segmentEditor.undo()}
              disabled={geometryEditingLocked || !segmentEditor.canUndo}
              data-hint="Undo (⌘Z)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l-3 3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M1 9h9a4 4 0 0 1 0 8H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            </button>
            <button
              className="segment-editor-toolbar-btn segment-editor-toolbar-btn-icon"
              onClick={() => segmentEditor.redo()}
              disabled={geometryEditingLocked || !segmentEditor.canRedo}
              data-hint="Redo (⌘⇧Z)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M12 6l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M15 9H6a4 4 0 0 0 0 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          </div>

          <span className="segment-editor-toolbar-divider" />

          {/* Draw tools group */}
          <div className="seg-toolbar-group">
            <span className="seg-toolbar-label">Draw</span>
            <button
              className={`segment-editor-toolbar-btn${drawTool === 'select' ? ' active' : ''} segment-editor-toolbar-btn-icon`}
              onClick={() => setDrawTool('select')}
              disabled={geometryEditingLocked}
              data-hint="Select (S)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 2l9 5.5-4 1.2-2.2 4z" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              className={`segment-editor-toolbar-btn${drawTool === 'box' ? ' active' : ''} segment-editor-toolbar-btn-icon`}
              onClick={() => setDrawTool('box')}
              disabled={geometryEditingLocked}
              data-hint="Box (B)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
              </svg>
            </button>
            <button
              className={`segment-editor-toolbar-btn${drawTool === 'polygon' ? ' active' : ''} segment-editor-toolbar-btn-icon`}
              onClick={() => setDrawTool('polygon')}
              disabled={geometryEditingLocked}
              data-hint="Polygon (P)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <polygon points="8,2 14,6 12,14 4,14 2,6" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
                <circle cx="8" cy="2" r="1.5" fill="currentColor" />
                <circle cx="14" cy="6" r="1.5" fill="currentColor" />
                <circle cx="12" cy="14" r="1.5" fill="currentColor" />
                <circle cx="4" cy="14" r="1.5" fill="currentColor" />
                <circle cx="2" cy="6" r="1.5" fill="currentColor" />
              </svg>
            </button>
            <button
              className={`segment-editor-toolbar-btn${drawTool === 'draw' ? ' active' : ''} segment-editor-toolbar-btn-icon`}
              onClick={() => setDrawTool('draw')}
              disabled={geometryEditingLocked}
              data-hint="Draw (D)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 21l1.5-4.5L17.3 3.7a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L7.5 19.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
                <path d="M14.5 6.5l3 3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
          </div>

          {/* Edit tools + classification — visible when a segment is selected */}
          {segmentEditor.selectedSegmentId && (() => {
            const sel = segmentEditor.editedSegments.find(
              (s) => s._id === segmentEditor.selectedSegmentId,
            );
            if (!sel) return null;
            const currentClass = sel.segmentClass ?? 'body';
            return (
              <>
                <span className="segment-editor-toolbar-divider" />
                <div className="seg-toolbar-group">
                  <span className="seg-toolbar-label">Edit</span>
                  <button
                    className={`segment-editor-toolbar-btn${subtractMode ? ' active subtract-active' : ''} segment-editor-toolbar-btn-icon`}
                    onClick={() => setSubtractMode((v) => !v)}
                    disabled={geometryEditingLocked}
                    data-hint="Subtract (R)"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    className={`segment-editor-toolbar-btn${editMode === 'rotate' ? ' active rotate-active' : ''} segment-editor-toolbar-btn-icon`}
                    onClick={() => {
                      if (geometryEditingLockedRef.current) return;
                      if (editMode !== 'rotate') {
                        segmentEditor.ensureBoundary(sel._id);
                        setEditMode('rotate');
                      } else {
                        setEditMode('resize');
                      }
                    }}
                    disabled={geometryEditingLocked}
                    data-hint="Rotate (T)"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M13 8a5 5 0 01-9 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
                      <path d="M3 8a5 5 0 019-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
                      <path d="M11 3l1.2 2.2L10 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      <path d="M5 13l-1.2-2.2 2.2-.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </button>
                </div>

                <span className="segment-editor-toolbar-divider" />

                {/* Classification dropdown */}
                <div className="seg-toolbar-group seg-class-dropdown-wrap">
                  <button
                    className={`segment-editor-toolbar-btn seg-class-trigger seg-class-${currentClass}`}
                    onClick={() => setClassDropdownOpen((v) => !v)}
                    disabled={geometryEditingLocked}
                  >
                    {currentClass}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 4 }}>
                      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {classDropdownOpen && !geometryEditingLocked && (
                    <div className="seg-class-dropdown">
                      {(['body', 'continuation', 'addition', 'ignore'] as const).map((cls) => (
                        <button
                          key={cls}
                          className={`seg-class-dropdown-item${currentClass === cls ? ' active' : ''} seg-class-${cls}`}
                          onClick={() => {
                            segmentEditor.classifySegment(sel._id, cls);
                            setClassDropdownOpen(false);
                          }}
                        >
                          {cls}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <span className="segment-editor-toolbar-divider" />

                {/* Delete selected segment */}
                <button
                  className="segment-editor-toolbar-btn segment-editor-toolbar-btn-icon seg-toolbar-delete"
                  onClick={() => segmentEditor.deleteSegment(sel._id)}
                  disabled={geometryEditingLocked}
                  data-hint="Delete (Del)"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 4h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    <path d="M6 4V2.8A0.8 0.8 0 0 1 6.8 2h2.4a0.8 0.8 0 0 1 0.8 0.8V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <path d="M4.5 4l0.6 9a1 1 0 0 0 1 0.9h3.8a1 1 0 0 0 1-0.9l0.6-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6.8 7v4.5M9.2 7v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              </>
            );
          })()}
        </div>
      )}

      {/* Bottom toolbar — overlay visibility + mode toggle + fit-height */}
      <div className="line-review-toolbar">
        {/* Overlay master toggle — hides both transcript and segments when off, preserves mode */}
        <button
          className={`line-review-toolbar-btn${overlayEnabled ? ' active' : ''}`}
          onClick={() => setOverlayEnabled(v => !v)}
          title={overlayEnabled ? 'Hide overlay' : 'Show overlay'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            {overlayEnabled ? (
              <path d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5S11.5 3 8 3zm0 8a3 3 0 110-6 3 3 0 010 6z" stroke="currentColor" strokeWidth="1.5"/>
            ) : (
              <>
                <path d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5S11.5 3 8 3zm0 8a3 3 0 110-6 3 3 0 010 6z" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
                <path d="M2 14L14 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </>
            )}
          </svg>
          Overlay
        </button>
        <span className="line-review-toolbar-divider" />
        {/* Transcript ↔ Segments toggle — only meaningful when overlay is on */}
        {(() => {
          const isSegments = segmentEditor.segmentEditMode;
          const toggle = async () => {
            if (navigationPendingRef.current) return;
            // Always make sure overlay is on when switching modes
            if (!overlayEnabled) setOverlayEnabled(true);
            if (isSegments) {
              await handleExitSegmentEditMode();
            } else {
              segmentEditor.setSegmentEditMode(true);
            }
          };
          // Label describes what clicking will switch TO
          const label = isSegments ? 'Transcript' : 'Segments';
          return (
            <button
              className="line-review-toolbar-btn"
              onClick={toggle}
              disabled={navigationPending}
              title={isSegments ? 'Switch to transcript editor' : 'Switch to segment editor'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                {isSegments ? (
                  <path d="M3 4h10M3 8h10M3 12h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                ) : (
                  <>
                    <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M9.5 3.5l3 3" stroke="currentColor" strokeWidth="1.5"/>
                  </>
                )}
              </svg>
              {label}
            </button>
          );
        })()}
        <span className="line-review-toolbar-divider" />
        <button
          className={`line-review-toolbar-btn${fitHeight ? ' active' : ''}`}
          onClick={() => { setFitHeight(v => !v); setFitZoom(1); setFitPan({ x: 0, y: 0 }); }}
          title={fitHeight ? 'Switch to scroll mode' : 'Fit to height'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            {fitHeight ? (
              <>
                <rect x="5" y="2" width="6" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <path d="M8 5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </>
            ) : (
              <path d="M4 2H12M4 14H12M8 4V12M6 4L8 2L10 4M6 12L8 14L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            )}
          </svg>
          {fitHeight ? 'Scroll' : 'Fit Height'}
        </button>
        {fitHeight && fitZoom !== 1 && (
          <>
            <span className="line-review-toolbar-divider" />
            <span className="line-review-toolbar-zoom">{Math.round(fitZoom * 100)}%</span>
          </>
        )}
      </div>

    </div>
  );
});

export default LineReviewMode;
