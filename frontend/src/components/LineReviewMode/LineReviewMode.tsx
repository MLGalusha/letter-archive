import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { getImageUrl } from '../../api/client';
import { detectPageLines } from '../../api/admin/letters';
import type { Letter, LineSegment, LineSegmentWord } from '../../types/Letter';
import {
  alignTranscriptToVisualLines,
  detectImageLines,
  buildAlignedLinesFromDetected,
  type AlignedLine,
  type DetectedLine,
} from '../../utils/lineAlignment';
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
  const [aiSegmentsMap, setAiSegmentsMap] = useState<Record<number, LineSegment[] | null | undefined>>(() => {
    const initial: Record<number, LineSegment[] | null | undefined> = {};
    letterPages.forEach((page, index) => {
      if (Array.isArray(page.lineSegments)) {
        initial[index] = page.lineSegments;
      }
    });
    return initial;
  });

  // Client-side pixel-detected line boundaries (fallback)
  const [detectedLinesMap, setDetectedLinesMap] = useState<Record<number, DetectedLine[] | null>>({});

  // Debug overlay layer toggle
  const [showDebugLines, setShowDebugLines] = useState(true);

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

  // Horizontal bounds for highlight/input (percentage of image width)
  const [textLeftPct, setTextLeftPct] = useState(0.08);
  const [textRightPct, setTextRightPct] = useState(0.92);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);

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

  // Run line detection via backend API when a page loads
  useEffect(() => {
    if (!currentPage) return;
    // Already attempted or in progress for this page
    if (aiSegmentsMap[currentPageIndex] !== undefined) return;
    const pageText = pageLineTexts[currentPageIndex]?.join('\n') || '';
    if (!pageText.trim()) return;

    // Mark as in progress
    setAiSegmentsMap(prev => ({ ...prev, [currentPageIndex]: null }));

    const pageId = currentPage.id;
    const idx = currentPageIndex;

    detectPageLines(pageId)
      .then(result => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments }));
      })
      .catch(() => {
        // Detection failed — mark as empty so we fall back to pixel detection
        setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
      });
  }, [currentPage, currentPageIndex, aiSegmentsMap, pageLineTexts]);

  // Fall back to client-side pixel detection if AI returned nothing
  const runPixelDetection = useCallback(() => {
    if (!imageRef.current || !currentPage) return;
    // Skip if AI detection returned results
    const aiResult = aiSegmentsMap[currentPageIndex];
    if (aiResult === undefined || aiResult === null) return; // not done yet
    if (aiResult.length > 0) return; // AI found lines
    // Skip if pixel detection already attempted
    if (currentPageIndex in detectedLinesMap) return;

    const detected = detectImageLines(imageRef.current);
    setDetectedLinesMap(prev => ({ ...prev, [currentPageIndex]: detected.length > 0 ? detected : [] }));
  }, [currentPage, currentPageIndex, aiSegmentsMap, detectedLinesMap]);

  // Whether we're still waiting for AI detection for the current page
  const isDetecting = aiSegmentsMap[currentPageIndex] === null;

  // Compute aligned lines for current page
  const alignedLines: AlignedLine[] = useMemo(() => {
    if (!currentPage) return [];
    if (isDetecting) return []; // AI detection in progress — show spinner, no lines yet
    const pageText = pageLineTexts[currentPageIndex]?.join('\n') || '';

    // 1. Use AI-detected segments (from on-demand detection)
    let lines: AlignedLine[] = [];
    const aiResult = aiSegmentsMap[currentPageIndex];
    if (aiResult && aiResult.length > 0) {
      lines = alignTranscriptToVisualLines(pageText, aiResult);
    } else {
      // 2. Fall back to client-side pixel detection
      const transcriptLines = pageText.split('\n').filter((l) => l.trim().length > 0);
      if (transcriptLines.length === 0) return [];

      const detectionResult = detectedLinesMap[currentPageIndex];
      if (detectionResult && detectionResult.length > 0) {
        lines = buildAlignedLinesFromDetected(transcriptLines, detectionResult);
      }
    }

    // Skip empty lines (extra detected segments with no transcript text)
    return lines.filter(l => l.transcriptLineIndex >= 0);
  }, [currentPage, currentPageIndex, pageLineTexts, aiSegmentsMap, detectedLinesMap, isDetecting]);
  const hasTranscriptLinesOnPage = (pageLineTexts[currentPageIndex]?.length ?? 0) > 0;

  // Derive text bounds from the current line's bbox (per-line alignment).
  // Each line gets its own horizontal extent so the highlight/input tracks where the
  // actual text is — e.g. a right-aligned date doesn't stretch to the left margin.
  useEffect(() => {
    if (imageNaturalSize.width === 0) return;

    const currentAligned = alignedLines[currentLineIndex];
    if (currentAligned) {
      const pad = imageNaturalSize.width * 0.01;
      setTextLeftPct(Math.max(0.02, (currentAligned.bbox[0] - pad) / imageNaturalSize.width));
      setTextRightPct(Math.min(0.98, (currentAligned.bbox[2] + pad) / imageNaturalSize.width));
      return;
    }

    // Fallback: use global bounds from all lines when no current line
    const activeLines = alignedLines.length > 0
      ? alignedLines
      : (aiSegmentsMap[currentPageIndex] ?? []);
    if (activeLines.length === 0) return;

    const globalLeft = Math.min(...activeLines.map((line) => line.bbox[0]));
    const globalRight = Math.max(...activeLines.map((line) => line.bbox[2]));
    const pad = imageNaturalSize.width * 0.01;

    setTextLeftPct(Math.max(0.02, (globalLeft - pad) / imageNaturalSize.width));
    setTextRightPct(Math.min(0.98, (globalRight + pad) / imageNaturalSize.width));
  }, [alignedLines, aiSegmentsMap, currentPageIndex, imageNaturalSize.width, currentLineIndex]);

  // Only expose currentLine when the image for this page has loaded,
  // so overlays never render at positions scaled from a previous page's dimensions
  const imageReady = imageNaturalSize.width > 0;
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

      const detectionResult = detectedLinesMap[idx];
      if (detectionResult && detectionResult.length > 0) {
        return buildAlignedLinesFromDetected(
          pageText.split('\n').filter((l) => l.trim().length > 0),
          detectionResult,
        ).filter((line) => line.transcriptLineIndex >= 0).length;
      }

      return transcriptLineCount;
    }),
    [letterPages, pageLineTexts, aiSegmentsMap, detectedLinesMap, currentPageIndex],
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

  // Track image natural size and run pixel detection fallback
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setImageDisplaySize({ width: img.clientWidth, height: img.clientHeight });
    // Run pixel detection fallback after a microtask
    requestAnimationFrame(() => runPixelDetection());
  }, [runPixelDetection]);

  // Also try pixel detection when AI detection completes with empty result
  useEffect(() => {
    const aiResult = aiSegmentsMap[currentPageIndex];
    if (aiResult !== undefined && aiResult !== null && aiResult.length === 0 && imageRef.current) {
      runPixelDetection();
    }
  }, [aiSegmentsMap, currentPageIndex, runPixelDetection]);

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

  // Drag handle effect — resize highlight/input width
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!imageRef.current) return;
      const rect = imageRef.current.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const clamped = Math.max(0.02, Math.min(0.98, pct));

      if (dragging === 'left') {
        setTextLeftPct(Math.min(clamped, textRightPct - 0.1));
      } else {
        setTextRightPct(Math.max(clamped, textLeftPct + 0.1));
      }
    };

    const handleMouseUp = () => setDragging(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, textLeftPct, textRightPct]);

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

    setPageRawTexts((prev) => {
      const updated = [...prev];
      const rawLines = updated[currentPageIndex].split('\n');
      rawLines[rawLineIndex] = mergeEditedTextWithOriginalSpacing(originalText, newText);
      updated[currentPageIndex] = rawLines.join('\n');

      // Reconstruct and auto-save
      const fullText = reconstructTranscript(updated);
      onTranscriptChange(fullText);
      onAutoSave({ transcriptionText: fullText });

      return updated;
    });
  }, [currentPageIndex, currentLineIndex, alignedLines, pageNonBlankMap, onTranscriptChange, onAutoSave]);

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

    // Content area left = overlay left + border + padding
    const overlayLeft = textLeftPct * imageDisplaySize.width;
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
  }, [currentLineIndex, currentPageIndex, alignedLines, scaleFactor, textLeftPct, imageDisplaySize.width]);

  // Re-run line detection for the current page
  const redetectLines = useCallback(() => {
    if (!currentPage || isDetecting) return;

    const pageId = currentPage.id;
    const idx = currentPageIndex;

    // Immediately show spinner
    setAiSegmentsMap(prev => ({ ...prev, [idx]: null }));
    // Clear pixel fallback cache
    setDetectedLinesMap(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
    setCurrentLineIndex(0);

    detectPageLines(pageId)
      .then(result => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: result.lineSegments }));
      })
      .catch(() => {
        setAiSegmentsMap(prev => ({ ...prev, [idx]: [] }));
      });
  }, [currentPage, currentPageIndex, isDetecting]);

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
  const topDimmerHeight = currentLine ? currentLine.bbox[1] * scaleFactor : 0;
  const highlightHeight = currentLine
    ? (currentLine.bbox[3] - currentLine.bbox[1]) * scaleFactor
    : 0;
  const displayedImageHeight = imageDisplaySize.height || (imageNaturalSize.height * scaleFactor);

  // Horizontal bounds from drag state (centered by default)
  const textLeft = textLeftPct * imageDisplaySize.width;
  const textRight = textRightPct * imageDisplaySize.width;
  const textWidth = textRight - textLeft;

  // Input position — below the clear strip with a small breathing gap
  const LINE_GAP = 4;
  const inputTop = currentLine ? currentLine.bbox[3] * scaleFactor + LINE_GAP : 0;
  const inputLeft = textLeft;
  const inputWidth = textWidth;

  // Bottom dimmer starts at the line bottom (overlapping the input area),
  // with a CSS gradient fade so it transitions softly into the editable area.
  // The input overlay sits on top at z-index 10.
  const bottomDimmerTop = inputTop;

  // Use the page-global font size for the editable div
  const fontSize = pageFontSize;

  return (
    <div className={`line-review-mode${dragging ? ' line-review-dragging' : ''}`} ref={containerRef}>
      <div
        className="line-review-image-container"
        style={{ maxWidth: imageNaturalSize.width > 0 ? imageNaturalSize.width : undefined }}
      >
        {/* crossOrigin="anonymous" required for canvas pixel reading.
            &cors=1 busts cache to avoid reusing a non-CORS cached response. */}
        <img
          ref={imageRef}
          src={`${getImageUrl(currentPage.imageUrl)}${currentPage.imageUrl.includes('?') ? '&' : '?'}cors=1`}
          alt={`Page ${currentPageIndex + 1}`}
          onLoad={handleImageLoad}
          crossOrigin="anonymous"
          draggable={false}
        />

        {/* Left side dimmer — full height, left of text bounds */}
        {currentLine && textLeft > 0 && (
          <div
            className="line-review-dimmer line-review-dimmer-solid"
            style={{ top: 0, left: 0, width: textLeft, height: displayedImageHeight }}
          />
        )}

        {/* Right side dimmer — full height, right of text bounds */}
        {currentLine && (
          <div
            className="line-review-dimmer line-review-dimmer-solid"
            style={{ top: 0, right: 0, width: Math.max(0, imageDisplaySize.width - textRight), height: displayedImageHeight }}
          />
        )}

        {/* Top solid — within text bounds, above the fade */}
        {currentLine && topDimmerHeight > 10 && (
          <div
            className="line-review-dimmer line-review-dimmer-solid"
            style={{ top: 0, left: textLeft, width: textWidth, height: Math.max(0, topDimmerHeight - 10) }}
          />
        )}

        {/* Top fade — gradient within text bounds */}
        {currentLine && topDimmerHeight > 0 && (
          <div
            className="line-review-dimmer line-review-dimmer-top"
            style={{
              top: Math.max(0, topDimmerHeight - 10),
              left: textLeft,
              width: textWidth,
              height: 10,
            }}
          />
        )}

        {/* Bottom fade — gradient within text bounds */}
        {currentLine && (
          <div
            className="line-review-dimmer line-review-dimmer-bottom"
            style={{
              top: bottomDimmerTop,
              left: textLeft,
              width: textWidth,
              height: 10,
            }}
          />
        )}

        {/* Bottom solid — within text bounds, below the fade */}
        {currentLine && (
          <div
            className="line-review-dimmer line-review-dimmer-solid"
            style={{
              top: bottomDimmerTop + 10,
              left: textLeft,
              width: textWidth,
              height: Math.max(0, displayedImageHeight - bottomDimmerTop - 10),
            }}
          />
        )}

        {/* Input overlay — positioned just below the clear highlight strip */}
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

        {/* Drag handles — resize highlight/input width */}
        {currentLine && (
          <>
            <div
              className="line-review-drag-handle"
              style={{
                top: topDimmerHeight,
                left: textLeft - 6,
                height: highlightHeight + LINE_GAP + INPUT_DISPLAY_HEIGHT,
              }}
              onMouseDown={(e) => { e.preventDefault(); setDragging('left'); }}
            />
            <div
              className="line-review-drag-handle"
              style={{
                top: topDimmerHeight,
                left: textRight - 6,
                height: highlightHeight + LINE_GAP + INPUT_DISPLAY_HEIGHT,
              }}
              onMouseDown={(e) => { e.preventDefault(); setDragging('right'); }}
            />
          </>
        )}

        {/* Debug overlay — Kraken polygon boundaries */}
        {debugLines && showDebugLines && imageDisplaySize.width > 0 && (
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

      {/* Debug legend */}
      {debugLines && (
        <div className="line-review-debug-legend">
          <button
            className={`debug-legend-toggle${showDebugLines ? ' debug-legend-toggle-active' : ''}`}
            onClick={() => setShowDebugLines(v => !v)}
          >
            <span className="debug-legend-swatch debug-legend-lines" />
            Lines
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
