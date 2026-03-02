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

  it('1:1 mapping preserves transcript order', () => {
    const segments = [makeSegment(1, 'Hello'), makeSegment(2, 'World')];
    const result = alignTranscriptToVisualLines('Hello\nWorld', segments);
    expect(result).toHaveLength(2);
    expect(result[0].transcriptText).toBe('Hello');
    expect(result[0].visualLineIndex).toBe(0);
    expect(result[1].transcriptText).toBe('World');
    expect(result[1].visualLineIndex).toBe(1);
  });

  it('never reorders transcript lines regardless of OCR text', () => {
    const segments = [
      makeSegment(1, 'World'),
      makeSegment(2, 'Hello'),
    ];
    const result = alignTranscriptToVisualLines('Hello\nWorld', segments);
    expect(result).toHaveLength(2);
    expect(result[0].transcriptText).toBe('Hello');
    expect(result[1].transcriptText).toBe('World');
  });

  it('more segments than transcript — distributes in order, extras empty', () => {
    const segments = [makeSegment(1), makeSegment(2), makeSegment(3)];
    const result = alignTranscriptToVisualLines('Line A\nLine B', segments);
    expect(result).toHaveLength(3);
    const texts = result.map(r => r.transcriptText);
    expect(texts.filter(t => t !== '')).toEqual(['Line A', 'Line B']);
  });

  it('fewer segments than transcript — subdivides segments in order', () => {
    const segments = [makeSegment(1)];
    const result = alignTranscriptToVisualLines('Hello\nWorld\nFoo', segments);
    expect(result).toHaveLength(3);
    expect(result[0].transcriptText).toBe('Hello');
    expect(result[1].transcriptText).toBe('World');
    expect(result[2].transcriptText).toBe('Foo');
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

  it('1:1 mapping uses constant width across all lines', () => {
    const detected: DetectedLine[] = [
      { y1: 100, y2: 130, x1: 50, x2: 450 },
      { y1: 140, y2: 170, x1: 60, x2: 440 },
      { y1: 180, y2: 210, x1: 55, x2: 445 },
    ];
    const lines = ['First line', 'Second line', 'Third line'];
    const result = buildAlignedLinesFromDetected(lines, detected);

    expect(result).toHaveLength(3);
    expect(result[0].transcriptText).toBe('First line');
    expect(result[1].transcriptText).toBe('Second line');
    expect(result[2].transcriptText).toBe('Third line');
    // All lines should use constant x extents (min x1=50, max x2=450)
    for (const line of result) {
      expect(line.bbox[0]).toBe(50);
      expect(line.bbox[2]).toBe(450);
    }
  });

  it('more detected than transcript — all lines within single band', () => {
    // Three close-together detected lines form one band, 1 transcript line
    const detected: DetectedLine[] = [
      { y1: 100, y2: 130, x1: 50, x2: 400 },
      { y1: 140, y2: 170, x1: 50, x2: 400 },
      { y1: 180, y2: 210, x1: 50, x2: 400 },
    ];
    const result = buildAlignedLinesFromDetected(['Only line'], detected);
    // Single transcript line gets the whole band
    expect(result).toHaveLength(1);
    expect(result[0].transcriptText).toBe('Only line');
    expect(result[0].bbox[0]).toBe(50);
    expect(result[0].bbox[2]).toBe(400);
    expect(result[0].bbox[1]).toBe(100);
    expect(result[0].bbox[3]).toBe(210);
  });

  it('fewer detected than transcript — subdivides band evenly', () => {
    const detected: DetectedLine[] = [
      { y1: 100, y2: 200, x1: 50, x2: 400 },
    ];
    const result = buildAlignedLinesFromDetected(['A', 'B', 'C'], detected);
    expect(result).toHaveLength(3);
    expect(result[0].transcriptText).toBe('A');
    expect(result[1].transcriptText).toBe('B');
    expect(result[2].transcriptText).toBe('C');
    // Each line ~33px height in the 100px region
    expect(result[0].bbox[1]).toBe(100);
    expect(result[0].bbox[3]).toBe(133);
    expect(result[2].bbox[3]).toBe(200);
    // Constant width
    for (const line of result) {
      expect(line.bbox[0]).toBe(50);
      expect(line.bbox[2]).toBe(400);
    }
  });

  it('sets correct visualLineIndex', () => {
    const detected: DetectedLine[] = [
      { y1: 10, y2: 30, x1: 5, x2: 100 },
      { y1: 35, y2: 55, x1: 5, x2: 100 },
    ];
    const result = buildAlignedLinesFromDetected(['A', 'B'], detected);
    expect(result[0].visualLineIndex).toBe(0);
    expect(result[1].visualLineIndex).toBe(1);
  });

  it('generates baseline coordinates near bottom of each line', () => {
    const detected: DetectedLine[] = [
      { y1: 100, y2: 140, x1: 50, x2: 400 },
    ];
    const result = buildAlignedLinesFromDetected(['Test'], detected);
    expect(result[0].baseline).toHaveLength(2);
    // Uses constant width extents
    expect(result[0].baseline[0][0]).toBe(50);
    expect(result[0].baseline[1][0]).toBe(400);
    const expectedBaselineY = 140 - Math.round(40 * 0.2);
    expect(result[0].baseline[0][1]).toBe(expectedBaselineY);
  });

  it('uses constant x extents (min x1, max x2) across all lines', () => {
    const detected: DetectedLine[] = [
      { y1: 10, y2: 30, x1: 120, x2: 380 },
    ];
    const result = buildAlignedLinesFromDetected(['Only line'], detected);
    expect(result[0].bbox[0]).toBe(120);
    expect(result[0].bbox[2]).toBe(380);
  });

  it('handles paragraph gaps — lines skip over gaps between bands', () => {
    // Two bands separated by a large gap
    const detected: DetectedLine[] = [
      { y1: 100, y2: 200, x1: 50, x2: 400 },  // Band 1 (100px tall)
      // Gap from 200-400
      { y1: 400, y2: 500, x1: 60, x2: 390 },  // Band 2 (100px tall)
    ];
    const lines = ['Line 1', 'Line 2', 'Line 3', 'Line 4'];
    const result = buildAlignedLinesFromDetected(lines, detected);

    expect(result).toHaveLength(4);
    // Lines should be split between the two bands (2 each since equal height)
    // Band 1 lines should be within y 100-200
    expect(result[0].bbox[1]).toBeGreaterThanOrEqual(100);
    expect(result[0].bbox[3]).toBeLessThanOrEqual(200);
    expect(result[1].bbox[1]).toBeGreaterThanOrEqual(100);
    expect(result[1].bbox[3]).toBeLessThanOrEqual(200);
    // Band 2 lines should be within y 400-500
    expect(result[2].bbox[1]).toBeGreaterThanOrEqual(400);
    expect(result[2].bbox[3]).toBeLessThanOrEqual(500);
    expect(result[3].bbox[1]).toBeGreaterThanOrEqual(400);
    expect(result[3].bbox[3]).toBeLessThanOrEqual(500);
    // Constant width (min x1=50, max x2=400)
    for (const line of result) {
      expect(line.bbox[0]).toBe(50);
      expect(line.bbox[2]).toBe(400);
    }
  });
});

// ============================================================================
// detectImageLines — valley detection (with canvas mock)
// ============================================================================

describe('detectImageLines', () => {
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
   * Generate RGBA pixel data for a test image.
   * White background with dark rows for text lines.
   */
  function generateTestPixels(
    width: number,
    height: number,
    darkRows: { y1: number; y2: number; x1?: number; x2?: number }[],
  ): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    for (const row of darkRows) {
      const x1 = row.x1 ?? 0;
      const x2 = row.x2 ?? width;
      for (let y = row.y1; y < Math.min(row.y2, height); y++) {
        for (let x = x1; x < Math.min(x2, width); x++) {
          const i = (y * width + x) * 4;
          data[i] = 30;
          data[i + 1] = 30;
          data[i + 2] = 30;
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

  it('detects a single text line', () => {
    const w = 200, h = 100;
    const pixels = generateTestPixels(w, h, [
      { y1: 40, y2: 60, x1: 20, x2: 180 },
    ]);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      expect(lines.length).toBe(1);
      expect(lines[0].y1).toBeLessThanOrEqual(41);
      expect(lines[0].y2).toBeGreaterThanOrEqual(59);
      expect(lines[0].x1).toBeLessThanOrEqual(21);
      expect(lines[0].x2).toBeGreaterThanOrEqual(179);
    } finally {
      cleanup(img);
    }
  });

  it('detects multiple lines separated by clear gaps', () => {
    const w = 200, h = 300;
    // Three lines with clear whitespace gaps between them
    const pixels = generateTestPixels(w, h, [
      { y1: 30, y2: 50, x1: 10, x2: 190 },
      { y1: 100, y2: 120, x1: 15, x2: 185 },
      { y1: 170, y2: 190, x1: 20, x2: 170 },
    ]);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      expect(lines.length).toBe(3);
      // Lines should be in top-to-bottom order
      expect(lines[0].y1).toBeLessThan(lines[1].y1);
      expect(lines[1].y1).toBeLessThan(lines[2].y1);
    } finally {
      cleanup(img);
    }
  });

  it('measures per-line x extents', () => {
    const w = 400, h = 200;
    const pixels = generateTestPixels(w, h, [
      { y1: 30, y2: 60, x1: 100, x2: 300 },
      { y1: 100, y2: 130, x1: 50, x2: 350 },
    ]);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      expect(lines.length).toBe(2);
      // First line: narrower
      expect(lines[0].x1).toBeLessThanOrEqual(101);
      expect(lines[0].x2).toBeGreaterThanOrEqual(299);
      // Second line: wider
      expect(lines[1].x1).toBeLessThanOrEqual(51);
      expect(lines[1].x2).toBeGreaterThanOrEqual(349);
    } finally {
      cleanup(img);
    }
  });

  it('returns empty for image with no dark pixels', () => {
    const w = 200, h = 100;
    const pixels = generateTestPixels(w, h, []);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      expect(detectImageLines(img).length).toBe(0);
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
      expect(detectImageLines(img)).toEqual([]);
    } finally {
      HTMLCanvasElement.prototype.getContext = origGetContext;
    }
  });

  it('handles paragraph gaps — lines on either side detected separately', () => {
    const w = 200, h = 600;
    // Two lines with clear gap between them, then a big paragraph gap, then two more
    const pixels = generateTestPixels(w, h, [
      { y1: 30, y2: 60, x1: 10, x2: 190 },
      { y1: 100, y2: 130, x1: 10, x2: 190 },
      // Big paragraph gap (130-400)
      { y1: 400, y2: 430, x1: 10, x2: 190 },
      { y1: 470, y2: 500, x1: 10, x2: 190 },
    ]);
    const img = createMockImageWithPixels(w, h, pixels);
    try {
      const lines = detectImageLines(img);
      expect(lines.length).toBe(4);
      // Lines should be in order, and the gap between line 2 and 3 means
      // there's a significant Y distance between their centers
      const center2 = (lines[1].y1 + lines[1].y2) / 2;
      const center3 = (lines[2].y1 + lines[2].y2) / 2;
      const center1 = (lines[0].y1 + lines[0].y2) / 2;
      const normalSpacing = center2 - center1;
      // The paragraph gap should create a larger spacing than between adjacent lines
      expect(center3 - center2).toBeGreaterThan(normalSpacing * 2);
    } finally {
      cleanup(img);
    }
  });
});
