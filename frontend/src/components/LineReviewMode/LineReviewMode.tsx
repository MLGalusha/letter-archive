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
import { detectPageLines, submitLineCorrection } from '../../api/admin/letters';
import type { LineCorrectionPayload } from '../../api/admin/letters';
import type { Letter, LineSegmentWord, OcrWordBox, ReconciledLine } from '../../types/Letter';
import {
  alignTranscriptToVisualLines,
  buildAlignedLinesFromDetected,
  buildAlignedLinesFromEstimatedLayout,
  detectImageLines,
  type AlignmentInput,
  type AlignedLine,
} from '../../utils/lineAlignment';
import { useToast } from '../../contexts/ToastContext';
import './LineReviewMode.css';

interface LineReviewModeProps {
  letter: Letter;
  transcript: string;
  onTranscriptChange: (newFullTranscript: string) => void;
  onExit: () => void;
  onAutoSave: (data: { transcriptionText: string }) => void;
  debugMode?: boolean;
  onDebugModeChange?: (debugMode: boolean) => void;
}

export interface LineReviewModeHandle {
  saveCurrentLine: () => void;
  redetectLines: () => void;
  isDetecting: boolean;
}

const PAGE_SEPARATOR_REGEX = /\n*---\s*Page\s*\d+\s*---\n*/i;

/**
 * Splits the full transcript into per-page text arrays.
 */
function splitTranscriptByPage(fullText: string, pageCount: number): string[] {
  if (pageCount <= 1) return [fullText];
  const parts = fullText.split(PAGE_SEPARATOR_REGEX);
  // parts[0] is before first separator (empty), actual pages start at index 1
  const pages: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    pages.push(parts[i] || '');
  }
  // Pad if needed
  while (pages.length < pageCount) {
    pages.push('');
  }
  return pages;
}

/**
 * Reconstructs full transcript from per-page raw text strings.
 */
function reconstructTranscript(pageTexts: string[]): string {
  if (pageTexts.length === 1) {
    return pageTexts[0];
  }
  return pageTexts
    .map((text, i) => `--- Page ${i + 1} ---\n\n${text}`)
    .join('\n\n');
}

const FONT_FAMILY = "Georgia, 'Times New Roman', serif";
const CSS_BORDER_PADDING = 6; // border (2px) + padding (4px) on each side

/**
 * Computes the input overlay height for a line based on the average height
 * of its OCR word bounding boxes. Falls back to a reasonable default when
 * no OCR words are available.
 */
function computeLineInputHeight(
  words: LineSegmentWord[] | undefined,
  scaleFactor: number,
): number {
  if (!words || words.length === 0) return 30;

  let totalHeight = 0;
  for (const w of words) {
    totalHeight += (w.bbox[3] - w.bbox[1]);
  }
  const avgWordHeight = totalHeight / words.length;
  // Scale to display coordinates and add padding for border + padding on both sides
  const scaled = avgWordHeight * scaleFactor + CSS_BORDER_PADDING * 2;
  // Clamp to reasonable bounds
  return Math.max(20, Math.min(60, scaled));
}

function measureRenderedTextWidth(
  text: string,
  fontSize: number,
  wordSpacing = 0,
): number {
  const measureNode = document.createElement('span');
  measureNode.textContent = text;
  measureNode.style.position = 'absolute';
  measureNode.style.left = '-99999px';
  measureNode.style.top = '0';
  measureNode.style.visibility = 'hidden';
  measureNode.style.whiteSpace = 'pre';
  measureNode.style.margin = '0';
  measureNode.style.padding = '0';
  measureNode.style.border = '0';
  measureNode.style.lineHeight = '1';
  measureNode.style.fontFamily = FONT_FAMILY;
  measureNode.style.fontSize = `${fontSize}px`;
  measureNode.style.wordSpacing = `${wordSpacing}px`;
  measureNode.style.fontKerning = 'none';
  measureNode.style.fontVariantLigatures = 'none';

  document.body.appendChild(measureNode);
  const width = measureNode.getBoundingClientRect().width;
  measureNode.remove();

  return width;
}

function normalizeReviewLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function mergeEditedTextWithOriginalSpacing(
  originalText: string,
  normalizedEditedText: string,
): string {
  if (!normalizedEditedText) return '';

  const leadingWhitespace = originalText.match(/^\s*/)?.[0] ?? '';
  const trailingWhitespace = originalText.match(/\s*$/)?.[0] ?? '';
  const trimmedOriginal = originalText.trim();

  if (!trimmedOriginal) {
    return normalizedEditedText;
  }

  const originalTokens = trimmedOriginal.split(/\s+/).filter(Boolean);
  const newTokens = normalizedEditedText.split(' ').filter(Boolean);

  if (originalTokens.length === newTokens.length && newTokens.length > 0) {
    const chunks = trimmedOriginal.match(/\S+|\s+/g) ?? [];
    let tokenIndex = 0;

    const rebuilt = chunks
      .map((chunk) => {
        if (/^\s+$/.test(chunk)) {
          return chunk;
        }
        const replacement = newTokens[tokenIndex];
        tokenIndex += 1;
        return replacement ?? chunk;
      })
      .join('');

    if (tokenIndex === newTokens.length) {
      return `${leadingWhitespace}${rebuilt}${trailingWhitespace}`;
    }
  }

  return `${leadingWhitespace}${newTokens.join(' ')}${trailingWhitespace}`;
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
): void {
  div.innerHTML = '';
  div.style.fontSize = '';
  div.style.wordSpacing = '';
  div.style.textIndent = '';

  if (!text) return;

  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return;
  const joined = words.join(' ');

  // No OCR data — plain text, inherit page font size from style prop
  if (!ocrWords || ocrWords.length === 0) {
    div.textContent = joined;
    return;
  }

  // Line text bounds from OCR word bboxes
  const lineLeftX = Math.min(...ocrWords.map(w => w.bbox[0]));
  const lineRightX = Math.max(...ocrWords.map(w => w.bbox[2]));
  const lineLeftDisplay = lineLeftX * scaleFactor;
  const lineRightDisplay = lineRightX * scaleFactor;
  const targetWidth = lineRightDisplay - lineLeftDisplay;

  if (targetWidth <= 0) {
    div.textContent = joined;
    return;
  }

  // Left offset: where the text should start inside the content area
  const leftOffset = lineLeftDisplay - contentAreaLeftDisplay;

  const REF_SIZE = 16;
  const refWidth = measureRenderedTextWidth(joined, REF_SIZE);
  if (refWidth <= 0) { div.textContent = joined; return; }

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

  div.textContent = joined;
}

const LineReviewMode = forwardRef<LineReviewModeHandle, LineReviewModeProps>(function LineReviewMode({
  letter,
  transcript,
  onTranscriptChange,
  onExit,
  onAutoSave,
  debugMode: debugLines = false,
  onDebugModeChange,
}: LineReviewModeProps, ref) {
  const { showToast } = useToast();
  // Filter to letter-type pages only
  const letterPages = useMemo(
    () => letter.images.filter((img) => img.type === 'letter'),
    [letter.images],
  );

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 });

  // AI-detected line segments per page (cached across page switches)
  // undefined = not attempted, null = in progress, LineSegment[] = done
  const [aiSegmentsMap, setAiSegmentsMap] = useState<Record<number, AlignmentInput[] | null | undefined>>(() => {
    const initial: Record<number, AlignmentInput[] | null | undefined> = {};
    letterPages.forEach((page, index) => {
      if (Array.isArray(page.reconciledLines) && page.reconciledLines.length > 0) {
        initial[index] = page.reconciledLines;
      } else if (Array.isArray(page.lineSegments)) {
        initial[index] = page.lineSegments;
      }
    });
    return initial;
  });

  // Debug overlay layer toggles
  const [showKrakenLines, setShowKrakenLines] = useState(true);
  const [showVisionWords, setShowVisionWords] = useState(false);
  const [showReconciledLines, setShowReconciledLines] = useState(true);
  const [showMergeCandidates, setShowMergeCandidates] = useState(false);
  const [showPhantomSuspects, setShowPhantomSuspects] = useState(false);
  const [showHppPeaks, setShowHppPeaks] = useState(false);

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

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const lastGlobalLineIndexRef = useRef<number | null>(null);

  const currentPage = letterPages[currentPageIndex];

  // Reset image sizes when switching pages so overlay doesn't render
  // at stale positions from the previous page's dimensions
  useEffect(() => {
    setImageNaturalSize({ width: 0, height: 0 });
    setImageDisplaySize({ width: 0, height: 0 });
  }, [currentPageIndex]);

  // Run line detection via backend API when a page loads.
  // Triggers when: (a) no segments cached at all, or (b) segments cached
  // from DB but Vision boxes haven't been fetched yet for this page.
  useEffect(() => {
    if (!currentPage) return;

    const hasSegments = aiSegmentsMap[currentPageIndex] !== undefined;

    // Stored reconciled/segment data is enough to render reliably without
    // forcing another backend call on first load.
    if (hasSegments) return;
    if (aiSegmentsMap[currentPageIndex] === null) return;

    const pageText = pageLineTexts[currentPageIndex]?.join('\n') || '';
    if (!pageText.trim()) return;

    // Mark as in progress
    setAiSegmentsMap(prev => ({ ...prev, [currentPageIndex]: null }));

    const pageId = currentPage.id;
    const idx = currentPageIndex;

    detectPageLines(pageId)
      .then(result => {
        const alignedSource = result.reconciledLines?.length
          ? result.reconciledLines
          : result.lineSegments;
        setAiSegmentsMap(prev => ({ ...prev, [idx]: alignedSource }));
        setVisionBoxesMap(prev => ({ ...prev, [idx]: result.ocrWordBoxes ?? [] }));
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        showToast(getErrorMessage(err, 'Line detection failed'), 'error');
      });
  }, [currentPage, currentPageIndex, aiSegmentsMap, pageLineTexts, showToast]);


  // Background pre-fetch: after current page finishes detecting, start
  // detecting the next page that hasn't been fetched yet.
  useEffect(() => {
    // Only pre-fetch once current page is done
    if (aiSegmentsMap[currentPageIndex] === null || aiSegmentsMap[currentPageIndex] === undefined) return;

    // Find next page that needs detection
    for (let i = 0; i < letterPages.length; i++) {
      // Prioritize pages after current, then wrap around
      const idx = (currentPageIndex + 1 + i) % letterPages.length;
      if (idx === currentPageIndex) continue;

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
          const alignedSource = result.reconciledLines?.length
            ? result.reconciledLines
            : result.lineSegments;
          setAiSegmentsMap(prev => ({ ...prev, [idx]: alignedSource }));
          setVisionBoxesMap(prev => ({ ...prev, [idx]: result.ocrWordBoxes ?? [] }));
        })
        .catch(() => {
          setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        });

      // Only start one at a time to avoid overloading the backend
      break;
    }
  }, [aiSegmentsMap, visionBoxesMap, currentPageIndex, letterPages, pageLineTexts]);

  // Whether we're still waiting for AI detection for the current page
  const isDetecting = aiSegmentsMap[currentPageIndex] === null;
  const imageReady = imageNaturalSize.width > 0;

  // Compute aligned lines for current page
  const alignedLines: AlignedLine[] = useMemo(() => {
    if (!currentPage) return [];
    if (isDetecting) return []; // AI detection in progress — show spinner, no lines yet
    const transcriptLines = pageLineTexts[currentPageIndex] ?? [];
    const pageText = transcriptLines.join('\n');

    const aiResult = aiSegmentsMap[currentPageIndex];
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
  }, [currentPage, currentPageIndex, pageLineTexts, aiSegmentsMap, isDetecting, imageReady]);
  const hasTranscriptLinesOnPage = (pageLineTexts[currentPageIndex]?.length ?? 0) > 0;

  // Only expose currentLine when the image for this page has loaded,
  // so overlays never render at positions scaled from a previous page's dimensions
  const currentLine = imageReady ? alignedLines[currentLineIndex] : undefined;
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
    [letterPages, pageLineTexts, aiSegmentsMap, currentPageIndex],
  );

  const totalLines = useMemo(
    () => pageLineCounts.reduce((sum, count) => sum + count, 0),
    [pageLineCounts],
  );

  const globalLineIndex = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < currentPageIndex; i++) {
      sum += pageLineCounts[i] || 0;
    }
    return sum + currentLineIndex + 1;
  }, [currentPageIndex, currentLineIndex, pageLineCounts]);

  // Scale factor: displayed size vs natural image size
  const scaleFactor = imageNaturalSize.width > 0
    ? imageDisplaySize.width / imageNaturalSize.width
    : 1;

  // Extract ReconciledLine[] from the aiSegmentsMap for debug overlays.
  // Items are ReconciledLine when the reconciliation pipeline ran (they have wasMerged).
  const reconciledLinesForPage = useMemo<ReconciledLine[]>(() => {
    const segs = aiSegmentsMap[currentPageIndex];
    if (!segs || segs.length === 0) return [];
    // Type guard: ReconciledLine has wasMerged, LineSegment does not
    if (!('wasMerged' in segs[0])) return [];
    return segs as ReconciledLine[];
  }, [aiSegmentsMap, currentPageIndex]);

  // Local mutable copy of reconciled lines for admin corrections
  const [reconciledLinesMap, setReconciledLinesMap] = useState<Record<number, ReconciledLine[] | null | undefined>>(() => {
    const initial: Record<number, ReconciledLine[] | null | undefined> = {};
    letterPages.forEach((page, index) => {
      if (Array.isArray(page.reconciledLines)) {
        initial[index] = page.reconciledLines;
      }
    });
    return initial;
  });

  // Keep reconciledLinesMap in sync when aiSegmentsMap updates (e.g. after detection)
  useEffect(() => {
    if (reconciledLinesForPage.length > 0) {
      setReconciledLinesMap(prev => {
        if (prev[currentPageIndex] !== undefined) return prev;
        return { ...prev, [currentPageIndex]: reconciledLinesForPage };
      });
    }
  }, [reconciledLinesForPage, currentPageIndex]);

  const currentReconciledLine = useMemo(() => {
    const lines = reconciledLinesMap[currentPageIndex] ?? reconciledLinesForPage;
    return lines[currentLineIndex];
  }, [reconciledLinesMap, currentPageIndex, reconciledLinesForPage, currentLineIndex]);

  // Drag-to-resize state
  const [resizing, setResizing] = useState<{
    side: 'left' | 'right';
    startX: number;
    startBbox: [number, number, number, number];
  } | null>(null);

  // Handle line corrections (delete, phantom confirm/reject, resize)
  const handleLineCorrection = useCallback(async (
    lineIndex: number,
    correctionType: LineCorrectionPayload['correctionType'],
    correctedBbox?: [number, number, number, number],
  ) => {
    const reconciledLines = reconciledLinesMap[currentPageIndex] ?? reconciledLinesForPage;
    if (!reconciledLines || !reconciledLines[lineIndex]) return;

    const line = reconciledLines[lineIndex];
    const page = letterPages[currentPageIndex];
    if (!page) return;

    const allStats = reconciledLines
      .filter(l => l.pixelStats)
      .map(l => l.pixelStats!);

    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    const payload: LineCorrectionPayload = {
      letterId: letter.id,
      collectionCode: letter.collectionCode,
      correctionType,
      algorithmOutput: {
        bbox: line.bbox,
        confidence: line.confidence,
        isPhantom: line.isPhantom,
        wasMerged: line.wasMerged,
        mergeGapPx: line.mergeGapPx,
        pixelStats: line.pixelStats ? Object.fromEntries(
          Object.entries(line.pixelStats).map(([k, v]) => [k, v])
        ) : undefined,
        hppOverlap: line.hppOverlap,
        visionWordCount: line.visionWordCount,
        transcriptMatchScore: line.transcriptMatchScore,
      },
      correctedBbox,
      correctedIsDeleted: correctionType === 'delete' || correctionType === 'confirm_phantom' ? true
        : correctionType === 'undelete' || correctionType === 'reject_phantom' ? false
        : undefined,
      sourceSegmentIds: line.sourceSegmentIds,
      pageContext: {
        medianRmsContrast: median(allStats.map(s => s.rmsContrast)),
        medianVariance: median(allStats.map(s => s.variance)),
        medianDensity: median(allStats.map(s => s.inkDensity)),
        medianMinValue: median(allStats.map(s => s.minValue)),
        totalSegments: reconciledLines.length,
        totalVisionBoxes: (visionBoxesMap[currentPageIndex] ?? []).length,
        imageWidth: imageNaturalSize.width,
        imageHeight: imageNaturalSize.height,
      },
    };

    try {
      const result = await submitLineCorrection(page.id, payload);
      setReconciledLinesMap(prev => ({
        ...prev,
        [currentPageIndex]: result.reconciledLines,
      }));
      setAiSegmentsMap(prev => ({
        ...prev,
        [currentPageIndex]: result.reconciledLines,
      }));
    } catch (err) {
      console.error('Failed to submit line correction:', err);
      showToast(getErrorMessage(err, 'Failed to save line correction'), 'error');
    }
  }, [
    reconciledLinesMap,
    reconciledLinesForPage,
    currentPageIndex,
    letterPages,
    letter,
    visionBoxesMap,
    imageNaturalSize,
    showToast,
  ]);

  // Start drag-to-resize on a handle
  const startResize = useCallback((e: React.MouseEvent, side: 'left' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentLine) return;
    setResizing({ side, startX: e.clientX, startBbox: [...currentLine.bbox] as [number, number, number, number] });
  }, [currentLine]);

  // Handle resize drag + mouseup
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (_e: MouseEvent) => {
      // Visual feedback handled by CSS cursor; bbox updates on mouseup only
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!resizing || !currentLine) {
        setResizing(null);
        return;
      }

      const deltaX = (e.clientX - resizing.startX) / scaleFactor;
      const newBbox = [...resizing.startBbox] as [number, number, number, number];

      if (resizing.side === 'left') {
        newBbox[0] = Math.max(0, resizing.startBbox[0] + deltaX);
      } else {
        newBbox[2] = Math.min(imageNaturalSize.width, resizing.startBbox[2] + deltaX);
      }

      if (Math.abs(deltaX) > 5) {
        handleLineCorrection(currentLineIndex, 'resize', newBbox);
      }

      setResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, currentLine, scaleFactor, imageNaturalSize.width, currentLineIndex, handleLineCorrection]);

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

  // Save current line text and trigger auto-save (only if user actually edited)
  const saveCurrentLine = useCallback(() => {
    if (!inputRef.current) return;
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

    const rawLineIndex = pageNonBlankMap[currentPageIndex]?.[transcriptIdx];
    if (rawLineIndex === undefined) return;

    const updated = [...pageRawTexts];
    const rawLines = updated[currentPageIndex].split('\n');
    rawLines[rawLineIndex] = mergeEditedTextWithOriginalSpacing(originalText, newText);
    updated[currentPageIndex] = rawLines.join('\n');

    setPageRawTexts(updated);

    // Flush parent updates synchronously so exiting review mode does not
    // discard the line edit before the child unmounts.
    const fullText = reconstructTranscript(updated);
    onTranscriptChange(fullText);
    onAutoSave({ transcriptionText: fullText });
  }, [currentPageIndex, currentLineIndex, alignedLines, pageNonBlankMap, onTranscriptChange, onAutoSave, pageRawTexts]);

  // Navigate to next line
  const goToNextLine = useCallback(() => {
    saveCurrentLine();
    if (currentLineIndex < alignedLines.length - 1) {
      setCurrentLineIndex(currentLineIndex + 1);
    } else if (currentPageIndex < letterPages.length - 1) {
      // Cross-page: next page, first line
      setCurrentPageIndex(currentPageIndex + 1);
      setCurrentLineIndex(0);
      containerRef.current?.scrollTo({ top: 0 });
    }
  }, [saveCurrentLine, currentLineIndex, alignedLines.length, currentPageIndex, letterPages.length]);

  // Navigate to previous line
  const goToPrevLine = useCallback(() => {
    saveCurrentLine();
    if (currentLineIndex > 0) {
      setCurrentLineIndex(currentLineIndex - 1);
    } else if (currentPageIndex > 0) {
      // Cross-page: previous page, last line
      const prevPageIdx = currentPageIndex - 1;
      setCurrentPageIndex(prevPageIdx);
      // We need to compute line count for prev page — set to a high number,
      // it'll be clamped in the effect below
      setCurrentLineIndex(999);
    }
  }, [saveCurrentLine, currentLineIndex, currentPageIndex]);

  // Clamp line index when aligned lines change (e.g., after page switch)
  useEffect(() => {
    if (alignedLines.length > 0 && currentLineIndex >= alignedLines.length) {
      setCurrentLineIndex(alignedLines.length - 1);
    }
  }, [alignedLines.length, currentLineIndex]);

  // Auto-scroll to keep current line visible (highlight + input region)
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;

    // Visible region: from highlight top (bbox[1]) to bottom of input
    const lineInputH = computeLineInputHeight(currentLine.words, scaleFactor);
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
  }, [currentLine, currentLineIndex, globalLineIndex, scaleFactor]);

  // Build word-positioned content and focus when line changes
  useEffect(() => {
    if (!inputRef.current) return;
    const line = alignedLines[currentLineIndex];
    if (!line) return;

    // Input left is derived from the line's bbox
    const pad = imageNaturalSize.width * 0.01;
    const overlayLeft = Math.max(0, (line.bbox[0] - pad) * scaleFactor);
    const contentAreaLeft = overlayLeft + CSS_BORDER_PADDING;

    buildWordPositionedContent(
      inputRef.current,
      line.transcriptText,
      line.words,
      contentAreaLeft,
      scaleFactor,
    );

    inputRef.current.focus();
    const sel = window.getSelection();
    if (sel && inputRef.current.firstChild) {
      sel.collapse(inputRef.current.firstChild, 0);
    }
  }, [currentLineIndex, currentPageIndex, alignedLines, scaleFactor, imageNaturalSize.width]);

  // Re-run line detection for the current page (Kraken + Vision in parallel)
  const redetectLines = useCallback(() => {
    if (!currentPage || isDetecting) return;

    const pageId = currentPage.id;
    const idx = currentPageIndex;

    // Immediately show spinner and clear stale Vision data
    setAiSegmentsMap(prev => ({ ...prev, [idx]: null }));
    setVisionBoxesMap(prev => ({ ...prev, [idx]: undefined }));
    setCurrentLineIndex(0);

    detectPageLines(pageId)
      .then(result => {
        const alignedSource = result.reconciledLines?.length
          ? result.reconciledLines
          : result.lineSegments;
        setAiSegmentsMap(prev => ({ ...prev, [idx]: alignedSource }));
        setVisionBoxesMap(prev => ({ ...prev, [idx]: result.ocrWordBoxes ?? [] }));
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        showToast(getErrorMessage(err, 'Line detection failed'), 'error');
      });
  }, [currentPage, currentPageIndex, isDetecting, showToast]);

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
  }, [saveCurrentLine, onExit, goToNextLine, goToPrevLine, redetectLines, debugLines, onDebugModeChange]);

  if (!currentPage) return null;

  // Dynamic height for the editable strip — based on current line's word heights
  const INPUT_DISPLAY_HEIGHT = computeLineInputHeight(currentLine?.words, scaleFactor);

  // Compute overlay positions
  const displayedImageHeight = imageDisplaySize.height || (imageNaturalSize.height * scaleFactor);
  const imgW = imageDisplaySize.width;

  // Input position — derived from line bbox, below the clear strip
  const LINE_GAP = 4;
  const inputTop = currentLine ? currentLine.bbox[3] * scaleFactor + LINE_GAP : 0;
  const linePad = imageNaturalSize.width * 0.01;
  const inputLeft = currentLine ? Math.max(0, (currentLine.bbox[0] - linePad) * scaleFactor) : 0;
  const inputRight = currentLine ? Math.min(imgW, (currentLine.bbox[2] + linePad) * scaleFactor) : imgW;
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

  return (
    <div className="line-review-mode" ref={containerRef}>
      <div
        className="line-review-image-container"
        style={{ maxWidth: imageNaturalSize.width > 0 ? imageNaturalSize.width : undefined }}
      >
        <img
          ref={imageRef}
          src={getImageUrl(currentPage.imageUrl)}
          alt={`Page ${currentPageIndex + 1}`}
          onLoad={handleImageLoad}
          draggable={false}
        />

        {/* Dimmer with polygon cutout — shadows everything except the active line */}
        {currentLine && imgW > 0 && (
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

        {/* Deleted-line striped overlay (shown on the line region itself) */}
        {currentLine && currentReconciledLine?.isDeleted && (
          <div
            className="line-review-deleted-overlay"
            style={{
              top: currentLine.bbox[1] * scaleFactor,
              left: currentLine.bbox[0] * scaleFactor,
              width: (currentLine.bbox[2] - currentLine.bbox[0]) * scaleFactor,
              height: (currentLine.bbox[3] - currentLine.bbox[1]) * scaleFactor,
            }}
          />
        )}

        {/* Input overlay — positioned below the clear strip, sized to the line */}
        {currentLine && (
          <div
            className={`line-review-input-overlay${currentReconciledLine?.isDeleted ? ' line-review-input-deleted' : ''}${currentReconciledLine?.isPhantom && !currentReconciledLine?.isDeleted ? ' line-review-input-phantom' : ''}`}
            style={{
              top: inputTop,
              left: inputLeft,
              width: inputWidth,
              height: INPUT_DISPLAY_HEIGHT,
            }}
          >
            {/* Left resize handle */}
            <div
              className="line-review-resize-handle line-review-resize-left"
              onMouseDown={(e) => startResize(e, 'left')}
            />
            {/* Right resize handle */}
            <div
              className="line-review-resize-handle line-review-resize-right"
              onMouseDown={(e) => startResize(e, 'right')}
            />

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

            {/* Delete/Restore button */}
            {currentReconciledLine && (
              <button
                className="line-review-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLineCorrection(
                    currentLineIndex,
                    currentReconciledLine.isDeleted ? 'undelete' : 'delete',
                  );
                }}
                title={currentReconciledLine.isDeleted ? 'Restore line' : 'Delete line'}
              >
                {currentReconciledLine.isDeleted ? '\u21A9' : '\u00D7'}
              </button>
            )}

            {/* Phantom confirm/reject controls */}
            {currentReconciledLine?.isPhantom && !currentReconciledLine?.isDeleted && (
              <div className="line-review-phantom-controls">
                <span className="phantom-label">Phantom?</span>
                <button
                  className="phantom-confirm-btn"
                  onClick={() => handleLineCorrection(currentLineIndex, 'confirm_phantom')}
                  title="Confirm this is bleed-through"
                >{'\u2713'}</button>
                <button
                  className="phantom-reject-btn"
                  onClick={() => handleLineCorrection(currentLineIndex, 'reject_phantom')}
                  title="This is real handwriting"
                >{'\u2717'}</button>
              </div>
            )}
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
            {(aiSegmentsMap[currentPageIndex] ?? []).map((seg, i) =>
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
            {(visionBoxesMap[currentPageIndex] ?? []).map((box, i) => (
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

        {/* Debug overlay — Reconciled line boundaries (white dashed outline) */}
        {debugLines && showReconciledLines && reconciledLinesForPage.length > 0 && imageDisplaySize.width > 0 && (
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
            {reconciledLinesForPage.filter(l => !l.isDeleted).map((line, i) =>
              line.boundary && line.boundary.length > 2 ? (
                <polygon
                  key={`recon-${i}`}
                  className="line-review-debug-reconciled"
                  points={line.boundary
                    .map(p => `${p.x * scaleFactor},${p.y * scaleFactor}`)
                    .join(' ')}
                />
              ) : (
                <rect
                  key={`recon-${i}`}
                  className="line-review-debug-reconciled"
                  x={line.bbox[0] * scaleFactor}
                  y={line.bbox[1] * scaleFactor}
                  width={(line.bbox[2] - line.bbox[0]) * scaleFactor}
                  height={(line.bbox[3] - line.bbox[1]) * scaleFactor}
                />
              ),
            )}
          </svg>
        )}

        {/* Debug overlay — HPP peaks (cyan horizontal bars at each line's Y-range) */}
        {debugLines && showHppPeaks && reconciledLinesForPage.length > 0 && imageDisplaySize.width > 0 && (
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
            {reconciledLinesForPage.filter(l => !l.isPhantom && !l.isDeleted).map((line, i) => (
              <rect
                key={`hpp-${i}`}
                x={0}
                y={line.bbox[1] * scaleFactor}
                width={imageDisplaySize.width}
                height={(line.bbox[3] - line.bbox[1]) * scaleFactor}
                fill="rgba(0,200,220,0.08)"
                stroke="rgba(0,200,220,0.3)"
                strokeWidth="1"
              />
            ))}
          </svg>
        )}

        {/* Debug overlay — Merge candidates (orange dashed outline on merged lines) */}
        {debugLines && showMergeCandidates && reconciledLinesForPage.length > 0 && imageDisplaySize.width > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: imageDisplaySize.width,
              height: displayedImageHeight,
              pointerEvents: 'none',
              zIndex: 9,
            }}
          >
            {reconciledLinesForPage
              .filter(l => l.wasMerged && l.sourceSegmentIds.length > 1)
              .map((line, i) => (
                <rect
                  key={`merge-${i}`}
                  className="line-review-debug-merge-candidate"
                  x={line.bbox[0] * scaleFactor}
                  y={line.bbox[1] * scaleFactor}
                  width={(line.bbox[2] - line.bbox[0]) * scaleFactor}
                  height={(line.bbox[3] - line.bbox[1]) * scaleFactor}
                />
              ))}
          </svg>
        )}

        {/* Debug overlay — Phantom suspects (striped red overlay on phantom-flagged lines) */}
        {debugLines && showPhantomSuspects && reconciledLinesForPage.length > 0 && imageDisplaySize.width > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: imageDisplaySize.width,
              height: displayedImageHeight,
              pointerEvents: 'none',
              zIndex: 9,
            }}
          >
            <defs>
              <pattern id="phantom-stripes" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(220,50,50,0.4)" strokeWidth="3" />
              </pattern>
            </defs>
            {reconciledLinesForPage.filter(l => l.isPhantom).map((line, i) => (
              <rect
                key={`phantom-${i}`}
                x={line.bbox[0] * scaleFactor}
                y={line.bbox[1] * scaleFactor}
                width={(line.bbox[2] - line.bbox[0]) * scaleFactor}
                height={(line.bbox[3] - line.bbox[1]) * scaleFactor}
                fill="url(#phantom-stripes)"
                stroke="rgba(220,50,50,0.6)"
                strokeWidth="1"
              />
            ))}
          </svg>
        )}

        {/* Detecting lines — detection in progress */}
        {isDetecting && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            <div className="line-review-spinner" />
            Detecting line positions...
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
      {totalLines > 0 && (
        <div className="line-review-progress">
          <span className="progress-line">
            <strong>Line {globalLineIndex}</strong> / {totalLines}
          </span>
          {letterPages.length > 1 && (
            <span className="progress-line">
              Page {currentPageIndex + 1} / {letterPages.length}
            </span>
          )}
        </div>
      )}

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
            className={`debug-legend-toggle${showReconciledLines ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowReconciledLines(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-reconciled" />
            Reconciled
          </button>
          <button
            className={`debug-legend-toggle${showMergeCandidates ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowMergeCandidates(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-merge" />
            Merged
          </button>
          <button
            className={`debug-legend-toggle${showPhantomSuspects ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowPhantomSuspects(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-phantom" />
            Phantom
          </button>
          <button
            className={`debug-legend-toggle${showHppPeaks ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowHppPeaks(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-hpp" />
            HPP
          </button>
        </div>
      )}

      {/* Exit hint */}
      <div className="line-review-exit-hint">
        <kbd>Esc</kbd> to exit
      </div>
    </div>
  );
});

export default LineReviewMode;
