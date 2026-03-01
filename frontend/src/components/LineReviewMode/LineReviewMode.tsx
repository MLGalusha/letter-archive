import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getImageUrl } from '../../api/client';
import type { Letter } from '../../types/Letter';
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
    pages.push(parts[i]?.trim() || '');
  }
  // Pad if needed
  while (pages.length < pageCount) {
    pages.push('');
  }
  return pages;
}

/**
 * Reconstructs full transcript from per-page line arrays.
 */
function reconstructTranscript(pageTexts: string[][]): string {
  if (pageTexts.length === 1) {
    return pageTexts[0].join('\n');
  }
  return pageTexts
    .map((lines, i) => `--- Page ${i + 1} ---\n\n${lines.join('\n')}`)
    .join('\n\n');
}

/**
 * Measures ideal font size that makes text fill a given width.
 */
function measureFontSize(text: string, targetWidth: number, fontFamily: string): number {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !text || targetWidth <= 0) return 14;

  let lo = 10;
  let hi = 28;

  while (hi - lo > 0.5) {
    const mid = (lo + hi) / 2;
    ctx.font = `${mid}px ${fontFamily}`;
    const measured = ctx.measureText(text).width;
    if (measured < targetWidth) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return Math.max(10, Math.min(28, Math.round(lo)));
}

export default function LineReviewMode({
  letter,
  transcript,
  onTranscriptChange,
  onExit,
  onAutoSave,
}: LineReviewModeProps) {
  // Filter to letter-type pages only
  const letterPages = useMemo(
    () => letter.images.filter((img) => img.type === 'letter'),
    [letter.images],
  );

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 });

  // Pixel-detected line boundaries per page (cached across page switches)
  // null = not attempted, [] = attempted but found nothing
  const [detectedLinesMap, setDetectedLinesMap] = useState<Record<number, DetectedLine[] | null>>({});

  // Per-page line text maps
  const [pageLineTexts, setPageLineTexts] = useState<string[][]>(() => {
    const pageTexts = splitTranscriptByPage(transcript, letterPages.length);
    return pageTexts.map((text) =>
      text.split('\n').filter((l) => l.trim().length > 0),
    );
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentPage = letterPages[currentPageIndex];

  // Run pixel-based line detection when the image loads (for pages without Kraken data)
  const runPixelDetection = useCallback(() => {
    if (!imageRef.current || !currentPage) return;
    // Skip if Kraken data exists for this page
    if (currentPage.lineSegments && currentPage.lineSegments.length > 0) return;
    // Skip if already attempted for this page (null means not attempted)
    if (currentPageIndex in detectedLinesMap) return;

    const detected = detectImageLines(imageRef.current);
    // Store result even if empty (marks as attempted)
    setDetectedLinesMap(prev => ({ ...prev, [currentPageIndex]: detected.length > 0 ? detected : [] }));
  }, [currentPage, currentPageIndex, detectedLinesMap]);

  // Compute aligned lines for current page
  const alignedLines: AlignedLine[] = useMemo(() => {
    if (!currentPage) return [];
    const pageText = pageLineTexts[currentPageIndex]?.join('\n') || '';

    // Use Kraken segments if available
    if (currentPage.lineSegments && currentPage.lineSegments.length > 0) {
      return alignTranscriptToVisualLines(pageText, currentPage.lineSegments);
    }

    const transcriptLines = pageText.split('\n').filter((l) => l.trim().length > 0);
    if (transcriptLines.length === 0) return [];

    const detectionResult = detectedLinesMap[currentPageIndex];

    // Use pixel-detected text region if available and non-empty
    if (detectionResult && detectionResult.length > 0) {
      return buildAlignedLinesFromDetected(transcriptLines, detectionResult);
    }

    // Detection was attempted but returned empty (CORS error, blank image, etc.)
    // Fall back to even division of an estimated text region with margins
    if (detectionResult !== undefined && detectionResult !== null) {
      const w = imageNaturalSize.width || 1000;
      const h = imageNaturalSize.height || 1400;
      const estimatedRegion = [{
        y1: Math.round(h * 0.15),
        y2: Math.round(h * 0.90),
        x1: Math.round(w * 0.08),
        x2: Math.round(w * 0.92),
      }];
      return buildAlignedLinesFromDetected(transcriptLines, estimatedRegion);
    }

    // Not yet attempted — return empty until pixel analysis runs
    return [];
  }, [currentPage, currentPageIndex, pageLineTexts, detectedLinesMap, imageNaturalSize]);

  const currentLine = alignedLines[currentLineIndex];
  const totalLines = useMemo(
    () => letterPages.reduce((sum, page, idx) => {
      const text = pageLineTexts[idx]?.join('\n') || '';
      const segs = page.lineSegments;
      if (segs && segs.length > 0) return sum + segs.length;
      return sum + text.split('\n').filter((l) => l.trim().length > 0).length;
    }, 0),
    [letterPages, pageLineTexts],
  );

  const globalLineIndex = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < currentPageIndex; i++) {
      const page = letterPages[i];
      const text = pageLineTexts[i]?.join('\n') || '';
      const segs = page?.lineSegments;
      if (segs && segs.length > 0) {
        sum += segs.length;
      } else {
        sum += text.split('\n').filter((l) => l.trim().length > 0).length;
      }
    }
    return sum + currentLineIndex + 1;
  }, [currentPageIndex, currentLineIndex, letterPages, pageLineTexts]);

  // Scale factor: displayed size vs natural image size
  const scaleFactor = imageNaturalSize.width > 0
    ? imageDisplaySize.width / imageNaturalSize.width
    : 1;

  // Track image natural size and run pixel detection
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    setImageDisplaySize({ width: img.clientWidth, height: img.clientHeight });
    // Run pixel detection after a microtask to let state settle
    requestAnimationFrame(() => runPixelDetection());
  }, [runPixelDetection]);

  // Update display size on resize
  useEffect(() => {
    const handleResize = () => {
      if (imageRef.current) {
        setImageDisplaySize({
          width: imageRef.current.clientWidth,
          height: imageRef.current.clientHeight,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Save current line text and trigger auto-save
  const saveCurrentLine = useCallback(() => {
    if (!inputRef.current) return;
    const newText = inputRef.current.value;
    setPageLineTexts((prev) => {
      const updated = prev.map((p) => [...p]);
      // Ensure the page array exists
      while (updated.length <= currentPageIndex) {
        updated.push([]);
      }
      // Ensure the line index exists
      while (updated[currentPageIndex].length <= currentLineIndex) {
        updated[currentPageIndex].push('');
      }
      updated[currentPageIndex][currentLineIndex] = newText;

      // Reconstruct and auto-save
      const fullText = reconstructTranscript(updated);
      onTranscriptChange(fullText);
      onAutoSave({ transcriptionText: fullText });

      return updated;
    });
  }, [currentPageIndex, currentLineIndex, onTranscriptChange, onAutoSave]);

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

  // Auto-scroll to keep current line visible
  useEffect(() => {
    if (!currentLine || !containerRef.current) return;

    const lineCenter = (currentLine.bbox[1] + currentLine.bbox[3]) / 2 * scaleFactor;
    const container = containerRef.current;
    const viewportMid = container.clientHeight / 2;

    // Only scroll if line center is past viewport midpoint
    if (lineCenter > viewportMid) {
      const scrollTarget = lineCenter - viewportMid + container.scrollTop;
      const maxScroll = container.scrollHeight - container.clientHeight;
      container.scrollTo({
        top: Math.min(scrollTarget, maxScroll),
        behavior: 'smooth',
      });
    } else if (currentLineIndex === 0) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentLine, currentLineIndex, scaleFactor]);

  // Focus input when line changes
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(0, 0);
    }
  }, [currentLineIndex, currentPageIndex]);

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
  }, [saveCurrentLine, onExit, goToNextLine, goToPrevLine]);

  if (!currentPage) return null;

  // Compute overlay positions
  const topDimmerHeight = currentLine ? currentLine.bbox[1] * scaleFactor : 0;
  const bottomDimmerTop = currentLine ? currentLine.bbox[3] * scaleFactor : 0;
  const displayedImageHeight = imageDisplaySize.height || (imageNaturalSize.height * scaleFactor);

  // Input position — overlay directly on the current line's bounding box
  const inputTop = currentLine ? currentLine.bbox[1] * scaleFactor : 0;
  const inputLeft = currentLine ? currentLine.bbox[0] * scaleFactor : 0;
  const inputWidth = currentLine
    ? (currentLine.bbox[2] - currentLine.bbox[0]) * scaleFactor
    : imageDisplaySize.width;
  const inputHeight = currentLine
    ? (currentLine.bbox[3] - currentLine.bbox[1]) * scaleFactor
    : 0;

  // Font size auto-scaling
  const fontSize = currentLine
    ? measureFontSize(
        alignedLines[currentLineIndex]?.transcriptText || '',
        inputWidth - 12, // account for padding
        "Georgia, 'Times New Roman', serif",
      )
    : 14;

  const currentText = alignedLines[currentLineIndex]?.transcriptText || '';

  return (
    <div className="line-review-mode" ref={containerRef}>
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

        {/* Top dimmer */}
        {currentLine && topDimmerHeight > 0 && (
          <div
            className="line-review-dimmer line-review-dimmer-top"
            style={{ height: topDimmerHeight }}
          />
        )}

        {/* Bottom dimmer */}
        {currentLine && (
          <div
            className="line-review-dimmer"
            style={{
              top: bottomDimmerTop,
              height: Math.max(0, displayedImageHeight - bottomDimmerTop),
            }}
          />
        )}

        {/* Input overlay — positioned directly on the current line */}
        {currentLine && (
          <div
            className="line-review-input-overlay"
            style={{
              top: inputTop,
              left: inputLeft,
              width: inputWidth,
              height: inputHeight,
            }}
          >
            <input
              ref={inputRef}
              type="text"
              defaultValue={currentText}
              key={`${currentPageIndex}-${currentLineIndex}`}
              style={{ fontSize }}
            />
          </div>
        )}

        {/* Analyzing indicator — only while detection hasn't been attempted yet */}
        {alignedLines.length === 0 && imageNaturalSize.width > 0 && !(currentPageIndex in detectedLinesMap) && (
          <div className="line-review-analyzing">
            Detecting lines...
          </div>
        )}
      </div>

      {/* Progress indicator */}
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

      {/* Exit hint */}
      <div className="line-review-exit-hint">
        <kbd>Esc</kbd> to exit
      </div>
    </div>
  );
}
