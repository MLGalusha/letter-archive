import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LineReviewMode from '../LineReviewMode';
import type { Letter } from '../../../types/Letter';

// Mock the client module
vi.mock('../../../api/client', () => ({
  getImageUrl: (url: string) => `http://test${url}`,
}));

// Mock the detect-lines API call to resolve immediately with empty (triggers pixel fallback)
vi.mock('../../../api/admin/letters', () => ({
  detectPageLines: vi.fn().mockResolvedValue({ lineSegments: [] }),
}));

// Mock detectImageLines since jsdom can't do real pixel analysis
vi.mock('../../../utils/lineAlignment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/lineAlignment')>();
  return {
    ...actual,
    // Override detectImageLines to return per-line results (valley detection)
    detectImageLines: vi.fn().mockReturnValue([
      { y1: 100, y2: 135, x1: 50, x2: 450 },
      { y1: 140, y2: 175, x1: 55, x2: 445 },
      { y1: 180, y2: 215, x1: 50, x2: 450 },
    ]),
  };
});

// jsdom doesn't implement scrollTo on elements
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
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
    transcriptStatus: 'AI_DRAFT',
    metadataContentStatus: 'EMPTY',
    extraContentStatus: 'EMPTY',
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

describe('LineReviewMode', () => {
  const defaultProps = {
    letter: makeLetter(),
    transcript: 'Line one\nLine two\nLine three',
    onTranscriptChange: vi.fn(),
    onExit: vi.fn(),
    onAutoSave: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset requestAnimationFrame to run synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it('renders the image', () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toContain('http://test/images/page-1');
  });

  it('shows progress indicator', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);
    expect(screen.getByText(/Line/)).toBeTruthy();
  });

  it('shows exit hint with Esc key', () => {
    render(<LineReviewMode {...defaultProps} />);
    expect(screen.getByText('to exit')).toBeTruthy();
  });

  it('calls onExit when Escape is pressed', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.onExit).toHaveBeenCalled();
  });

  it('shows detecting message before image loads', () => {
    render(<LineReviewMode {...defaultProps} />);
    // Before image loads, no lines should be detected
    // The "Detecting lines..." should not show until image has natural size
    // (since we check imageNaturalSize.width > 0)
    const analyzing = screen.queryByText('Detecting lines...');
    // Before image load, natural size is 0, so this should NOT show
    expect(analyzing).toBeNull();
  });

  it('renders input overlay after pixel detection', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const input = container.querySelector('.line-review-input-overlay input');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement)?.value).toBe('Line one');
  });

  it('advances to next line on ArrowDown', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Initially on first line
    let input = container.querySelector('.line-review-input-overlay input') as HTMLInputElement;
    expect(input?.value).toBe('Line one');

    // Press ArrowDown
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });

    input = container.querySelector('.line-review-input-overlay input') as HTMLInputElement;
    expect(input?.value).toBe('Line two');
  });

  it('advances to next line on Enter', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    const input = container.querySelector('.line-review-input-overlay input') as HTMLInputElement;
    expect(input?.value).toBe('Line two');
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

    const input = container.querySelector('.line-review-input-overlay input') as HTMLInputElement;
    expect(input?.value).toBe('Line one');
  });

  it('does not go before first line', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Press ArrowUp on first line — should stay on first line
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });

    const input = container.querySelector('.line-review-input-overlay input') as HTMLInputElement;
    expect(input?.value).toBe('Line one');
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

  it('saves edited text when navigating away', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    // Edit the current input
    const input = container.querySelector('.line-review-input-overlay input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Edited line one' } });

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

  it('renders dimmer divs for highlighting', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const dimmers = container.querySelectorAll('.line-review-dimmer');
    // Should have top and bottom dimmers
    expect(dimmers.length).toBeGreaterThanOrEqual(1);
  });

  it('filters to letter-type pages only', () => {
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

      expect(screen.getByText(/Page 1 \/ 2/)).toBeTruthy();
    });

    it('does not show page count for single-page letters', async () => {
      const { container } = render(<LineReviewMode {...defaultProps} />);
      await simulateImageLoadAsync(container);

      expect(screen.queryByText(/Page.*\//)).toBeNull();
    });
  });
});
