import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { getErrorMessage, getImageUrl } from '../../api/client';
import { getPageLineSegments, savePageLineSegments } from '../../api/admin/letters';
import type { Letter, LineSegment, LineSegmentWord, SpecialArea } from '../../types/Letter';
import { useSegmentEditor } from '../../hooks/useSegmentEditor';
import SegmentEditorOverlay from './SegmentEditorOverlay';
import { constrainedGrouping, eastEdgeY, westEdgeY } from '../../utils/constrainedGrouping';
import { matchTranscriptToLines, type MatchedLine } from '../../utils/transcriptMatcher';
import {
  alignTranscriptToVisualLines,
  type AlignmentInput,
  type AlignedLine,
} from '../../utils/lineAlignment';
import { useToast } from '../../contexts/ToastContext';
import { highlightTranscriptMarkers } from '../../utils/transcriptHighlight';
import {
  CSS_BORDER_PADDING,
  computeLineInputHeight,
  computeLineFontSize,
  measureRenderedTextWidth,
  mergeEditedTextWithOriginalSpacing,
  normalizeReviewLineText,
  reconstructTranscript,
  splitTranscriptByPage,
} from './lineReviewUtils';
import './LineReviewMode.css';

interface LineReviewModeProps {
  letter: Letter;
  transcript: string;
  onTranscriptChange: (newFullTranscript: string) => void;
  onExit: () => void;
  onAutoSave: (data: { transcriptionText: string }) => void;
  debugMode?: boolean;
  onDebugModeChange?: (debugMode: boolean) => void;
  initialPageIndex?: number;
}

export interface LineReviewModeHandle {
  saveCurrentLine: () => void;
  reloadSegments: () => void;
  isLoading: boolean;
}

export function computeAutoScrollTop(params: {
  currentLineIndex: number;
  movementDirection: 'up' | 'down' | 'none';
  currentScrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  regionTop: number;
  regionBottom: number;
}): number | null {
  const {
    currentLineIndex,
    movementDirection,
    currentScrollTop,
    viewportHeight,
    contentHeight,
    regionTop,
    regionBottom,
  } = params;

  if (viewportHeight <= 0) return null;

  const maxScroll = Math.max(0, contentHeight - viewportHeight);

  // Returning to the first line should snap back to the top, but only if
  // we've actually scrolled away from it.
  if (currentLineIndex === 0) {
    return currentScrollTop > 0.5 ? 0 : null;
  }

  if (maxScroll <= currentScrollTop + 0.5) {
    return null;
  }

  const visibleRegionTop = regionTop - currentScrollTop;
  const visibleRegionBottom = regionBottom - currentScrollTop;
  const regionHeight = Math.max(1, visibleRegionBottom - visibleRegionTop);
  const holdBuffer = Math.max(40, regionHeight * 1.75);

  const topTriggerLine = viewportHeight * 0.42;
  const bottomTriggerLine = viewportHeight * 0.58;

  // When moving back up through the page, use a matching top threshold so
  // the viewport recenters in reverse instead of only ever scrolling down.
  if (movementDirection === 'up' && visibleRegionTop < topTriggerLine) {
    const nextScrollTop = Math.max(
      0,
      currentScrollTop - ((topTriggerLine - visibleRegionTop) + holdBuffer),
    );

    return nextScrollTop < currentScrollTop - 0.5 ? nextScrollTop : null;
  }

  if (movementDirection !== 'down') {
    return null;
  }

  // Let the active line move slightly past the midpoint before we scroll
  // downward.
  if (visibleRegionBottom <= bottomTriggerLine) {
    return null;
  }

  // Scroll a bit more than one line so adjacent up/down navigation doesn't
  // constantly retrigger auto-scroll.
  const nextScrollTop = Math.min(
    maxScroll,
    currentScrollTop + (visibleRegionBottom - bottomTriggerLine) + holdBuffer,
  );

  return nextScrollTop > currentScrollTop + 0.5 ? nextScrollTop : null;
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
  debugMode: debugLines = false,
  onDebugModeChange,
  initialPageIndex,
}: LineReviewModeProps, ref) {
  const { showToast } = useToast();

  // All images (letter + extra content) for page navigation
  const allPages = useMemo(() => letter.images, [letter.images]);

  // Letter-only pages for transcript/line detection
  const letterPages = useMemo(
    () => letter.images.filter((img) => img.type === 'letter'),
    [letter.images],
  );

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
  const [aiSegmentsMap, setAiSegmentsMap] = useState<Record<number, AlignmentInput[] | null | undefined>>(() => {
    const initial: Record<number, AlignmentInput[] | null | undefined> = {};
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
  const [fitHeight, setFitHeight] = useState(false);
  // Zoom + pan for fit-height mode
  const [fitZoom, setFitZoom] = useState(1);
  const [fitPan, setFitPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Debug overlay layer toggles
  const [showKrakenLines, setShowKrakenLines] = useState(true);
  const [showGroupedLines, setShowGroupedLines] = useState(true);
  const [showUnifiedLines, setShowUnifiedLines] = useState(false);
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

  // Segment editor — admin controls for editing Kraken segments
  const currentKrakenSegments = useMemo(
    () => (currentLetterPageIndex !== undefined ? krakenSegmentsMap[currentLetterPageIndex] ?? [] : []),
    [krakenSegmentsMap, currentLetterPageIndex],
  );
  const segmentEditor = useSegmentEditor(currentKrakenSegments);

  // Sync segment editor when source segments change (page switch or redetect)
  const lastSourceRef = useRef(currentKrakenSegments);
  useEffect(() => {
    if (currentKrakenSegments !== lastSourceRef.current) {
      lastSourceRef.current = currentKrakenSegments;
      segmentEditor.resetFromSource(currentKrakenSegments);
    }
  }, [currentKrakenSegments, segmentEditor]);

  // Detection progress steps (shown in loading overlay for current page)

  // Per-page raw text (preserves all whitespace including blank lines)
  const [pageRawTexts, setPageRawTexts] = useState<string[]>(() => {
    return splitTranscriptByPage(transcript, letterPages.length);
  });

  // Non-blank line indices per page — maps aligned line index to raw line index
  const pageNonBlankMap = useMemo(() => {
    return pageRawTexts.map((raw) => {
      const allLines = raw.split('\n');
      const indices: number[] = [];
      allLines.forEach((line, i) => {
        if (line.trim().length > 0) indices.push(i);
      });
      return indices;
    });
  }, [pageRawTexts]);

  // Non-blank lines per page (for alignment and display)
  const pageLineTexts = useMemo(() => {
    return pageRawTexts.map((raw) =>
      raw.split('\n').filter((l) => l.trim().length > 0),
    );
  }, [pageRawTexts]);

  // Unified pipeline: attach words, constrained grouping, transcript matching
  // Only runs for letter pages (non-letter pages have no detection data)
  const pipelineResult = useMemo(() => {
    if (currentLetterPageIndex === undefined) return null;
    const rawSegments = krakenSegmentsMap[currentLetterPageIndex] ?? [];

    // Filter out excluded segments before grouping
    const activeSegments = rawSegments.filter(s => !s.excluded);
    if (activeSegments.length === 0) return null;

    // Phase 1: Constrained grouping
    const { lines: groupedLines, marginalSegments } = constrainedGrouping(activeSegments);

    // Phase 2: Match transcript to grouped lines
    const transcriptLines = pageLineTexts[currentLetterPageIndex] ?? [];
    const matchResult = matchTranscriptToLines(transcriptLines, groupedLines);

    return { groupedLines, marginalSegments, matchResult };
  }, [krakenSegmentsMap, currentLetterPageIndex, pageLineTexts]);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const lastGlobalLineIndexRef = useRef<number | null>(null);

  const currentPage = allPages[currentPageIndex];

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

    const pageText = pageLineTexts[lpIdx]?.join('\n') || '';
    if (!pageText.trim()) return;

    setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: null }));

    getPageLineSegments(currentPage.id)
      .then(segments => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: segments }));
        setKrakenSegmentsMap(prev => ({ ...prev, [lpIdx]: segments }));
      })
      .catch(() => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: [] }));
      });
  }, [currentPage, currentLetterPageIndex, aiSegmentsMap, pageLineTexts]);

  // Background pre-fetch: load segments for upcoming pages.
  useEffect(() => {
    if (currentLetterPageIndex !== undefined) {
      if (aiSegmentsMap[currentLetterPageIndex] === null || aiSegmentsMap[currentLetterPageIndex] === undefined) return;
    }

    for (let i = 0; i < letterPages.length; i++) {
      const idx = (((currentLetterPageIndex ?? -1) + 1 + i) % letterPages.length);
      if (aiSegmentsMap[idx] !== undefined || aiSegmentsMap[idx] === null) continue;

      const pageText = pageLineTexts[idx]?.join('\n') || '';
      if (!pageText.trim()) continue;

      const page = letterPages[idx];
      setAiSegmentsMap(prev => ({ ...prev, [idx]: null }));

      getPageLineSegments(page.id)
        .then(segments => {
          setAiSegmentsMap(prev => ({ ...prev, [idx]: segments }));
          setKrakenSegmentsMap(prev => ({ ...prev, [idx]: segments }));
        })
        .catch(() => {
          setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        });

      break;
    }
  }, [aiSegmentsMap, currentLetterPageIndex, letterPages, pageLineTexts]);

  // Whether we're still waiting for AI detection for the current letter page
  const isLoading = currentLetterPageIndex !== undefined && aiSegmentsMap[currentLetterPageIndex] === null;
  const imageReady = imageNaturalSize.width > 0;
  const onLetterPage = currentLetterPageIndex !== undefined;

  // Compute aligned lines for current page (empty for non-letter pages)
  const alignedLines: AlignedLine[] = useMemo(() => {
    if (!currentPage || !onLetterPage || currentLetterPageIndex === undefined) return [];
    if (isLoading) return []; // AI detection in progress — show spinner, no lines yet
    const transcriptLines = pageLineTexts[currentLetterPageIndex] ?? [];
    const pageText = transcriptLines.join('\n');

    const aiResult = aiSegmentsMap[currentLetterPageIndex];
    if (aiResult && aiResult.length > 0) {
      const lines = alignTranscriptToVisualLines(pageText, aiResult);
      return lines.filter(l => l.transcriptLineIndex >= 0);
    }

    // No Kraken segments — don't fall back to pixel detection
    return [];
  }, [currentPage, currentLetterPageIndex, onLetterPage, pageLineTexts, aiSegmentsMap, isLoading, imageReady]);
  const hasTranscriptLinesOnPage = onLetterPage && currentLetterPageIndex !== undefined
    && (pageLineTexts[currentLetterPageIndex]?.length ?? 0) > 0;

  // Only expose currentLine when the image for this page has loaded,
  // so overlays never render at positions scaled from a previous page's dimensions
  const currentLine = imageReady ? alignedLines[currentLineIndex] : undefined;
  // Line counts per letter page (indexed by letter page index)
  const pageLineCounts = useMemo(
    () => letterPages.map((_page, idx) => {
      const pageText = pageLineTexts[idx]?.join('\n') || '';
      const transcriptLineCount = pageText.split('\n').filter((l) => l.trim().length > 0).length;
      const aiSegs = aiSegmentsMap[idx];

      if (aiSegs && aiSegs.length > 0) {
        return alignTranscriptToVisualLines(pageText, aiSegs)
          .filter((line) => line.transcriptLineIndex >= 0)
          .length;
      }

      return transcriptLineCount;
    }),
    [letterPages, pageLineTexts, aiSegmentsMap, currentLetterPageIndex],
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

  useEffect(() => {
    if (!fitHeight) return;
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        // Proportional zoom — feels smooth at all zoom levels
        const factor = e.deltaY > 0 ? 0.97 : 1.03;
        setFitZoom(prev => {
          const next = prev * factor;
          const clamped = Math.min(5, Math.max(1, next));
          // Reset pan when zooming back to 1x
          if (clamped === 1) setFitPan({ x: 0, y: 0 });
          return clamped;
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [fitHeight]);

  // Pan handlers for fit-height zoom
  const handlePanMouseDown = useCallback((e: React.MouseEvent) => {
    if (!fitHeight || fitZoom <= 1) return;
    e.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - fitPan.x, y: e.clientY - fitPan.y };
  }, [fitHeight, fitZoom, fitPan]);

  const handlePanMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setFitPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    });
  }, [isPanning]);

  const handlePanMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Save current line text and trigger auto-save (only if user actually edited)
  const saveCurrentLine = useCallback(() => {
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

    // Use the tracked transcript line index (not the visual line index)
    const transcriptIdx = currentAligned.transcriptLineIndex;
    if (transcriptIdx < 0) return; // empty/unassigned line — nothing to save

    const rawLineIndex = pageNonBlankMap[currentLetterPageIndex]?.[transcriptIdx];
    if (rawLineIndex === undefined) return;

    const updated = [...pageRawTexts];
    const rawLines = updated[currentLetterPageIndex].split('\n');
    rawLines[rawLineIndex] = mergeEditedTextWithOriginalSpacing(originalText, newText);
    updated[currentLetterPageIndex] = rawLines.join('\n');

    setPageRawTexts(updated);

    // Flush parent updates synchronously so exiting review mode does not
    // discard the line edit before the child unmounts.
    const fullText = reconstructTranscript(updated);
    onTranscriptChange(fullText);
    onAutoSave({ transcriptionText: fullText });
  }, [currentLetterPageIndex, currentLineIndex, alignedLines, pageNonBlankMap, onTranscriptChange, onAutoSave, pageRawTexts]);

  // Save segment edits and exit edit mode
  const handleSaveSegmentEdits = useCallback(async () => {
    if (!segmentEditor.isDirty || currentLetterPageIndex === undefined) {
      segmentEditor.setSegmentEditMode(false);
      return;
    }
    const pageId = letterPages[currentLetterPageIndex]?.id;
    if (!pageId) return;
    const segments = segmentEditor.getSegmentsForSave();
    try {
      await savePageLineSegments(pageId, segments);
      // Update local kraken map so pipeline recomputes
      setKrakenSegmentsMap(prev => ({ ...prev, [currentLetterPageIndex]: segments }));
      setAiSegmentsMap(prev => ({ ...prev, [currentLetterPageIndex]: segments }));
      segmentEditor.markClean();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save segment edits'), 'error');
    }
  }, [segmentEditor, currentLetterPageIndex, letterPages, showToast]);

  const handleExitSegmentEditMode = useCallback(async () => {
    if (segmentEditor.isDirty) {
      await handleSaveSegmentEdits();
    }
    segmentEditor.setSegmentEditMode(false);
  }, [segmentEditor, handleSaveSegmentEdits]);

  // Navigate to next line (cross-page: skips to next letter page)
  const goToNextLine = useCallback(() => {
    saveCurrentLine();
    if (currentLineIndex < alignedLines.length - 1) {
      setCurrentLineIndex(currentLineIndex + 1);
    } else {
      // Find next letter page in allPages
      for (let i = currentPageIndex + 1; i < allPages.length; i++) {
        if (letterPageIndices.has(i)) {
          setCurrentPageIndex(i);
          setCurrentLineIndex(0);
          containerRef.current?.scrollTo({ top: 0 });
          return;
        }
      }
    }
  }, [saveCurrentLine, currentLineIndex, alignedLines.length, currentPageIndex, allPages.length, letterPageIndices]);

  // Navigate to previous line (cross-page: skips to prev letter page)
  const goToPrevLine = useCallback(() => {
    saveCurrentLine();
    if (currentLineIndex > 0) {
      setCurrentLineIndex(currentLineIndex - 1);
    } else {
      // Find previous letter page in allPages
      for (let i = currentPageIndex - 1; i >= 0; i--) {
        if (letterPageIndices.has(i)) {
          setCurrentPageIndex(i);
          // Set to high number — will be clamped in the effect below
          setCurrentLineIndex(999);
          return;
        }
      }
    }
  }, [saveCurrentLine, currentLineIndex, currentPageIndex, letterPageIndices]);

  // Navigate to next page (any type)
  const goToNextPage = useCallback(() => {
    if (currentPageIndex >= allPages.length - 1) return;
    saveCurrentLine();
    if (segmentEditor.segmentEditMode && segmentEditor.isDirty) {
      handleSaveSegmentEdits();
    }
    setCurrentPageIndex(currentPageIndex + 1);
    setCurrentLineIndex(0);
    containerRef.current?.scrollTo({ top: 0 });
  }, [currentPageIndex, allPages.length, saveCurrentLine, segmentEditor, handleSaveSegmentEdits]);

  // Navigate to previous page (any type)
  const goToPrevPage = useCallback(() => {
    if (currentPageIndex <= 0) return;
    saveCurrentLine();
    if (segmentEditor.segmentEditMode && segmentEditor.isDirty) {
      handleSaveSegmentEdits();
    }
    setCurrentPageIndex(currentPageIndex - 1);
    setCurrentLineIndex(0);
    containerRef.current?.scrollTo({ top: 0 });
  }, [currentPageIndex, saveCurrentLine]);

  // Clamp line index when aligned lines change (e.g., after page switch)
  useEffect(() => {
    if (alignedLines.length > 0 && currentLineIndex >= alignedLines.length) {
      setCurrentLineIndex(alignedLines.length - 1);
    }
  }, [alignedLines.length, currentLineIndex]);

  // Auto-scroll to keep current line visible (highlight + input region)
  useEffect(() => {
    if (!currentLine || !containerRef.current || fitHeight) return;

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

    inputRef.current.focus();
    const sel = window.getSelection();
    if (sel && inputRef.current.firstChild) {
      sel.collapse(inputRef.current.firstChild, 0);
    }
  }, [currentLineIndex, currentPageIndex, alignedLines, scaleFactor, imageNaturalSize.width, imageDisplaySize.height, imageNaturalSize.height]);

  // Re-fetch line segments from the database for the current page
  const reloadSegments = useCallback(() => {
    if (!currentPage || isLoading || currentLetterPageIndex === undefined) return;

    const lpIdx = currentLetterPageIndex;

    setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: null }));
    setKrakenSegmentsMap(prev => ({ ...prev, [lpIdx]: undefined }));
    setCurrentLineIndex(0);

    getPageLineSegments(currentPage.id)
      .then(segments => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: segments }));
        setKrakenSegmentsMap(prev => ({ ...prev, [lpIdx]: segments }));
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: [] }));
        showToast(getErrorMessage(err, 'Failed to load segments'), 'error');
      });
  }, [currentPage, currentLetterPageIndex, isLoading, showToast]);

  useImperativeHandle(ref, () => ({
    saveCurrentLine,
    reloadSegments,
    isLoading,
  }), [saveCurrentLine, reloadSegments, isLoading]);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Segment edit mode keyboard handling
      if (segmentEditor.segmentEditMode) {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleExitSegmentEditMode();
          return;
        }
        if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && segmentEditor.canUndo) {
          e.preventDefault();
          segmentEditor.undo();
          return;
        }
        // Block line navigation keys in edit mode
        if (['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          return;
        }
        return; // Don't process other keys in edit mode
      }

      // Only handle when our input is focused or the container is active
      if (e.key === 'Escape') {
        e.preventDefault();
        saveCurrentLine();
        onExit();
        return;
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
  }, [saveCurrentLine, onExit, goToNextLine, goToPrevLine, goToNextPage, goToPrevPage, onLetterPage, overlayEnabled, reloadSegments, debugLines, onDebugModeChange, segmentEditor, handleExitSegmentEditMode]);

  if (!currentPage) return null;

  // Dynamic height for the editable strip — based on current line's word heights and font size
  // Compute overlay positions
  const displayedImageHeight = imageDisplaySize.height || (imageNaturalSize.height * scaleFactor);
  const imgW = imageDisplaySize.width;

  // Input position — derived from line bbox, below the clear strip.
  // The overlay must be wide enough for the actual OCR word extent (which can
  // exceed the line bbox), plus border/padding/rendering tolerance.
  const LINE_GAP = 4;
  const inputTop = currentLine ? currentLine.bbox[3] * scaleFactor + LINE_GAP : 0;
  const linePad = imageNaturalSize.width * 0.01;
  const rightExtra = CSS_BORDER_PADDING * 2 + 8; // both-side border+padding + rendering tolerance

  // Use the wider of line bbox and OCR word extent so text is never clipped
  let ocrRightX = currentLine?.bbox[2] ?? 0;
  let ocrLeftX = currentLine?.bbox[0] ?? 0;
  if (currentLine?.words && currentLine.words.length > 0) {
    ocrLeftX = Math.min(ocrLeftX, ...currentLine.words.map(w => w.bbox[0]));
    ocrRightX = Math.max(ocrRightX, ...currentLine.words.map(w => w.bbox[2]));
  }
  const inputLeft = currentLine ? Math.max(0, (ocrLeftX - linePad) * scaleFactor) : 0;
  const inputRight = currentLine ? Math.min(imgW, (ocrRightX + linePad) * scaleFactor + rightExtra) : imgW;
  const inputWidth = inputRight - inputLeft;

  // Per-line font size: scales up for short text, bounded by available height below line
  const maxInputHeight = Math.min(displayedImageHeight - inputTop, 150);
  const fontSize = currentLine
    ? computeLineFontSize(currentLine.transcriptText, currentLine.words, currentLine.bbox, scaleFactor, maxInputHeight)
    : pageFontSize;
  const INPUT_DISPLAY_HEIGHT = fontSize + CSS_BORDER_PADDING * 2;

  // Build highlight polygon points from Kraken boundary (or bbox fallback).
  const highlightPoints = useMemo(() => {
    if (!currentLine) return '';

    if (currentLine.boundary && currentLine.boundary.length > 2) {
      return currentLine.boundary
        .map(p => `${p.x * scaleFactor},${p.y * scaleFactor}`)
        .join(' ');
    }

    // Fallback: bbox rectangle
    const [x1, y1, x2, y2] = currentLine.bbox;
    const sx1 = x1 * scaleFactor, sy1 = y1 * scaleFactor;
    const sx2 = x2 * scaleFactor, sy2 = y2 * scaleFactor;
    return `${sx1},${sy1} ${sx2},${sy1} ${sx2},${sy2} ${sx1},${sy2}`;
  }, [currentLine, scaleFactor]);

  const handleFullExit = useCallback(() => {
    saveCurrentLine();
    if (segmentEditor.segmentEditMode && segmentEditor.isDirty) {
      handleSaveSegmentEdits();
    }
    onExit();
  }, [saveCurrentLine, segmentEditor, handleSaveSegmentEdits, onExit]);

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only exit when clicking directly on the dark background (not the image or overlays)
    if (e.target === containerRef.current) {
      handleFullExit();
    }
  }, [handleFullExit]);

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
        aria-label="Exit review mode"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>

      <div
        className="line-review-image-container"
        style={{
          maxWidth: imageNaturalSize.width > 0 ? imageNaturalSize.width : undefined,
          transform: fitHeight && fitZoom !== 1
            ? `scale(${fitZoom}) translate(${fitPan.x / fitZoom}px, ${fitPan.y / fitZoom}px)`
            : undefined,
          transformOrigin: 'center center',
          cursor: fitHeight && fitZoom > 1 ? (isPanning ? 'grabbing' : 'grab') : undefined,
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
        {overlayEnabled && currentLine && imgW > 0 && !segmentEditor.segmentEditMode && (
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
                <polygon points={highlightPoints} fill="black" filter="url(#lr-feather)" />
                <polygon points={highlightPoints} fill="black" />
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
        {overlayEnabled && currentLine && !segmentEditor.segmentEditMode && (() => {
          const lineIdx = currentLine.transcriptLineIndex;
          const currentAreaId = specialAreaInfo && lineIdx >= 0 && lineIdx < specialAreaInfo.lineAreaIds.length
            ? specialAreaInfo.lineAreaIds[lineIdx]
            : null;
          const currentArea = currentAreaId != null ? specialAreaInfo?.areaMap.get(currentAreaId) : null;
          const areaBorder = currentArea
            ? `3px solid ${currentArea.type === 'continuation' ? 'rgb(217, 119, 6)' : 'rgb(59, 130, 246)'}`
            : undefined;

          return (
          <div
            className="line-review-input-overlay"
            style={{
              top: inputTop,
              left: inputLeft,
              width: inputWidth,
              height: INPUT_DISPLAY_HEIGHT,
              borderLeft: areaBorder,
            }}
          >
            <div
              ref={inputRef}
              contentEditable
              suppressContentEditableWarning
              className="line-review-editable"
              style={{ fontSize }}
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

        {/* Debug overlay — Grouped line boundaries (orange) */}
        {debugLines && showGroupedLines && imageDisplaySize.width > 0 && pipelineResult && (
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
            {pipelineResult.groupedLines
              .filter((gl) => gl.merged)
              .flatMap((gl, i) =>
                gl.constituents.map((seg, si) => {
                  const cls = gl.region === 'margin' ? 'line-review-debug-margin' : 'line-review-debug-merged';
                  return seg.boundary && seg.boundary.length > 2 ? (
                    <polygon
                      key={`grouped-poly-${i}-${si}`}
                      className={cls}
                      points={seg.boundary
                        .map(p => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                        .join(' ')}
                    />
                  ) : (
                    <rect
                      key={`grouped-rect-${i}-${si}`}
                      className={cls}
                      x={seg.bbox[0] * scaleFactor}
                      y={seg.bbox[1] * scaleFactor}
                      width={(seg.bbox[2] - seg.bbox[0]) * scaleFactor}
                      height={(seg.bbox[3] - seg.bbox[1]) * scaleFactor}
                    />
                  );
                }),
              )}
            {/* Merge connectors are drawn in the edge-points overlay below */}
          </svg>
        )}

        {/* Debug overlay — Matched/unified transcript lines (gold) */}
        {debugLines && showUnifiedLines && imageDisplaySize.width > 0 && pipelineResult && (
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
            {pipelineResult.matchResult.matched
              .filter((m): m is MatchedLine & { bbox: [number, number, number, number] } => m.bbox !== null)
              .map((m, i) =>
                m.boundary && m.boundary.length > 2 ? (
                  <polygon
                    key={`unified-poly-${i}`}
                    className="line-review-debug-unified"
                    points={m.boundary
                      .map(p => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                      .join(' ')}
                  />
                ) : (
                  <rect
                    key={`unified-rect-${i}`}
                    className="line-review-debug-unified"
                    x={m.bbox[0] * scaleFactor}
                    y={m.bbox[1] * scaleFactor}
                    width={(m.bbox[2] - m.bbox[0]) * scaleFactor}
                    height={(m.bbox[3] - m.bbox[1]) * scaleFactor}
                  />
                ),
              )}
          </svg>
        )}

        {/* Debug overlay — Excluded content (gray dashed) */}
        {debugLines && showExcludedContent && imageDisplaySize.width > 0 && pipelineResult && (
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
            {pipelineResult.matchResult.excludedContent.map((gl, i) => (
              <rect
                key={`excluded-${i}`}
                className="line-review-debug-excluded"
                x={gl.bbox[0] * scaleFactor}
                y={gl.bbox[1] * scaleFactor}
                width={(gl.bbox[2] - gl.bbox[0]) * scaleFactor}
                height={(gl.bbox[3] - gl.bbox[1]) * scaleFactor}
              />
            ))}
          </svg>
        )}

        {/* Debug overlay — Edge points (west=blue, east=red) and merge connectors */}
        {debugLines && showKrakenLines && imageDisplaySize.width > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: imageDisplaySize.width,
              height: displayedImageHeight,
              pointerEvents: 'none',
              zIndex: 8,
            }}
          >
            {(currentLetterPageIndex !== undefined ? krakenSegmentsMap[currentLetterPageIndex] ?? [] : []).map((seg, i) => {
              const west = westEdgeY(seg);
              const east = eastEdgeY(seg);
              const lx = seg.bbox[0] * scaleFactor;
              const rx = seg.bbox[2] * scaleFactor;
              return (
                <g key={`poles-${i}`}>
                  {/* West (left) edge: top + bottom points with connecting line */}
                  <circle className="line-review-pole-west" cx={lx} cy={west[0] * scaleFactor} r={3} />
                  <circle className="line-review-pole-west" cx={lx} cy={west[1] * scaleFactor} r={3} />
                  <line className="line-review-edge-west" x1={lx} y1={west[0] * scaleFactor} x2={lx} y2={west[1] * scaleFactor} />
                  {/* East (right) edge: top + bottom points with connecting line */}
                  <circle className="line-review-pole-east" cx={rx} cy={east[0] * scaleFactor} r={3} />
                  <circle className="line-review-pole-east" cx={rx} cy={east[1] * scaleFactor} r={3} />
                  <line className="line-review-edge-east" x1={rx} y1={east[0] * scaleFactor} x2={rx} y2={east[1] * scaleFactor} />
                </g>
              );
            })}
            {/* Merge connectors: top-right→top-left, bottom-right→bottom-left */}
            {pipelineResult?.groupedLines
              .filter((gl) => gl.merged && gl.constituents.length > 1)
              .map((gl, gi) =>
                gl.constituents.slice(0, -1).map((seg, si) => {
                  const next = gl.constituents[si + 1];
                  const segEast = eastEdgeY(seg);
                  const nextWest = westEdgeY(next);
                  const rx = seg.bbox[2] * scaleFactor;
                  const lx = next.bbox[0] * scaleFactor;
                  return (
                    <g key={`conn-${gi}-${si}`}>
                      <line className="line-review-debug-connector"
                        x1={rx} y1={segEast[0] * scaleFactor}
                        x2={lx} y2={nextWest[0] * scaleFactor} />
                      <line className="line-review-debug-connector"
                        x1={rx} y1={segEast[1] * scaleFactor}
                        x2={lx} y2={nextWest[1] * scaleFactor} />
                    </g>
                  );
                }),
              )}
          </svg>
        )}

        {/* Segment editor overlay — interactive segment editing */}
        {segmentEditor.segmentEditMode && imageDisplaySize.width > 0 && (
          <SegmentEditorOverlay
            segments={segmentEditor.editedSegments}
            selectedSegmentId={segmentEditor.selectedSegmentId}
            scaleFactor={scaleFactor}
            imageWidth={imageDisplaySize.width}
            imageHeight={displayedImageHeight}
            onSelect={segmentEditor.selectSegment}
            onResize={segmentEditor.resizeSegment}
            onDelete={segmentEditor.deleteSegment}
            onToggleExcluded={segmentEditor.toggleExcluded}
            onAddSegment={segmentEditor.addSegment}
          />
        )}

        {/* Special area overlays — colored bounding regions for continuation/addition areas */}
        {specialAreaInfo && alignedLines.length > 0 && imgW > 0 && !segmentEditor.segmentEditMode && (() => {
          // Group aligned lines by areaId to compute bounding boxes per area
          const areaBounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
          for (const line of alignedLines) {
            const idx = line.transcriptLineIndex;
            if (idx < 0 || idx >= specialAreaInfo.lineAreaIds.length) continue;
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

        {/* Loading segments */}
        {isLoading && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            <div className="line-review-spinner" />
            <div className="detection-status">Loading line segments...</div>
          </div>
        )}

        {/* No segments available */}
        {!isLoading && hasTranscriptLinesOnPage && alignedLines.length === 0 && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            No line segments for this page.
            <br />
            <small>Run <code>npm run detect-lines</code> locally, then press <kbd>Ctrl+Shift+R</kbd> to reload.</small>
          </div>
        )}
      </div>

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
            className={`debug-legend-toggle${showGroupedLines ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowGroupedLines(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-merged" />
            Grouped Lines
          </button>
          <button
            className={`debug-legend-toggle${showUnifiedLines ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowUnifiedLines(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-unified" />
            Matched Lines
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
            disabled={currentPageIndex === 0}
            aria-label="Previous page"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 4L6 10L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className="line-review-page-nav line-review-page-nav-right"
            onClick={goToNextPage}
            disabled={currentPageIndex === allPages.length - 1}
            aria-label="Next page"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8 4L14 10L8 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </>
      )}

      {/* Segment editor mini-toolbar — shown only in edit mode */}
      {segmentEditor.segmentEditMode && (
        <div className="segment-editor-toolbar">
          <button
            className="segment-editor-toolbar-btn primary"
            onClick={handleExitSegmentEditMode}
          >
            Done
          </button>
          <button
            className="segment-editor-toolbar-btn"
            onClick={() => segmentEditor.undo()}
            disabled={!segmentEditor.canUndo}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            className="segment-editor-toolbar-btn danger"
            onClick={() => {
              segmentEditor.resetFromSource(currentKrakenSegments);
            }}
            disabled={!segmentEditor.isDirty}
          >
            Discard
          </button>
          {segmentEditor.isDirty && (
            <span className="segment-editor-dirty-indicator">unsaved</span>
          )}
        </div>
      )}

      {/* Bottom toolbar — overlay + fit-height toggles */}
      <div className="line-review-toolbar">
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
        <button
          className={`line-review-toolbar-btn${fitHeight ? ' active' : ''}`}
          onClick={() => { setFitHeight(v => !v); setFitZoom(1); setFitPan({ x: 0, y: 0 }); }}
          title={fitHeight ? 'Scroll mode' : 'Fit to height'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 2H12M4 14H12M8 4V12M6 4L8 2L10 4M6 12L8 14L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Fit Height
        </button>
        {fitHeight && fitZoom !== 1 && (
          <>
            <span className="line-review-toolbar-divider" />
            <span className="line-review-toolbar-zoom">{Math.round(fitZoom * 100)}%</span>
          </>
        )}
        <span className="line-review-toolbar-divider" />
        <button
          className={`line-review-toolbar-btn${segmentEditor.segmentEditMode ? ' active' : ''}`}
          onClick={() => {
            if (segmentEditor.segmentEditMode) {
              handleExitSegmentEditMode();
            } else {
              segmentEditor.setSegmentEditMode(true);
            }
          }}
          title={segmentEditor.segmentEditMode ? 'Exit segment editor' : 'Edit segments'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M9.5 3.5l3 3" stroke="currentColor" strokeWidth="1.5"/>
          </svg>
          Segments
        </button>
      </div>

      {/* Exit hint */}
      <div className="line-review-exit-hint">
        <kbd>Esc</kbd> or click outside to exit
      </div>
    </div>
  );
});

export default LineReviewMode;
