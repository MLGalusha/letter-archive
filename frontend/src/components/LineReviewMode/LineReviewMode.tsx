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
import { detectPageLines } from '../../api/admin/letters';
import type { Letter, LineSegment, LineSegmentWord, OcrWordBox } from '../../types/Letter';
import { attachWordsToSegments } from '../../utils/attachWordsToSegments';
import { constrainedGrouping, eastEdgeY, westEdgeY } from '../../utils/constrainedGrouping';
import { matchTranscriptToLines, type MatchedLine } from '../../utils/transcriptMatcher';
import {
  alignTranscriptToVisualLines,
  buildAlignedLinesFromDetected,
  buildAlignedLinesFromEstimatedLayout,
  detectImageLines,
  type AlignmentInput,
  type AlignedLine,
} from '../../utils/lineAlignment';
import { useToast } from '../../contexts/ToastContext';
import { highlightTranscriptMarkers } from '../../utils/transcriptHighlight';
import {
  CSS_BORDER_PADDING,
  FONT_FAMILY,
  computeLineInputHeight,
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
  redetectLines: () => void;
  isDetecting: boolean;
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
 * Computes a representative font size for the page (used for input overlay height).
 * Compares OCR line widths to rendered text widths at a reference size.
 */
function computePageFontSize(
  alignedLines: AlignedLine[],
  scaleFactor: number,
): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 14;

  const REF_SIZE = 16;
  ctx.font = `${REF_SIZE}px ${FONT_FAMILY}`;

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
    totalRenderedWidth += ctx.measureText(text).width;
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

  const fontSize = Math.max(8, Math.min(36, REF_SIZE * targetWidth / refWidth));

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

/**
 * Find the Vision word that best represents a Kraken segment at a merge
 * junction. Uses the word's connecting-side edge to measure both:
 *   - vertical coverage: how much of the segment's height the word spans
 *   - proximity: how close the word's edge is to the segment's edge
 *
 * @param side 'right' = merge at segment's right edge (use word's right edge)
 *             'left'  = merge at segment's left edge (use word's left edge)
 */
function findLargestEdgeWord(
  segBbox: [number, number, number, number],
  side: 'left' | 'right',
  segmentWords: OcrWordBox[],
  allWords: OcrWordBox[],
): OcrWordBox | null {
  const segH = segBbox[3] - segBbox[1];
  const edgeX = side === 'right' ? segBbox[2] : segBbox[0];

  function pickBest(words: OcrWordBox[]): OcrWordBox | null {
    let best: OcrWordBox | null = null;
    let bestScore = -Infinity;

    for (const w of words) {
      // Must overlap vertically with the segment
      const vTop = Math.max(w.bbox[1], segBbox[1]);
      const vBot = Math.min(w.bbox[3], segBbox[3]);
      if (vBot <= vTop) continue;

      // Must overlap horizontally with the segment
      if (w.bbox[2] <= segBbox[0] || w.bbox[0] >= segBbox[2]) continue;

      // Vertical coverage: how much of the segment's height this word spans (0–1)
      const vCoverage = (vBot - vTop) / Math.max(segH, 1);

      // Proximity: how close the word's connecting edge is to the
      // segment's connecting edge. Uses sharp decay (normalized by
      // segment height) so near-perfect alignment gets a huge boost.
      const wordEdge = side === 'left' ? w.bbox[0] : w.bbox[2];
      const edgeDist = Math.abs(wordEdge - edgeX);
      const proximity = 1 / (1 + edgeDist / Math.max(segH * 0.5, 1));

      // Combined: proximity weighted 2× — a word whose edge nearly
      // aligns with the segment edge wins even if it's shorter.
      const score = vCoverage + proximity * 2;
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }

    return best;
  }

  // Prefer assigned words, fallback to global pool
  return pickBest(segmentWords) ?? pickBest(allWords);
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
  const [showVisionWords, setShowVisionWords] = useState(false);
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

  // Vision word boxes per page (cached across page switches)
  // undefined = not attempted, null = in progress, OcrWordBox[] = done
  const [visionBoxesMap, setVisionBoxesMap] = useState<Record<number, OcrWordBox[] | null | undefined>>(() => {
    const initial: Record<number, OcrWordBox[] | null | undefined> = {};
    letterPages.forEach((page, index) => {
      if (Array.isArray(page.ocrWordBoxes)) {
        initial[index] = page.ocrWordBoxes;
      }
    });
    return initial;
  });

  // Detection progress steps (shown in loading overlay for current page)
  const [detectionSteps, setDetectionSteps] = useState<string[]>([]);

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
    const wordBoxes = letterPages[currentLetterPageIndex]?.ocrWordBoxes
      ?? visionBoxesMap[currentLetterPageIndex]
      ?? [];

    if (rawSegments.length === 0) return null;

    // Phase 2: Attach Vision words to Kraken segments
    const { enriched, unassigned } = attachWordsToSegments(rawSegments, wordBoxes);

    // Phase 3: Constrained grouping
    const { lines: groupedLines, marginalSegments, visionRejections } = constrainedGrouping(enriched);

    // Phase 4-5: Match transcript to grouped lines
    const transcriptLines = pageLineTexts[currentLetterPageIndex] ?? [];
    const matchResult = matchTranscriptToLines(transcriptLines, groupedLines, unassigned);

    return { enriched, unassigned, groupedLines, marginalSegments, matchResult, visionRejections };
  }, [krakenSegmentsMap, currentLetterPageIndex, letterPages, visionBoxesMap, pageLineTexts]);

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

  // Run line detection via backend API when a letter page loads.
  // Triggers when: (a) no segments cached at all, or (b) segments cached
  // from DB but Vision boxes haven't been fetched yet for this page.
  useEffect(() => {
    if (!currentPage || currentLetterPageIndex === undefined) return;

    const lpIdx = currentLetterPageIndex;
    const hasSegments = aiSegmentsMap[lpIdx] !== undefined;

    // Stored segment data is enough to render reliably without
    // forcing another backend call on first load.
    if (hasSegments) return;
    if (aiSegmentsMap[lpIdx] === null) return;

    const pageText = pageLineTexts[lpIdx]?.join('\n') || '';
    if (!pageText.trim()) return;

    // Mark as in progress
    setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: null }));
    setDetectionSteps([]);

    const pageId = currentPage.id;

    detectPageLines(pageId, (label) => {
      setDetectionSteps(prev => [...prev, label]);
    })
      .then(result => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: result.lineSegments }));
        setVisionBoxesMap(prev => ({ ...prev, [lpIdx]: result.ocrWordBoxes ?? [] }));
        setKrakenSegmentsMap(prev => ({ ...prev, [lpIdx]: result.lineSegments ?? [] }));
        setDetectionSteps([]);
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: [] }));
        showToast(getErrorMessage(err, 'Line detection failed'), 'error');
        setDetectionSteps([]);
      });
  }, [currentPage, currentLetterPageIndex, aiSegmentsMap, pageLineTexts, showToast]);


  // Background pre-fetch: after current letter page finishes detecting, start
  // detecting the next letter page that hasn't been fetched yet.
  useEffect(() => {
    // Only pre-fetch once current page is done (or current page is non-letter)
    if (currentLetterPageIndex !== undefined) {
      if (aiSegmentsMap[currentLetterPageIndex] === null || aiSegmentsMap[currentLetterPageIndex] === undefined) return;
    }

    // Find next letter page that needs detection
    for (let i = 0; i < letterPages.length; i++) {
      const idx = (((currentLetterPageIndex ?? -1) + 1 + i) % letterPages.length);

      const hasSegments = aiSegmentsMap[idx] !== undefined;
      const inProgress = aiSegmentsMap[idx] === null;

      if (inProgress || hasSegments) continue;

      const pageText = pageLineTexts[idx]?.join('\n') || '';
      if (!pageText.trim()) continue;

      // Start background detection for this page
      const page = letterPages[idx];
      setAiSegmentsMap(prev => ({ ...prev, [idx]: null }));

      detectPageLines(page.id)
        .then(result => {
          setAiSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments }));
          setVisionBoxesMap(prev => ({ ...prev, [idx]: result.ocrWordBoxes ?? [] }));
          setKrakenSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments ?? [] }));
        })
        .catch(() => {
          setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        });

      // Only start one at a time to avoid overloading the backend
      break;
    }
  }, [aiSegmentsMap, visionBoxesMap, currentLetterPageIndex, letterPages, pageLineTexts]);

  // Whether we're still waiting for AI detection for the current letter page
  const isDetecting = currentLetterPageIndex !== undefined && aiSegmentsMap[currentLetterPageIndex] === null;
  const imageReady = imageNaturalSize.width > 0;
  const onLetterPage = currentLetterPageIndex !== undefined;

  // Compute aligned lines for current page (empty for non-letter pages)
  const alignedLines: AlignedLine[] = useMemo(() => {
    if (!currentPage || !onLetterPage || currentLetterPageIndex === undefined) return [];
    if (isDetecting) return []; // AI detection in progress — show spinner, no lines yet
    const transcriptLines = pageLineTexts[currentLetterPageIndex] ?? [];
    const pageText = transcriptLines.join('\n');

    const aiResult = aiSegmentsMap[currentLetterPageIndex];
    if (aiResult && aiResult.length > 0) {
      const lines = alignTranscriptToVisualLines(pageText, aiResult);
      return lines.filter(l => l.transcriptLineIndex >= 0);
    }

    if (!imageReady || !imageRef.current) return [];

    const detectedLines = detectImageLines(imageRef.current);
    if (detectedLines.length === 0) {
      return buildAlignedLinesFromEstimatedLayout(transcriptLines, imageNaturalSize);
    }
    return buildAlignedLinesFromDetected(transcriptLines, detectedLines);
  }, [currentPage, currentLetterPageIndex, onLetterPage, pageLineTexts, aiSegmentsMap, isDetecting, imageReady]);
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
    setCurrentPageIndex(currentPageIndex + 1);
    setCurrentLineIndex(0);
    containerRef.current?.scrollTo({ top: 0 });
  }, [currentPageIndex, allPages.length, saveCurrentLine]);

  // Navigate to previous page (any type)
  const goToPrevPage = useCallback(() => {
    if (currentPageIndex <= 0) return;
    saveCurrentLine();
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
    const lineInputH = computeLineInputHeight(currentLine.words, scaleFactor, pageFontSize);
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

    buildWordPositionedContent(
      inputRef.current,
      line.transcriptText,
      line.words,
      contentAreaLeft,
      scaleFactor,
      line.bbox,
    );

    inputRef.current.focus();
    const sel = window.getSelection();
    if (sel && inputRef.current.firstChild) {
      sel.collapse(inputRef.current.firstChild, 0);
    }
  }, [currentLineIndex, currentPageIndex, alignedLines, scaleFactor, imageNaturalSize.width]);

  // Re-run line detection for the current page (Kraken + Vision in parallel)
  const redetectLines = useCallback(() => {
    if (!currentPage || isDetecting || currentLetterPageIndex === undefined) return;

    const pageId = currentPage.id;
    const lpIdx = currentLetterPageIndex;

    // Immediately show spinner and clear stale data
    setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: null }));
    setVisionBoxesMap(prev => ({ ...prev, [lpIdx]: undefined }));
    setKrakenSegmentsMap(prev => ({ ...prev, [lpIdx]: undefined }));
    setCurrentLineIndex(0);
    setDetectionSteps([]);

    detectPageLines(pageId, (label) => {
      setDetectionSteps(prev => [...prev, label]);
    })
      .then(result => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: result.lineSegments }));
        setVisionBoxesMap(prev => ({ ...prev, [lpIdx]: result.ocrWordBoxes ?? [] }));
        setKrakenSegmentsMap(prev => ({ ...prev, [lpIdx]: result.lineSegments ?? [] }));
        setDetectionSteps([]);
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [lpIdx]: [] }));
        showToast(getErrorMessage(err, 'Line detection failed'), 'error');
        setDetectionSteps([]);
      });
  }, [currentPage, currentLetterPageIndex, isDetecting, showToast]);

  useImperativeHandle(ref, () => ({
    saveCurrentLine,
    redetectLines,
    isDetecting,
  }), [saveCurrentLine, redetectLines, isDetecting]);

  // Keyboard handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        redetectLines();
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
  }, [saveCurrentLine, onExit, goToNextLine, goToPrevLine, goToNextPage, goToPrevPage, onLetterPage, overlayEnabled, redetectLines, debugLines, onDebugModeChange]);

  if (!currentPage) return null;

  // Dynamic height for the editable strip — based on current line's word heights and font size
  const INPUT_DISPLAY_HEIGHT = computeLineInputHeight(currentLine?.words, scaleFactor, pageFontSize);

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

  // Use the page-global font size for the editable div
  const fontSize = pageFontSize;

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

  // Flat list of ALL Vision words for fallback junction rendering
  const allVisionWords = useMemo(() => {
    if (!pipelineResult) return [];
    return [
      ...pipelineResult.enriched.flatMap((s) => s.visionWords),
      ...(pipelineResult.unassigned ?? []),
    ];
  }, [pipelineResult]);

  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only exit when clicking directly on the dark background (not the image or overlays)
    if (e.target === containerRef.current) {
      saveCurrentLine();
      onExit();
    }
  }, [saveCurrentLine, onExit]);

  return (
    <div
      className={`line-review-mode${fitHeight ? ' line-review-fit-height' : ''}`}
      ref={containerRef}
      onClick={handleContainerClick}
    >
      {/* Close button */}
      <button
        className="line-review-close-btn"
        onClick={() => { saveCurrentLine(); onExit(); }}
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
        {overlayEnabled && currentLine && imgW > 0 && (
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
        {overlayEnabled && currentLine && (
          <div
            className="line-review-input-overlay"
            style={{
              top: inputTop,
              left: inputLeft,
              width: inputWidth,
              height: INPUT_DISPLAY_HEIGHT,
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
        )}

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

        {/* Debug overlay — Vision word bounding boxes */}
        {debugLines && showVisionWords && imageDisplaySize.width > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: imageDisplaySize.width,
              height: displayedImageHeight,
              pointerEvents: 'none',
              zIndex: 6,
            }}
          >
            {(currentLetterPageIndex !== undefined ? visionBoxesMap[currentLetterPageIndex] ?? [] : []).map((box, i) => (
              <rect
                key={`vision-${i}`}
                className={box.hasContent === false
                  ? 'line-review-debug-vision-empty'
                  : 'line-review-debug-vision-word'}
                x={box.bbox[0] * scaleFactor}
                y={box.bbox[1] * scaleFactor}
                width={(box.bbox[2] - box.bbox[0]) * scaleFactor}
                height={(box.bbox[3] - box.bbox[1]) * scaleFactor}
              />
            ))}
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
            {/* Vision junction debug: show the Vision word boxes being compared
                at each merge junction. Each Kraken segment maps to a Vision word:
                assigned word if available, otherwise nearest word from global pool.
                Spanning words that bridge the gap show as a single box. */}
            {pipelineResult?.groupedLines
              .filter((gl) => gl.merged && gl.constituents.length > 1)
              .flatMap((gl, gi) =>
                gl.constituents.slice(0, -1).map((seg, si) => {
                  const next = gl.constituents[si + 1];
                  const s = scaleFactor;

                  // Check for a spanning word that bridges the gap
                  const gapStart = seg.bbox[2];
                  const gapEnd = next.bbox[0];
                  const juncWords = [...seg.visionWords, ...next.visionWords];
                  const spanWord = juncWords.find(
                    (w) => w.bbox[0] <= gapStart && w.bbox[2] >= gapEnd,
                  );
                  if (spanWord) {
                    return (
                      <g key={`vjunc-${gi}-${si}`}>
                        <rect
                          className="line-review-debug-vision-junction"
                          x={spanWord.bbox[0] * s}
                          y={spanWord.bbox[1] * s}
                          width={(spanWord.bbox[2] - spanWord.bbox[0]) * s}
                          height={(spanWord.bbox[3] - spanWord.bbox[1]) * s}
                        />
                      </g>
                    );
                  }

                  // Each Kraken segment picks the largest Vision word on its merge side
                  const leftWord = findLargestEdgeWord(seg.bbox, 'right', seg.visionWords, allVisionWords);
                  const rightWord = findLargestEdgeWord(next.bbox, 'left', next.visionWords, allVisionWords);
                  if (!leftWord && !rightWord) return null;

                  return (
                    <g key={`vjunc-${gi}-${si}`}>
                      {leftWord && (
                        <rect
                          className="line-review-debug-vision-junction"
                          x={leftWord.bbox[0] * s}
                          y={leftWord.bbox[1] * s}
                          width={(leftWord.bbox[2] - leftWord.bbox[0]) * s}
                          height={(leftWord.bbox[3] - leftWord.bbox[1]) * s}
                        />
                      )}
                      {rightWord && (
                        <rect
                          className="line-review-debug-vision-junction"
                          x={rightWord.bbox[0] * s}
                          y={rightWord.bbox[1] * s}
                          width={(rightWord.bbox[2] - rightWord.bbox[0]) * s}
                          height={(rightWord.bbox[3] - rightWord.bbox[1]) * s}
                        />
                      )}
                      {/* Connecting lines top-top and bottom-bottom */}
                      {leftWord && rightWord && (
                        <>
                          <line className="line-review-debug-vision-connector"
                            x1={leftWord.bbox[2] * s} y1={leftWord.bbox[1] * s}
                            x2={rightWord.bbox[0] * s} y2={rightWord.bbox[1] * s} />
                          <line className="line-review-debug-vision-connector"
                            x1={leftWord.bbox[2] * s} y1={leftWord.bbox[3] * s}
                            x2={rightWord.bbox[0] * s} y2={rightWord.bbox[3] * s} />
                        </>
                      )}
                    </g>
                  );
                }).filter(Boolean),
              )}
            {/* Vision-rejected merges: Kraken wanted these but Vision said no.
                Show with red boxes + red connectors so you can see what was rejected.
                Each Kraken segment maps to a Vision word (assigned or nearest fallback). */}
            {(pipelineResult?.visionRejections ?? []).map((rej, ri) => {
              const s = scaleFactor;
              // Each Kraken segment picks the largest Vision word on its merge side
              const leftWord = findLargestEdgeWord(rej.left.bbox, 'right', rej.left.visionWords, allVisionWords);
              const rightWord = findLargestEdgeWord(rej.right.bbox, 'left', rej.right.visionWords, allVisionWords);
              // Kraken edge coords for orange connectors
              const segEast = eastEdgeY(rej.left);
              const nextWest = westEdgeY(rej.right);
              const rx = rej.left.bbox[2] * s;
              const lx = rej.right.bbox[0] * s;

              return (
                <g key={`vrej-${ri}`}>
                  {/* Kraken's intended merge (orange dashed) */}
                  <line className="line-review-debug-connector"
                    x1={rx} y1={segEast[0] * s}
                    x2={lx} y2={nextWest[0] * s} />
                  <line className="line-review-debug-connector"
                    x1={rx} y1={segEast[1] * s}
                    x2={lx} y2={nextWest[1] * s} />
                  {/* Vision boxes for each Kraken segment */}
                  {leftWord && (
                    <rect className="line-review-debug-vision-rejected"
                      x={leftWord.bbox[0] * s} y={leftWord.bbox[1] * s}
                      width={(leftWord.bbox[2] - leftWord.bbox[0]) * s}
                      height={(leftWord.bbox[3] - leftWord.bbox[1]) * s} />
                  )}
                  {rightWord && (
                    <rect className="line-review-debug-vision-rejected"
                      x={rightWord.bbox[0] * s} y={rightWord.bbox[1] * s}
                      width={(rightWord.bbox[2] - rightWord.bbox[0]) * s}
                      height={(rightWord.bbox[3] - rightWord.bbox[1]) * s} />
                  )}
                  {/* Red connectors showing Vision mismatch */}
                  {leftWord && rightWord && (
                    <>
                      <line className="line-review-debug-vision-rejected-connector"
                        x1={leftWord.bbox[2] * s} y1={leftWord.bbox[1] * s}
                        x2={rightWord.bbox[0] * s} y2={rightWord.bbox[1] * s} />
                      <line className="line-review-debug-vision-rejected-connector"
                        x1={leftWord.bbox[2] * s} y1={leftWord.bbox[3] * s}
                        x2={rightWord.bbox[0] * s} y2={rightWord.bbox[3] * s} />
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Detecting lines — detection in progress */}
        {isDetecting && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            <div className="line-review-spinner" />
            <div className="detection-status" key={detectionSteps.length}>
              {detectionSteps.length === 0
                ? 'Starting detection...'
                : detectionSteps[detectionSteps.length - 1]}
            </div>
          </div>
        )}

        {/* Not available — all detection methods exhausted */}
        {!isDetecting && hasTranscriptLinesOnPage && alignedLines.length === 0 && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            Could not detect line positions for this page.
            <br />
            <small>Press <kbd>Esc</kbd> to return to the editor.</small>
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
            className={`debug-legend-toggle${showVisionWords ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowVisionWords(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-vision" />
            Vision Words
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
      </div>

      {/* Exit hint */}
      <div className="line-review-exit-hint">
        <kbd>Esc</kbd> or click outside to exit
      </div>
    </div>
  );
});

export default LineReviewMode;
