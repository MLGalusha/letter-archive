// @vitest-environment jsdom

import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import LineReviewMode, {
  computeAutoScrollTop,
  type LineReviewModeHandle,
} from '../LineReviewMode';
import { detectPageLines } from '../../../api/admin/letters';
import { detectImageLines } from '../../../utils/lineAlignment';
import type { Letter } from '../../../types/Letter';

// Mock the client module
vi.mock('../../../api/client', () => ({
  getImageUrl: (url: string) => `http://test${url}`,
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

// Mock the detect-lines API call to resolve immediately with empty (triggers pixel fallback)
vi.mock('../../../api/admin/letters', () => ({
  detectPageLines: vi.fn().mockResolvedValue({ lineSegments: [], ocrWordBoxes: [] }),
}));

// Mock detectImageLines since jsdom can't do real pixel analysis
vi.mock('../../../utils/lineAlignment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/lineAlignment')>();
  return {
    ...actual,
    // Override detectImageLines to return per-line results (valley detection)
    detectImageLines: vi.fn(),
  };
});

vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

// jsdom doesn't implement scrollTo on elements
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    measureText: (text: string) => ({ width: text.length * 8 }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'test-letter-1',
    title: 'Test Letter',
    images: [
      {
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        originalFilename: 'page1.jpg',
      },
    ],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Line one\nLine two\nLine three' }],
      fullText: 'Line one\nLine two\nLine three',
      verified: false,
    },
    metadata: {
      verified: false,
    },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'AI_DRAFT',
    metadataContentStatus: 'EMPTY',
    extraContentStatus: 'EMPTY',
    flagged: false,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMultiPageLetter(): Letter {
  return makeLetter({
    images: [
      {
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        originalFilename: 'page1.jpg',
      },
      {
        id: 'page-2',
        type: 'letter',
        pageNumber: 2,
        imageUrl: '/images/page-2',
        originalFilename: 'page2.jpg',
      },
    ],
    transcript: {
      pages: [
        { pageNumber: 1, text: 'Page 1 line A\nPage 1 line B' },
        { pageNumber: 2, text: 'Page 2 line C\nPage 2 line D' },
      ],
      fullText: '--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D',
      verified: false,
    },
  });
}

// Simulate image load and flush async (API promise + rAF)
async function simulateImageLoadAsync(container: HTMLElement) {
  const img = container.querySelector('img');
  if (img) {
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 700, configurable: true });
    Object.defineProperty(img, 'clientWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'clientHeight', { value: 700, configurable: true });
    await act(async () => {
      fireEvent.load(img);
      // Flush the detectPageLines promise (microtask) + rAF pixel detection fallback
      await new Promise(r => setTimeout(r, 0));
    });
  }
}

function getEditable(container: HTMLElement): HTMLDivElement | null {
  return container.querySelector('.line-review-input-overlay .line-review-editable');
}

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LineReviewMode', () => {
  const detectPageLinesMock = vi.mocked(detectPageLines);
  const detectImageLinesMock = vi.mocked(detectImageLines);
  const defaultProps = {
    letter: makeLetter(),
    transcript: 'Line one\nLine two\nLine three',
    onTranscriptChange: vi.fn(),
    onExit: vi.fn(),
    onAutoSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    detectImageLinesMock.mockReturnValue([
      { y1: 100, y2: 135, x1: 50, x2: 450 },
      { y1: 140, y2: 175, x1: 55, x2: 445 },
      { y1: 180, y2: 215, x1: 50, x2: 450 },
    ]);
    // Reset requestAnimationFrame to run synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it('does not auto-detect when the page has no transcript yet', async () => {
    render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          transcript: {
            pages: [],
            fullText: '',
            verified: false,
          },
        })}
        transcript=""
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(detectPageLinesMock).not.toHaveBeenCalled();
  });

  it('uses stored line segments without auto-detecting again', async () => {
    render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          images: [
            {
              id: 'page-1',
              type: 'letter',
              pageNumber: 1,
              imageUrl: '/images/page-1',
              originalFilename: 'page1.jpg',
              lineSegments: [
                {
                  line: 1,
                  baseline: [[50, 135], [450, 135]],
                  bbox: [50, 100, 450, 135],
                  ocrText: '',
                  words: [],
                },
              ],
            },
          ],
        })}
      />,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(detectPageLinesMock).not.toHaveBeenCalled();
  });

  it('renders the image', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await flushEffects();
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toContain('http://test/images/page-1');
  });

  it('shows progress indicator', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);
    expect(container.querySelector('.line-review-progress')).toBeTruthy();
  });

  it('shows exit hint with Esc key', async () => {
    render(<LineReviewMode {...defaultProps} />);
    await flushEffects();
    expect(screen.getByText(/to exit/)).toBeTruthy();
  });

  it('calls onExit when Escape is pressed', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.onExit).toHaveBeenCalled();
  });

  it('shows detecting message before image loads', async () => {
    render(<LineReviewMode {...defaultProps} />);
    await flushEffects();
    // Before image loads, no lines should be detected
    // The "Detecting lines..." should not show until image has natural size
    // (since we check imageNaturalSize.width > 0)
    const analyzing = screen.queryByText('Detecting line positions...');
    // Before image load, natural size is 0, so this should NOT show
    expect(analyzing).toBeNull();
  });

  it('renders input overlay after pixel detection', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    expect(input?.textContent).toBe('Line one');
  });

  it('uses estimated layout fallback when pixel detection finds no lines', async () => {
    detectImageLinesMock.mockReturnValue([]);

    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    expect(input?.textContent).toBe('Line one');
    expect(screen.queryByText('Could not detect line positions for this page.')).toBeNull();
  });

  it('advances to next line on ArrowDown', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Initially on first line
    let input = getEditable(container);
    expect(input?.textContent).toBe('Line one');

    // Press ArrowDown
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    input = getEditable(container);
    expect(input?.textContent).toBe('Line two');
  });

  it('advances to next line on Enter', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    const input = getEditable(container);
    expect(input?.textContent).toBe('Line two');
  });

  it('goes to previous line on ArrowUp', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Go to line 2 first
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    // Then back to line 1
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });

    const input = getEditable(container);
    expect(input?.textContent).toBe('Line one');
  });

  it('does not go before first line', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Press ArrowUp on first line — should stay on first line
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });

    const input = getEditable(container);
    expect(input?.textContent).toBe('Line one');
  });

  it('does not trigger auto-save when navigating without edits', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    // No edits were made — save should NOT fire
    expect(defaultProps.onAutoSave).not.toHaveBeenCalled();
  });

  it('does not trigger onTranscriptChange when navigating without edits', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(defaultProps.onTranscriptChange).not.toHaveBeenCalled();
  });

  it('does not treat original transcript spacing as a review edit', async () => {
    const spacedTranscript = 'Line   one\nLine two\nLine three';
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          transcript: {
            pages: [{ pageNumber: 1, text: spacedTranscript }],
            fullText: spacedTranscript,
            verified: false,
          },
        })}
        transcript={spacedTranscript}
      />,
    );
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(defaultProps.onAutoSave).not.toHaveBeenCalled();
    expect(defaultProps.onTranscriptChange).not.toHaveBeenCalled();
  });

  it('saves edited text when navigating away', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Edit the current input
    const input = getEditable(container);
    expect(input).toBeTruthy();
    if (input) {
      input.textContent = 'Edited line one';
      fireEvent.input(input);
    }

    // Navigate away — should save
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    // The saved transcript should contain the edit
    expect(defaultProps.onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: expect.stringContaining('Edited line one'),
      }),
    );
  });

  it('flushes the edited line before unmount when saveCurrentLine is called', async () => {
    const onTranscriptChange = vi.fn();
    const onAutoSave = vi.fn();
    const ref = createRef<LineReviewModeHandle>();
    const { container, unmount } = render(
      <LineReviewMode
        {...defaultProps}
        ref={ref}
        onTranscriptChange={onTranscriptChange}
        onAutoSave={onAutoSave}
      />,
    );
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    if (input) {
      input.textContent = 'Exit save line';
      fireEvent.input(input);
    }

    act(() => {
      ref.current?.saveCurrentLine();
      unmount();
    });

    expect(onTranscriptChange).toHaveBeenCalledWith(
      expect.stringContaining('Exit save line'),
    );
    expect(onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: expect.stringContaining('Exit save line'),
      }),
    );
  });

  it('preserves original transcript spacing when saving a word edit', async () => {
    const spacedTranscript = 'Line   one\nLine two\nLine three';
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({
          transcript: {
            pages: [{ pageNumber: 1, text: spacedTranscript }],
            fullText: spacedTranscript,
            verified: false,
          },
        })}
        transcript={spacedTranscript}
      />,
    );
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    if (input) {
      input.textContent = 'Line revised';
      fireEvent.input(input);
    }

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    expect(defaultProps.onAutoSave).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionText: expect.stringContaining('Line   revised'),
      }),
    );
  });

  it('renders dimmer divs for highlighting', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    expect(container.querySelector('.line-review-highlight-svg')).toBeTruthy();
    expect(container.querySelector('.line-review-dimmer-fill')).toBeTruthy();
  });

  it('filters to letter-type pages only', async () => {
    const letterWithMixed = makeLetter({
      images: [
        { id: 'p1', type: 'letter', pageNumber: 1, imageUrl: '/images/p1' },
        { id: 'p2', type: 'photo', pageNumber: 2, imageUrl: '/images/p2' },
        { id: 'p3', type: 'cover', pageNumber: 3, imageUrl: '/images/p3' },
      ],
    });

    const { container } = render(
      <LineReviewMode {...defaultProps} letter={letterWithMixed} />,
    );
    await flushEffects();

    // Should only show the letter-type image, not photo or cover
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toContain('http://test/images/p1');
  });

  describe('multi-page navigation', () => {
    it('shows page count for multi-page letters', async () => {
      const { container } = render(
        <LineReviewMode
          {...defaultProps}
          letter={makeMultiPageLetter()}
          transcript="--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D"
        />,
      );
      await simulateImageLoadAsync(container);

      expect(container.textContent).toContain('Page 1 / 2');
    });

    it('does not show page count for single-page letters', async () => {
      const { container } = render(<LineReviewMode {...defaultProps} />);
      await simulateImageLoadAsync(container);

      expect(container.textContent).not.toContain('Page 1 / 2');
    });
  });

  describe('computeAutoScrollTop', () => {
    it('waits until the active line moves past the scroll threshold', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 3,
          movementDirection: 'down',
          currentScrollTop: 0,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 250,
          regionBottom: 340,
        }),
      ).toBeNull();
    });

    it('scrolls with a buffer once the active line passes the threshold', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 3,
          movementDirection: 'down',
          currentScrollTop: 0,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 320,
          regionBottom: 420,
        }),
      ).toBe(247);
    });

    it('stops scrolling once the container is already at the bottom', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 15,
          movementDirection: 'down',
          currentScrollTop: 800,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 1100,
          regionBottom: 1220,
        }),
      ).toBeNull();
    });

    it('scrolls back up when the active line moves above the top threshold', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 8,
          movementDirection: 'up',
          currentScrollTop: 500,
          viewportHeight: 600,
          contentHeight: 1600,
          regionTop: 650,
          regionBottom: 750,
        }),
      ).toBe(223);
    });

    it('returns to the top when navigating back to the first line', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 0,
          movementDirection: 'up',
          currentScrollTop: 120,
          viewportHeight: 600,
          contentHeight: 1400,
          regionTop: 30,
          regionBottom: 80,
        }),
      ).toBe(0);
    });

    it('does not trigger upward correction while moving down', () => {
      expect(
        computeAutoScrollTop({
          currentLineIndex: 8,
          movementDirection: 'down',
          currentScrollTop: 500,
          viewportHeight: 600,
          contentHeight: 1600,
          regionTop: 650,
          regionBottom: 750,
        }),
      ).toBeNull();
    });
  });
});
