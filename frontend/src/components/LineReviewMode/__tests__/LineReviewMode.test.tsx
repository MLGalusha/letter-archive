// @vitest-environment jsdom

import { createRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import LineReviewMode, { type LineReviewModeHandle } from '../LineReviewMode';
import { computeAutoScrollTop } from '../lineReviewUtils';
import {
  getPageLineSegments,
  savePageLineSegments,
  updateLetterSegmentTrust,
} from '../../../api/admin/letters';
import type { Letter } from '../../../types/Letter';

const { getImageUrlMock } = vi.hoisted(() => ({
  getImageUrlMock: vi.fn((url: string) => `http://test${url}`),
}));

// Mock the client module
vi.mock('../../../api/client', () => ({
  getImageUrl: getImageUrlMock,
  getErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

// Mock the segment fetch API call
vi.mock('../../../api/admin/letters', () => ({
  getPageLineSegments: vi.fn().mockResolvedValue([
    { line: 1, bbox: [50, 100, 450, 135], baseline: [[50, 135], [450, 135]], boundary: [{ x: 50, y: 100 }, { x: 450, y: 100 }, { x: 450, y: 135 }, { x: 50, y: 135 }] },
    { line: 2, bbox: [55, 140, 445, 175], baseline: [[55, 175], [445, 175]], boundary: [{ x: 55, y: 140 }, { x: 445, y: 140 }, { x: 445, y: 175 }, { x: 55, y: 175 }] },
    { line: 3, bbox: [50, 180, 450, 215], baseline: [[50, 215], [450, 215]], boundary: [{ x: 50, y: 180 }, { x: 450, y: 180 }, { x: 450, y: 215 }, { x: 50, y: 215 }] },
  ]),
  savePageLineSegments: vi.fn().mockResolvedValue(undefined),
  updateLetterSegmentTrust: vi.fn().mockResolvedValue(undefined),
}));


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
    primarySourceRevision: 0,
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

function makeSegmentTransitionLetter(): Letter {
  const makeSegments = () => [
    {
      line: 1,
      bbox: [50, 100, 450, 135] as [number, number, number, number],
      baseline: [[50, 135], [450, 135]],
      boundary: [
        { x: 50, y: 100 },
        { x: 450, y: 100 },
        { x: 450, y: 135 },
        { x: 50, y: 135 },
      ],
      ocrText: '',
      words: [],
    },
    {
      line: 2,
      bbox: [55, 140, 445, 175] as [number, number, number, number],
      baseline: [[55, 175], [445, 175]],
      boundary: [
        { x: 55, y: 140 },
        { x: 445, y: 140 },
        { x: 445, y: 175 },
        { x: 55, y: 175 },
      ],
      ocrText: '',
      words: [],
    },
  ];

  return makeLetter({
    primarySourceRevision: 9,
    images: [
      {
        id: 'page-1',
        type: 'letter',
        pageNumber: 1,
        imageUrl: '/images/page-1',
        originalFilename: 'page1.jpg',
        sourceChecksum: 'page-1-checksum',
        lineSegments: makeSegments(),
      },
      {
        id: 'page-2',
        type: 'letter',
        pageNumber: 2,
        imageUrl: '/images/page-2',
        originalFilename: 'page2.jpg',
        sourceChecksum: 'page-2-checksum',
        lineSegments: makeSegments(),
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

function deleteFirstVisibleSegment(container: HTMLElement) {
  const segment = container.querySelector(
    '.segment-editor-rect, .segment-editor-poly',
  );
  expect(segment).toBeTruthy();
  if (segment) {
    fireEvent.pointerDown(segment, { pointerId: 1 });
  }

  const deleteButton = container.querySelector<HTMLButtonElement>(
    '.segment-editor-toolbar-btn[data-hint="Delete (Del)"]',
  );
  expect(deleteButton).toBeTruthy();
  if (deleteButton) {
    fireEvent.click(deleteButton);
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  const getPageLineSegmentsMock = vi.mocked(getPageLineSegments);
  const savePageLineSegmentsMock = vi.mocked(savePageLineSegments);
  const updateLetterSegmentTrustMock = vi.mocked(updateLetterSegmentTrust);
  const defaultProps = {
    letter: makeLetter(),
    transcript: 'Line one\nLine two\nLine three',
    onTranscriptChange: vi.fn(),
    onExit: vi.fn(),
    onAutoSave: vi.fn(),
    handleMutationError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.handleMutationError.mockReturnValue(false);
    savePageLineSegmentsMock.mockReset().mockResolvedValue(undefined);
    updateLetterSegmentTrustMock.mockReset().mockResolvedValue(undefined);
    // Reset requestAnimationFrame to run synchronously
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  it('uses the cookie-authenticated image URL for a published orphan under review', async () => {
    render(
      <LineReviewMode
        {...defaultProps}
        letter={makeLetter({ visibility: 'PUBLISHED' })}
      />,
    );
    await flushEffects();

    expect(getImageUrlMock).toHaveBeenCalledWith('/images/page-1');
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

    expect(getPageLineSegmentsMock).not.toHaveBeenCalled();
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

    expect(getPageLineSegmentsMock).not.toHaveBeenCalled();
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

  it('renders an explicit close button', async () => {
    render(<LineReviewMode {...defaultProps} />);
    await flushEffects();

    expect(screen.getByRole('button', { name: 'Exit review mode' })).toBeTruthy();
  });

  it('calls onExit when the close button is pressed', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    fireEvent.click(screen.getByRole('button', { name: 'Exit review mode' }));
    await waitFor(() => {
      expect(defaultProps.onExit).toHaveBeenCalled();
    });
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

  it('renders input overlay with Kraken segments', async () => {
    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeTruthy();
    expect(input?.textContent).toBe('Line one');
  });

  it('does not verify segments when saving pending edits fails', async () => {
    savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
    const letter = makeLetter({
      primarySourceRevision: 7,
      images: [
        {
          id: 'page-1',
          type: 'letter',
          pageNumber: 1,
          imageUrl: '/images/page-1',
          originalFilename: 'page1.jpg',
          sourceChecksum: 'page-1-checksum',
          lineSegments: [
            {
              line: 1,
              bbox: [50, 100, 450, 135],
              baseline: [[50, 135], [450, 135]],
              ocrText: '',
              words: [],
            },
          ],
        },
      ],
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    const segment = container.querySelector('.segment-editor-rect');
    expect(segment).toBeTruthy();
    if (segment) {
      fireEvent.pointerDown(segment, { pointerId: 1 });
    }
    const deleteButton = container.querySelector<HTMLButtonElement>(
      '.segment-editor-toolbar-btn[data-hint="Delete (Del)"]',
    );
    expect(deleteButton).toBeTruthy();
    if (deleteButton) {
      fireEvent.click(deleteButton);
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      await Promise.resolve();
    });

    expect(savePageLineSegmentsMock).toHaveBeenCalledWith(
      'page-1',
      [],
      {
        primarySourceRevision: 7,
        sourceChecksum: 'page-1-checksum',
      },
    );
    expect(updateLetterSegmentTrustMock).not.toHaveBeenCalled();
  });

  it.each(['verify', 'unverify'] as const)(
    'applies a delayed letter-wide %s after navigating to another page',
    async action => {
      const pending = createDeferred<void>();
      updateLetterSegmentTrustMock.mockReturnValueOnce(pending.promise);
      const letter = makeSegmentTransitionLetter();
      if (action === 'unverify') letter.images.forEach(page => { page.segmentTrustState = 'trusted'; });
      const { container } = render(<LineReviewMode {...defaultProps} letter={letter} fullViewport />);
      await simulateImageLoadAsync(container);
      if (action === 'verify') fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
      else fireEvent.doubleClick(container.querySelector('.seg-lock-overlay')!);
      await waitFor(() => expect(updateLetterSegmentTrustMock).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() => expect(screen.getByAltText('Page 2')).toBeTruthy());
      await simulateImageLoadAsync(container);
      await act(async () => { pending.resolve(); await pending.promise; });
      expect(!!container.querySelector('.seg-lock-overlay')).toBe(action === 'verify');
      // Letter-wide completion must apply to the original page as well.
      fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
      await waitFor(() => expect(screen.getByAltText('Page 1')).toBeTruthy());
      expect(!!container.querySelector('.seg-lock-overlay')).toBe(action === 'verify');
    },
  );

  it.each([
    { action: 'verify', revoke: 'source' },
    { action: 'unverify', revoke: 'source' },
    { action: 'verify', revoke: 'block-cycle' },
    { action: 'unverify', revoke: 'block-cycle' },
  ] as const)('revokes a delayed $action after a $revoke change', async ({ action, revoke }) => {
    const pending = createDeferred<void>();
    updateLetterSegmentTrustMock.mockReturnValueOnce(pending.promise);
    const letter = makeSegmentTransitionLetter();
    if (action === 'unverify') letter.images.forEach(page => { page.segmentTrustState = 'trusted'; });
    const props = { ...defaultProps, letter, fullViewport: true };
    const { container, rerender } = render(<LineReviewMode {...props} />);
    await simulateImageLoadAsync(container);
    if (action === 'verify') fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    else fireEvent.doubleClick(container.querySelector('.seg-lock-overlay')!);
    await waitFor(() => expect(updateLetterSegmentTrustMock).toHaveBeenCalledTimes(1));
    if (revoke === 'source') {
      rerender(<LineReviewMode {...props} letter={{ ...letter, primarySourceRevision: 10 }} />);
      await simulateImageLoadAsync(container);
    } else {
      rerender(<LineReviewMode {...props} mutationsBlocked />);
      rerender(<LineReviewMode {...props} />);
    }
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(!!container.querySelector('.seg-lock-overlay')).toBe(action === 'unverify');
  });

  it('cancels a queued segment save when mutations become terminal', async () => {
    const letter = makeSegmentTransitionLetter();
    const { container, rerender } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    vi.useFakeTimers();
    try {
      deleteFirstVisibleSegment(container);
      rerender(
        <LineReviewMode
          {...defaultProps}
          letter={letter}
          fullViewport
          mutationsBlocked
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(savePageLineSegmentsMock).not.toHaveBeenCalled();
      expect(updateLetterSegmentTrustMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps segment edit mode, dirty state, and undo history when mode-exit save fails', async () => {
    savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeSegmentTransitionLetter()}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    deleteFirstVisibleSegment(container);
    const undoButton = container.querySelector<HTMLButtonElement>(
      '.segment-editor-toolbar-btn[data-hint="Undo (⌘Z)"]',
    );
    expect(undoButton?.disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Transcript' }));

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy();
    expect(
      container.querySelector<HTMLButtonElement>('.seg-editor-action-btn.danger')?.disabled,
    ).toBe(false);
    expect(undoButton?.disabled).toBe(false);

    if (undoButton) {
      fireEvent.click(undoButton);
    }
    expect(
      container.querySelectorAll('.segment-editor-rect, .segment-editor-poly'),
    ).toHaveLength(2);
  });

  it.each([
    {
      navigationLabel: 'Next page',
      initialPageIndex: 0,
      expectedPageNumber: 1,
      expectedPageId: 'page-1',
      expectedChecksum: 'page-1-checksum',
    },
    {
      navigationLabel: 'Previous page',
      initialPageIndex: 1,
      expectedPageNumber: 2,
      expectedPageId: 'page-2',
      expectedChecksum: 'page-2-checksum',
    },
  ])(
    'keeps the current page and dirty segment mode when $navigationLabel save fails',
    async ({
      navigationLabel,
      initialPageIndex,
      expectedPageNumber,
      expectedPageId,
      expectedChecksum,
    }) => {
      savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
      const { container } = render(
        <LineReviewMode
          {...defaultProps}
          letter={makeSegmentTransitionLetter()}
          transcript="--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D"
          initialPageIndex={initialPageIndex}
          fullViewport
        />,
      );
      await simulateImageLoadAsync(container);

      deleteFirstVisibleSegment(container);
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));

      await waitFor(() => {
        expect(savePageLineSegmentsMock).toHaveBeenCalledWith(
          expectedPageId,
          expect.any(Array),
          {
            primarySourceRevision: 9,
            sourceChecksum: expectedChecksum,
          },
        );
      });
      expect(defaultProps.handleMutationError).toHaveBeenCalledWith(
        expect.any(Error),
        'Failed to save segment edits',
      );
      expect(screen.getByAltText(`Page ${expectedPageNumber}`)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy();
      expect(
        container.querySelector<HTMLButtonElement>('.seg-editor-action-btn.danger')?.disabled,
      ).toBe(false);
    },
  );

  it('keeps the review open with dirty segment history when full-exit save fails', async () => {
    savePageLineSegmentsMock.mockRejectedValueOnce(new Error('source changed'));
    const onExit = vi.fn();
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={makeSegmentTransitionLetter()}
        onExit={onExit}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    deleteFirstVisibleSegment(container);
    fireEvent.click(screen.getByRole('button', { name: 'Exit review mode' }));

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
    });
    expect(defaultProps.handleMutationError).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to save segment edits',
    );
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Transcript' })).toBeTruthy();
    expect(
      container.querySelector<HTMLButtonElement>(
        '.segment-editor-toolbar-btn[data-hint="Undo (⌘Z)"]',
      )?.disabled,
    ).toBe(false);
  });

  it.each([
    {
      navigationLabel: 'Next page',
      initialPageIndex: 0,
      initialPageNumber: 1,
      destinationPageNumber: 2,
      sourcePageId: 'page-1',
      sourceChecksum: 'page-1-checksum',
    },
    {
      navigationLabel: 'Previous page',
      initialPageIndex: 1,
      initialPageNumber: 2,
      destinationPageNumber: 1,
      sourcePageId: 'page-2',
      sourceChecksum: 'page-2-checksum',
    },
  ])(
    'flushes edits made during a slow save before $navigationLabel navigation',
    async ({
      navigationLabel,
      initialPageIndex,
      initialPageNumber,
      destinationPageNumber,
      sourcePageId,
      sourceChecksum,
    }) => {
      const firstSave = createDeferred<void>();
      const secondSave = createDeferred<void>();
      savePageLineSegmentsMock
        .mockImplementationOnce(() => firstSave.promise)
        .mockImplementationOnce(() => secondSave.promise);
      const { container } = render(
        <LineReviewMode
          {...defaultProps}
          letter={makeSegmentTransitionLetter()}
          transcript="--- Page 1 ---\n\nPage 1 line A\nPage 1 line B\n\n--- Page 2 ---\n\nPage 2 line C\nPage 2 line D"
          initialPageIndex={initialPageIndex}
          fullViewport
        />,
      );
      await simulateImageLoadAsync(container);

      deleteFirstVisibleSegment(container);
      fireEvent.click(screen.getByRole('button', { name: navigationLabel }));

      await waitFor(() => {
        expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByAltText(`Page ${initialPageNumber}`)).toBeTruthy();

      // The first request contains the first edit. Make a second edit before
      // it resolves; this newer snapshot must be saved before navigation.
      expect(savePageLineSegmentsMock.mock.calls[0]?.[1]).toHaveLength(1);
      deleteFirstVisibleSegment(container);

      await act(async () => {
        firstSave.resolve();
        await firstSave.promise;
      });
      await waitFor(() => {
        expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(2);
      });
      expect(savePageLineSegmentsMock).toHaveBeenLastCalledWith(
        sourcePageId,
        [],
        {
          primarySourceRevision: 9,
          sourceChecksum,
        },
      );
      expect(screen.getByAltText(`Page ${initialPageNumber}`)).toBeTruthy();

      await act(async () => {
        secondSave.resolve();
        await secondSave.promise;
      });
      await waitFor(() => {
        expect(screen.getByAltText(`Page ${destinationPageNumber}`)).toBeTruthy();
      });
    },
  );

  it('keeps a failed segment mapping active and retryable until it saves', async () => {
    savePageLineSegmentsMock
      .mockRejectedValueOnce(new Error('source changed'))
      .mockResolvedValueOnce(undefined);
    const onMappingComplete = vi.fn();
    const letter = makeLetter({
      primarySourceRevision: 7,
      images: [
        {
          id: 'page-1',
          type: 'letter',
          pageNumber: 1,
          imageUrl: '/images/page-1',
          originalFilename: 'page1.jpg',
          sourceChecksum: 'page-1-checksum',
          lineSegments: [
            {
              line: 1,
              bbox: [50, 100, 450, 135],
              baseline: [[50, 135], [450, 135]],
              ocrText: '',
              words: [],
              segmentClass: 'continuation',
              isMapped: false,
            },
          ],
        },
      ],
    });
    const { container } = render(
      <LineReviewMode
        {...defaultProps}
        letter={letter}
        mappingText="Mapped continuation"
        onMappingComplete={onMappingComplete}
        fullViewport
      />,
    );
    await simulateImageLoadAsync(container);

    const firstTarget = container.querySelector('.segment-editor-rect.seg-mappable');
    expect(firstTarget).toBeTruthy();
    if (firstTarget) {
      fireEvent.pointerDown(firstTarget, { pointerId: 1 });
    }

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1);
    });
    expect(savePageLineSegmentsMock).toHaveBeenLastCalledWith(
      'page-1',
      expect.arrayContaining([
        expect.objectContaining({
          isMapped: true,
          mappedText: 'Mapped continuation',
        }),
      ]),
      {
        primarySourceRevision: 7,
        sourceChecksum: 'page-1-checksum',
      },
    );
    expect(screen.getByText('Map to segment:')).toBeTruthy();
    expect(onMappingComplete).not.toHaveBeenCalled();
    expect(defaultProps.handleMutationError).toHaveBeenCalledWith(
      expect.any(Error),
      'Failed to save segment mapping',
    );

    const retryTarget = container.querySelector('.segment-editor-rect');
    expect(retryTarget).toBeTruthy();
    if (retryTarget) {
      fireEvent.pointerDown(retryTarget, { pointerId: 2 });
    }

    await waitFor(() => {
      expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(2);
      expect(onMappingComplete).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Map to segment:')).toBeNull();
  });

  it('preserves an edited draft and history across an ordinary letter refresh', async () => {
    const letter = makeSegmentTransitionLetter();
    const props = { ...defaultProps, letter, fullViewport: true };
    const { container, rerender } = render(<LineReviewMode {...props} />);
    await simulateImageLoadAsync(container);
    deleteFirstVisibleSegment(container);
    rerender(<LineReviewMode {...props} letter={{ ...letter, flagged: true, images: letter.images.map(page => ({ ...page })) }} />);
    expect(container.querySelectorAll('.segment-editor-rect, .segment-editor-poly')).toHaveLength(1);
    expect(container.querySelector('button[data-hint^="Undo"]')).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1));
    expect(savePageLineSegmentsMock.mock.calls[0][1]).toHaveLength(1);
    await waitFor(() => expect(screen.getByAltText('Page 2')).toBeTruthy());
  });

  it.each(['letter', 'revision', 'checksum', 'page'] as const)(
    'revokes an old save and exit when the %s identity changes at the same page index',
    async identity => {
      const oldSave = createDeferred<void>();
      savePageLineSegmentsMock.mockImplementationOnce(() => oldSave.promise);
      const letter = makeSegmentTransitionLetter();
      const props = { ...defaultProps, letter, fullViewport: true };
      const { container, rerender } = render(<LineReviewMode {...props} />);
      await simulateImageLoadAsync(container);
      deleteFirstVisibleSegment(container);
      fireEvent.click(screen.getByRole('button', { name: 'Exit review mode' }));
      await waitFor(() => expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1));
      const replacement = {
        ...letter,
        id: identity === 'letter' ? 'replacement-letter' : letter.id,
        primarySourceRevision: identity === 'revision' ? 10 : letter.primarySourceRevision,
        images: letter.images.map((page, index) => index ? page : {
          ...page,
          id: identity === 'page' ? 'replacement-page' : page.id,
          sourceChecksum: identity === 'checksum' ? 'replacement-checksum' : page.sourceChecksum,
        }),
      };
      rerender(<LineReviewMode {...props} letter={replacement} />);
      await simulateImageLoadAsync(container);
      expect(container.querySelectorAll('.segment-editor-rect, .segment-editor-poly')).toHaveLength(2);
      deleteFirstVisibleSegment(container);
      await act(async () => { oldSave.resolve(); await oldSave.promise; });
      expect(defaultProps.onExit).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await waitFor(() => expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(2));
      expect(savePageLineSegmentsMock).toHaveBeenLastCalledWith(replacement.images[0].id, expect.any(Array), {
        primarySourceRevision: replacement.primarySourceRevision,
        sourceChecksum: replacement.images[0].sourceChecksum,
      });
      expect(savePageLineSegmentsMock.mock.calls[1][1]).toHaveLength(1);
    },
  );

  it('does not verify or clean a pending draft after mutations become blocked', async () => {
    const pending = createDeferred<void>();
    savePageLineSegmentsMock.mockImplementationOnce(() => pending.promise);
    const props = { ...defaultProps, letter: makeSegmentTransitionLetter(), fullViewport: true };
    const { container, rerender } = render(<LineReviewMode {...props} />);
    await simulateImageLoadAsync(container);
    deleteFirstVisibleSegment(container);
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1));
    rerender(<LineReviewMode {...props} mutationsBlocked />);
    await act(async () => { pending.resolve(); await pending.promise; });
    expect(updateLetterSegmentTrustMock).not.toHaveBeenCalled();
    rerender(<LineReviewMode {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(2));
  });

  it('waits for edits made during mapping before completing the mapping', async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    savePageLineSegmentsMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const letter = makeSegmentTransitionLetter();
    letter.images[0].lineSegments![0].segmentClass = 'continuation';
    const complete = vi.fn();
    const { container } = render(<LineReviewMode {...defaultProps} letter={letter} fullViewport mappingText="Mapped text" onMappingComplete={complete} />);
    await simulateImageLoadAsync(container);
    fireEvent.pointerDown(container.querySelector('.seg-mappable')!, { pointerId: 1 });
    await waitFor(() => expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(1));
    // Undo is a real newer edit during the pending mapping request.
    fireEvent.click(container.querySelector('button[data-hint^="Undo"]')!);
    await act(async () => { first.resolve(); await first.promise; });
    await waitFor(() => expect(savePageLineSegmentsMock).toHaveBeenCalledTimes(2));
    expect(savePageLineSegmentsMock.mock.calls[1][1][0].mappedText).toBeUndefined();
    expect(complete).not.toHaveBeenCalled();
    expect(screen.getByText('Map to segment:')).toBeTruthy();
    await act(async () => { second.resolve(); await second.promise; });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('shows no lines when Kraken returns empty segments', async () => {
    getPageLineSegmentsMock.mockResolvedValueOnce([]);

    const { container } = render(<LineReviewMode {...defaultProps} />);
    await simulateImageLoadAsync(container);

    const input = getEditable(container);
    expect(input).toBeNull();
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
