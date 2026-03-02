import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getImageUrl } from '../../api/client';
import { detectPageLines } from '../../api/admin/letters';
import type { Letter, LineSegment } from '../../types/Letter';
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
  const [debugLines, setDebugLines] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 });

  // AI-detected line segments per page (cached across page switches)
  // undefined = not attempted, null = in progress, LineSegment[] = done
  const [aiSegmentsMap, setAiSegmentsMap] = useState<Record<number, LineSegment[] | null | undefined>>({});

  // Client-side pixel-detected line boundaries (fallback)
  const [detectedLinesMap, setDetectedLinesMap] = useState<Record<number, DetectedLine[] | null>>({});

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
  const inputRef = useRef<HTMLInputElement>(null);

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
  }, [currentPage, currentPageIndex, aiSegmentsMap]);

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

  // Only expose currentLine when the image for this page has loaded,
  // so overlays never render at positions scaled from a previous page's dimensions
  const imageReady = imageNaturalSize.width > 0;
  const currentLine = imageReady ? alignedLines[currentLineIndex] : undefined;
  const totalLines = useMemo(
    () => letterPages.reduce((sum, _page, idx) => {
      const text = pageLineTexts[idx]?.join('\n') || '';
      const aiSegs = aiSegmentsMap[idx];
      if (aiSegs && aiSegs.length > 0) return sum + aiSegs.length;
      return sum + text.split('\n').filter((l) => l.trim().length > 0).length;
    }, 0),
    [letterPages, pageLineTexts, aiSegmentsMap],
  );

  const globalLineIndex = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < currentPageIndex; i++) {
      const text = pageLineTexts[i]?.join('\n') || '';
      const aiSegs = aiSegmentsMap[i];
      if (aiSegs && aiSegs.length > 0) {
        sum += aiSegs.length;
      } else {
        sum += text.split('\n').filter((l) => l.trim().length > 0).length;
      }
    }
    return sum + currentLineIndex + 1;
  }, [currentPageIndex, currentLineIndex, pageLineTexts, aiSegmentsMap]);

  // Scale factor: displayed size vs natural image size
  const scaleFactor = imageNaturalSize.width > 0
    ? imageDisplaySize.width / imageNaturalSize.width
    : 1;

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

    const newText = inputRef.current.value;
    const originalText = currentAligned.transcriptText;

    // Skip save if text hasn't changed
    if (newText === originalText) return;

    // Use the tracked transcript line index (not the visual line index)
    const transcriptIdx = currentAligned.transcriptLineIndex;
    if (transcriptIdx < 0) return; // empty/unassigned line — nothing to save

    const rawLineIndex = pageNonBlankMap[currentPageIndex]?.[transcriptIdx];
    if (rawLineIndex === undefined) return;

    setPageRawTexts((prev) => {
      const updated = [...prev];
      const rawLines = updated[currentPageIndex].split('\n');
      rawLines[rawLineIndex] = newText;
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

    // Visible region: from highlight top (bbox[1]) to bottom of input (bbox[3] + INPUT_DISPLAY_HEIGHT)
    const INPUT_H = 30;
    const regionTop = currentLine.bbox[1] * scaleFactor;
    const regionBottom = currentLine.bbox[3] * scaleFactor + INPUT_H;
    const regionCenter = (regionTop + regionBottom) / 2;
    const container = containerRef.current;
    const viewportMid = container.clientHeight / 2;

    if (regionCenter > viewportMid) {
      const scrollTarget = regionCenter - viewportMid + container.scrollTop;
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
        setDebugLines(prev => !prev);
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
  }, [saveCurrentLine, onExit, goToNextLine, goToPrevLine, redetectLines]);

  if (!currentPage) return null;

  // Fixed height for the editable input strip below the highlight
  const INPUT_DISPLAY_HEIGHT = 30;

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
            <input
              ref={inputRef}
              type="text"
              defaultValue={currentText}
              key={`${currentPageIndex}-${currentLineIndex}`}
              style={{ fontSize }}
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

        {/* Debug overlay — magenta lines at detected boundaries */}
        {debugLines && alignedLines.map((line, i) => (
          <div
            key={i}
            className="line-review-debug-line"
            style={{
              top: line.bbox[1] * scaleFactor,
              left: line.bbox[0] * scaleFactor,
              width: (line.bbox[2] - line.bbox[0]) * scaleFactor,
              height: (line.bbox[3] - line.bbox[1]) * scaleFactor,
            }}
          />
        ))}

        {/* Detecting lines — detection in progress */}
        {isDetecting && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            <div className="line-review-spinner" />
            Detecting line positions...
          </div>
        )}

        {/* Not available — all detection methods exhausted */}
        {!isDetecting && alignedLines.length === 0 && imageNaturalSize.width > 0 && (
          <div className="line-review-analyzing">
            Could not detect line positions for this page.
            <br />
            <small>Press <kbd>Esc</kbd> to return to the editor.</small>
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
        {!isDetecting && (
          <>
            {' · '}
            <button className="line-review-redetect-btn" onClick={redetectLines}>
              Re-detect lines
            </button>
          </>
        )}
      </div>
    </div>
  );
}
