import { describe, it, expect, vi } from 'vitest';
import {
  alignTranscriptToVisualLines,
  buildAlignedLinesFromDetected,
  detectImageLines,
  type DetectedLine,
} from '../lineAlignment';
import type { LineSegment } from '../../types/Letter';

// ============================================================================
// alignTranscriptToVisualLines
// ============================================================================

describe('alignTranscriptToVisualLines', () => {
  const makeSegment = (line: number, ocrText: string = ''): LineSegment => ({
    line,
    baseline: [[10, line * 40 + 30], [500, line * 40 + 30]],
    bbox: [10, line * 40, 500, line * 40 + 35] as [number, number, number, number],
    ocrText,
  });

  it('returns empty when no line segments', () => {
    const result = alignTranscriptToVisualLines('Hello world', []);
    expect(result).toEqual([]);
  });

  it('returns empty-text lines when no transcript text', () => {
    const segments = [makeSegment(1), makeSegment(2)];
    const result = alignTranscriptToVisualLines('', segments);
    expect(result).toHaveLength(2);
    expect(result[0].transcriptText).toBe('');
    expect(result[1].transcriptText).toBe('');
    expect(result[0].bbox).toEqual(segments[0].bbox);
  });

  it('1:1 mapping when transcript and segment counts match', () => {
    const segments = [makeSegment(1, 'Hello'), makeSegment(2, 'World')];
    const result = alignTranscriptToVisualLines('Hello\nWorld', segments);
    expect(result).toHaveLength(2);
    expect(result[0].transcriptText).toBe('Hello');
    expect(result[0].visualLineIndex).toBe(0);
    expect(result[1].transcriptText).toBe('World');
    expect(result[1].visualLineIndex).toBe(1);
  });

  it('handles more segments than transcript lines via fuzzy matching', () => {
    const segments = [
      makeSegment(1, 'Dear friend'),
      makeSegment(2, 'I hope you'),
      makeSegment(3, 'are well'),
    ];
    const result = alignTranscriptToVisualLines('Dear friend\nI hope you are well', segments);
    expect(result).toHaveLength(3);
    // First should match "Dear friend"
    expect(result[0].transcriptText).toBe('Dear friend');
    // Second should match the other transcript line
    expect(result[1].transcriptText).toBe('I hope you are well');
  });

  it('handles more transcript lines than segments', () => {
    const segments = [makeSegment(1, 'Hello World')];
    const result = alignTranscriptToVisualLines('Hello\nWorld\nFoo', segments);
    expect(result).toHaveLength(1);
    // Best match + leftover appended
    expect(result[0].transcriptText).toContain('Hello');
  });

  it('assigns proportionally when OCR text is empty', () => {
    const segments = [makeSegment(1), makeSegment(2), makeSegment(3)];
    const result = alignTranscriptToVisualLines('Line A\nLine B\nLine C', segments);
    expect(result).toHaveLength(3);
    // Each should get one transcript line
    const texts = result.map(r => r.transcriptText);
    expect(texts).toContain('Line A');
    expect(texts).toContain('Line B');
    expect(texts).toContain('Line C');
  });

  it('fuzzy matches despite minor OCR differences', () => {
    const segments = [
      makeSegment(1, 'Dcar Molly'),  // OCR misread "Dear" as "Dcar"
      makeSegment(2, 'I miss you'),
    ];
    const result = alignTranscriptToVisualLines('Dear Molly\nI miss you', segments);
    expect(result).toHaveLength(2);
    expect(result[0].transcriptText).toBe('Dear Molly');
    expect(result[1].transcriptText).toBe('I miss you');
  });

  it('preserves bbox from segments', () => {
    const seg = makeSegment(1, 'Hello');
    const result = alignTranscriptToVisualLines('Hello', [seg]);
    expect(result[0].bbox).toEqual(seg.bbox);
    expect(result[0].baseline).toEqual(seg.baseline);
  });

  it('filters empty transcript lines', () => {
    const segments = [makeSegment(1, 'Hello'), makeSegment(2, 'World')];
    const result = alignTranscriptToVisualLines('Hello\n\n\nWorld\n\n', segments);
    expect(result).toHaveLength(2);
    expect(result[0].transcriptText).toBe('Hello');
    expect(result[1].transcriptText).toBe('World');
  });
});

// ============================================================================
// buildAlignedLinesFromDetected
// ============================================================================

describe('buildAlignedLinesFromDetected', () => {
  it('returns empty when no transcript lines', () => {
    const detected: DetectedLine[] = [{ y1: 10, y2: 50, x1: 20, x2: 400 }];
    const result = buildAlignedLinesFromDetected([], detected);
    expect(result).toEqual([]);
  });

  it('returns empty when no detected lines', () => {
    const result = buildAlignedLinesFromDetected(['Hello'], []);
    expect(result).toEqual([]);
  });

  it('evenly divides single bounding box among transcript lines', () => {
    // Single detected region (typical output from detectImageLines)
    const detected: DetectedLine[] = [
      { y1: 100, y2: 400, x1: 50, x2: 450 },
    ];
    const lines = ['First line', 'Second line', 'Third line'];
    const result = buildAlignedLinesFromDetected(lines, detected);

    expect(result).toHaveLength(3);
    expect(result[0].transcriptText).toBe('First line');
    expect(result[1].transcriptText).toBe('Second line');
    expect(result[2].transcriptText).toBe('Third line');

    // Each line should get 100px height (300 / 3)
    expect(result[0].bbox).toEqual([50, 100, 450, 200]);
    expect(result[1].bbox).toEqual([50, 200, 450, 300]);
    expect(result[2].bbox).toEqual([50, 300, 450, 400]);
  });

  it('merges multiple detected regions into one bounding box', () => {
    // If somehow multiple regions are passed, they get merged
    const detected: DetectedLine[] = [
      { y1: 10, y2: 30, x1: 5, x2: 100 },
      { y1: 35, y2: 55, x1: 10, x2: 95 },
      { y1: 60, y2: 80, x1: 8, x2: 98 },
    ];
    const result = buildAlignedLinesFromDetected(['All text'], detected);
    expect(result).toHaveLength(1);
    expect(result[0].bbox[0]).toBe(5);   // min x1
    expect(result[0].bbox[1]).toBe(10);  // min y1
    expect(result[0].bbox[2]).toBe(100); // max x2
    expect(result[0].bbox[3]).toBe(80);  // max y2
  });

  it('splits single region evenly for multiple transcript lines', () => {
    const detected: DetectedLine[] = [
      { y1: 100, y2: 190, x1: 20, x2: 400 },
    ];
    const result = buildAlignedLinesFromDetected(['A', 'B', 'C'], detected);
    expect(result).toHaveLength(3);
    expect(result[0].transcriptText).toBe('A');
    expect(result[1].transcriptText).toBe('B');
    expect(result[2].transcriptText).toBe('C');
    // Heights should be 30px each (90px total / 3)
    expect(result[0].bbox[1]).toBe(100);
    expect(result[0].bbox[3]).toBe(130);
    expect(result[1].bbox[1]).toBe(130);
    expect(result[1].bbox[3]).toBe(160);
    expect(result[2].bbox[1]).toBe(160);
    expect(result[2].bbox[3]).toBe(190);
  });

  it('sets correct visualLineIndex', () => {
    const detected: DetectedLine[] = [
      { y1: 10, y2: 70, x1: 5, x2: 100 },
    ];
    const result = buildAlignedLinesFromDetected(['A', 'B'], detected);
    expect(result[0].visualLineIndex).toBe(0);
    expect(result[1].visualLineIndex).toBe(1);
  });

  it('all lines share same x extents', () => {
    const detected: DetectedLine[] = [
      { y1: 0, y2: 60, x1: 42, x2: 358 },
    ];
    const result = buildAlignedLinesFromDetected(['X', 'Y'], detected);
    expect(result[0].bbox[0]).toBe(42);
    expect(result[0].bbox[2]).toBe(358);
    expect(result[1].bbox[0]).toBe(42);
    expect(result[1].bbox[2]).toBe(358);
  });

  it('generates baseline coordinates near bottom of each line', () => {
    const detected: DetectedLine[] = [
      { y1: 100, y2: 140, x1: 50, x2: 400 },
    ];
    const result = buildAlignedLinesFromDetected(['Test'], detected);
    expect(result[0].baseline).toHaveLength(2);
    expect(result[0].baseline[0][0]).toBe(50); // x1
    expect(result[0].baseline[1][0]).toBe(400); // x2
    // Baseline Y should be near bottom of bbox (80% of height)
    const expectedBaselineY = 140 - Math.round(40 * 0.2); // y2 - 20% of height
    expect(result[0].baseline[0][1]).toBe(expectedBaselineY);
  });

  it('single transcript line with single detected region maps directly', () => {
    const detected: DetectedLine[] = [{ y1: 50, y2: 80, x1: 10, x2: 400 }];
    const result = buildAlignedLinesFromDetected(['Only text'], detected);
    expect(result).toHaveLength(1);
    expect(result[0].transcriptText).toBe('Only text');
    expect(result[0].bbox).toEqual([10, 50, 400, 80]);
  });
});

// ============================================================================
// detectImageLines (with canvas mock)
// ============================================================================

describe('detectImageLines', () => {
  // Helper to create a mock image element with pixel data
  function createMockImageWithPixels(
    width: number,
    height: number,
    pixels: Uint8ClampedArray,
  ): HTMLImageElement {
    const img = document.createElement('img');
    Object.defineProperty(img, 'naturalWidth', { value: width });
    Object.defineProperty(img, 'naturalHeight', { value: height });

    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: pixels,
        width,
        height,
      }),
    };

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;

    (img as any).__restoreGetContext = () => {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    };

    return img;
  }

  function cleanup(img: HTMLImageElement) {
    (img as any).__restoreGetContext?.();
  }

  /**
   * Generate RGBA pixel data for a simple test image.
   * White background (255,255,255) with dark rows (30,30,30) for text lines.
   */
  function generateTestPixels(
    width: number,
    height: number,
    darkRows: { y1: number; y2: number; x1?: number; x2?: number }[],
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    // Fill with white
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;     // R
      data[i + 1] = 255; // G
      data[i + 2] = 255; // B
      data[i + 3] = 255; // A
    }
    // Paint dark rows
    for (const row of darkRows) {
      const x1 = row.x1 ?? 0;
      const x2 = row.x2 ?? width;
      for (let y = row.y1; y < Math.min(row.y2, height); y++) {
        for (let x = x1; x < Math.min(x2, width); x++) {
          const i = (y * width + x) * 4;
          data[i] = 30;     // R
          data[i + 1] = 30; // G
          data[i + 2] = 30; // B
          data[i + 3] = 255;
        }
      }
    }
    return data;
  }

  it('returns empty for zero-dimension image', () => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'naturalWidth', { value: 0 });
    Object.defineProperty(img, 'naturalHeight', { value: 0 });
    expect(detectImageLines(img)).toEqual([]);
  });

  it('returns single bounding box for text region', () => {
    const w = 200, h = 100;
    const pixels = generateTestPixels(w, h, [
      { y1: 40, y2: 60, x1: 20, x2: 180 },
    ]);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      expect(lines.length).toBe(1);
      expect(lines[0].y1).toBeLessThanOrEqual(40);
      expect(lines[0].y2).toBeGreaterThanOrEqual(59);
      expect(lines[0].x1).toBeLessThanOrEqual(21);
      expect(lines[0].x2).toBeGreaterThanOrEqual(179);
    } finally {
      cleanup(img);
    }
  });

  it('returns single bounding box spanning all text regions', () => {
    const w = 200, h = 300;
    const pixels = generateTestPixels(w, h, [
      { y1: 30, y2: 50, x1: 10, x2: 190 },   // line 1
      { y1: 80, y2: 100, x1: 15, x2: 185 },  // line 2
      { y1: 130, y2: 150, x1: 20, x2: 170 },  // line 3
    ]);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      // Should return a single bounding box covering all text
      expect(lines.length).toBe(1);
      expect(lines[0].y1).toBeLessThanOrEqual(30);  // top of first text
      expect(lines[0].y2).toBeGreaterThanOrEqual(149); // bottom of last text
      expect(lines[0].x1).toBeLessThanOrEqual(11);  // leftmost text
      expect(lines[0].x2).toBeGreaterThanOrEqual(189); // rightmost text
    } finally {
      cleanup(img);
    }
  });

  it('measures overall left/right extent across all text', () => {
    const w = 400, h = 200;
    const pixels = generateTestPixels(w, h, [
      { y1: 30, y2: 60, x1: 100, x2: 300 },
      { y1: 80, y2: 110, x1: 80, x2: 350 },
    ]);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      expect(lines.length).toBe(1);
      // x1 should be near 80 (leftmost across both), x2 near 350 (rightmost)
      expect(lines[0].x1).toBeLessThanOrEqual(81);
      expect(lines[0].x2).toBeGreaterThanOrEqual(349);
    } finally {
      cleanup(img);
    }
  });

  it('returns empty for image with no dark pixels', () => {
    const w = 200, h = 100;
    const pixels = generateTestPixels(w, h, []); // All white
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      expect(lines.length).toBe(0);
    } finally {
      cleanup(img);
    }
  });

  it('handles SecurityError from tainted canvas gracefully', () => {
    const img = document.createElement('img');
    Object.defineProperty(img, 'naturalWidth', { value: 200 });
    Object.defineProperty(img, 'naturalHeight', { value: 100 });

    const mockCtx = {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockImplementation(() => {
        throw new DOMException('Tainted canvas', 'SecurityError');
      }),
    };
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx) as any;

    try {
      const lines = detectImageLines(img);
      expect(lines).toEqual([]); // Should not throw, returns empty
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });
});
