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
import { constrainedGrouping, eastEdgeY, westEdgeY, type GroupedLine, type VisionRejectedMerge } from '../../utils/constrainedGrouping';
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
    div.textContent = joined;
    return;
  }

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
      if (Array.isArray(page.lineSegments)) {
        initial[index] = page.lineSegments;
      }
    });
    return initial;
  });

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
  const pipelineResult = useMemo(() => {
    const rawSegments = krakenSegmentsMap[currentPageIndex] ?? [];
    const wordBoxes = letterPages[currentPageIndex]?.ocrWordBoxes
      ?? visionBoxesMap[currentPageIndex]
      ?? [];

    if (rawSegments.length === 0) return null;

    // Phase 2: Attach Vision words to Kraken segments
    const { enriched, unassigned } = attachWordsToSegments(rawSegments, wordBoxes);

    // Phase 3: Constrained grouping
    const { lines: groupedLines, marginalSegments, visionRejections } = constrainedGrouping(enriched);

    // Phase 4-5: Match transcript to grouped lines
    const transcriptLines = pageLineTexts[currentPageIndex] ?? [];
    const matchResult = matchTranscriptToLines(transcriptLines, groupedLines, unassigned);

    return { enriched, unassigned, groupedLines, marginalSegments, matchResult, visionRejections };
  }, [krakenSegmentsMap, currentPageIndex, letterPages, visionBoxesMap, pageLineTexts]);

  // Merged AI segments for alignment — use grouped lines from the pipeline
  const mergedAiSegments = useMemo(() => {
    const raw = aiSegmentsMap[currentPageIndex];
    if (!raw || raw.length === 0) return raw;

    // If pipeline produced grouped lines, convert them to AlignmentInput format
    if (pipelineResult && pipelineResult.groupedLines.length > 0) {
      return pipelineResult.groupedLines.map((gl): AlignmentInput => ({
        line: gl.line,
        bbox: gl.bbox,
        baseline: gl.baseline,
        boundary: gl.boundary,
        ocrText: gl.visionText,
        words: gl.visionWords.map(w => ({ text: w.text, bbox: w.bbox })),
      }));
    }

    // Fallback: raw segments as-is
    return raw;
  }, [aiSegmentsMap, currentPageIndex, pipelineResult]);

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

    // Stored segment data is enough to render reliably without
    // forcing another backend call on first load.
    if (hasSegments) return;
    if (aiSegmentsMap[currentPageIndex] === null) return;

    const pageText = pageLineTexts[currentPageIndex]?.join('\n') || '';
    if (!pageText.trim()) return;

    // Mark as in progress
    setAiSegmentsMap(prev => ({ ...prev, [currentPageIndex]: null }));
    setDetectionSteps([]);

    const pageId = currentPage.id;
    const idx = currentPageIndex;

    detectPageLines(pageId, (label) => {
      setDetectionSteps(prev => [...prev, label]);
    })
      .then(result => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments }));
        setVisionBoxesMap(prev => ({ ...prev, [idx]: result.ocrWordBoxes ?? [] }));
        setKrakenSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments ?? [] }));
        setDetectionSteps([]);
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        showToast(getErrorMessage(err, 'Line detection failed'), 'error');
        setDetectionSteps([]);
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
    if (!currentPage || isDetecting) return;

    const pageId = currentPage.id;
    const idx = currentPageIndex;

    // Immediately show spinner and clear stale data
    setAiSegmentsMap(prev => ({ ...prev, [idx]: null }));
    setVisionBoxesMap(prev => ({ ...prev, [idx]: undefined }));
    setKrakenSegmentsMap(prev => ({ ...prev, [idx]: undefined }));
    setCurrentLineIndex(0);
    setDetectionSteps([]);

    detectPageLines(pageId, (label) => {
      setDetectionSteps(prev => [...prev, label]);
    })
      .then(result => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments }));
        setVisionBoxesMap(prev => ({ ...prev, [idx]: result.ocrWordBoxes ?? [] }));
        setKrakenSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments ?? [] }));
        setDetectionSteps([]);
      })
      .catch((err) => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
        showToast(getErrorMessage(err, 'Line detection failed'), 'error');
        setDetectionSteps([]);
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

        {/* Input overlay — positioned below the clear strip, sized to the line */}
        {currentLine && (
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
            {(krakenSegmentsMap[currentPageIndex] ?? []).map((seg, i) =>
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
            {(krakenSegmentsMap[currentPageIndex] ?? []).map((seg, i) => {
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
            {/* Vision junction debug: show the two Vision word boxes being compared
                at each merge junction, with cyan connecting lines top-top / bottom-bottom */}
            {pipelineResult?.groupedLines
              .filter((gl) => gl.merged && gl.constituents.length > 1)
              .flatMap((gl, gi) =>
                gl.constituents.slice(0, -1).map((seg, si) => {
                  const next = gl.constituents[si + 1];
                  const leftWord = seg.visionWords.length > 0
                    ? seg.visionWords[seg.visionWords.length - 1]
                    : null;
                  const rightWord = next.visionWords.length > 0
                    ? next.visionWords[0]
                    : null;
                  if (!leftWord && !rightWord) return null;
                  const s = scaleFactor;
                  return (
                    <g key={`vjunc-${gi}-${si}`}>
                      {/* Left word box (rightmost word of left segment) */}
                      {leftWord && (
                        <rect
                          className="line-review-debug-vision-junction"
                          x={leftWord.bbox[0] * s}
                          y={leftWord.bbox[1] * s}
                          width={(leftWord.bbox[2] - leftWord.bbox[0]) * s}
                          height={(leftWord.bbox[3] - leftWord.bbox[1]) * s}
                        />
                      )}
                      {/* Right word box (leftmost word of right segment) */}
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
                Show with red boxes + red connectors so you can see what was rejected. */}
            {(pipelineResult?.visionRejections ?? []).map((rej, ri) => {
              const s = scaleFactor;
              const leftWord = rej.left.visionWords.length > 0
                ? rej.left.visionWords[rej.left.visionWords.length - 1]
                : null;
              const rightWord = rej.right.visionWords.length > 0
                ? rej.right.visionWords[0]
                : null;
              // Also draw Kraken connectors (orange dashed) so you can see what Kraken wanted
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
                  {/* Vision boxes that caused the rejection (red) */}
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

      {/* Exit hint */}
      <div className="line-review-exit-hint">
        <kbd>Esc</kbd> to exit
      </div>
    </div>
  );
});

export default LineReviewMode;
