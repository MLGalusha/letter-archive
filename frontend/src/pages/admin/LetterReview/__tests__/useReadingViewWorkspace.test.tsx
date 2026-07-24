import { act, renderHook } from '@testing-library/react';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Letter } from '../../../../types/Letter';
import type { ExecuteLetterReviewMutation } from '../useLetterReviewMutationExecutor';
import type { LetterReviewVisit } from '../useLetterReviewVisit';
import { useReadingViewWorkspace } from '../useReadingViewWorkspace';

const {
  generateReadingViewMock,
  showToastMock,
} = vi.hoisted(() => ({
  generateReadingViewMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  generateReadingView: generateReadingViewMock,
}));

vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-a',
    title: 'Letter A',
    primarySourceRevision: 3,
    images: [{
      id: 'page-a',
      type: 'letter',
      pageNumber: 1,
      imageUrl: '/letter-a.jpg',
    }],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Raw A transcript' }],
      fullText: 'Raw A transcript',
      verified: false,
    },
    metadata: { verified: false },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EDITED',
    metadataContentStatus: 'EDITED',
    extraContentStatus: 'EMPTY',
    readingText: 'Reading A',
    createdAt: '2026-07-24T12:00:00.000Z',
    flagged: false,
    ...overrides,
  };
}

function visit(
  letterId: string,
  active: { current: boolean },
): LetterReviewVisit {
  return {
    letterId,
    isActive: () => active.current,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function adoptingExecutor(): ExecuteLetterReviewMutation {
  return vi.fn(async (mutation) => {
    const updated = await mutation.request();
    mutation.afterAdopt?.(updated);
  });
}

describe('useReadingViewWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('preserves one visit but resets mode and text across A to B to fresh A', () => {
    const firstAActive = { current: true };
    const bActive = { current: false };
    const freshAActive = { current: false };
    const visits = {
      firstA: visit('letter-a', firstAActive),
      b: visit('letter-b', bActive),
      freshA: visit('letter-a', freshAActive),
    };
    const executeLetterMutation = adoptingExecutor();
    const { result, rerender } = renderHook(
      ({ letter, currentVisit }) => useReadingViewWorkspace({
        visit: currentVisit,
        letter,
        transcriptText: letter.transcript.fullText,
        surfaceActive: true,
        executeLetterMutation,
      }),
      {
        initialProps: {
          letter: makeLetter(),
          currentVisit: visits.firstA,
        },
      },
    );

    act(() => {
      result.current.sectionProps.onReadingViewOpenChange(true);
    });
    expect(result.current.readingViewOpen).toBe(true);
    expect(result.current.sectionProps.readerText).toBe('Reading A');

    rerender({
      letter: makeLetter({
        readingText: 'Updated reading A',
      }),
      currentVisit: visits.firstA,
    });
    expect(result.current.readingViewOpen).toBe(true);
    expect(result.current.sectionProps.readerText).toBe('Updated reading A');

    rerender({
      letter: makeLetter({
        readingText: undefined,
      }),
      currentVisit: visits.firstA,
    });
    expect(result.current.readingViewOpen).toBe(true);
    expect(result.current.sectionProps.readerText).toBe('');

    const staleOpen = result.current.sectionProps.onReadingViewOpenChange;
    firstAActive.current = false;
    bActive.current = true;
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        title: 'Letter B',
        readingText: undefined,
      }),
      currentVisit: visits.b,
    });

    expect(result.current.readingViewOpen).toBe(false);
    expect(result.current.sectionProps.readerText).toBe('');
    act(() => {
      staleOpen(true);
    });
    expect(result.current.readingViewOpen).toBe(false);

    act(() => {
      result.current.sectionProps.onReadingViewOpenChange(true);
    });
    expect(result.current.readingViewOpen).toBe(true);
    act(() => {
      staleOpen(false);
    });
    expect(result.current.readingViewOpen).toBe(true);

    bActive.current = false;
    freshAActive.current = true;
    rerender({
      letter: makeLetter({ readingText: 'Fresh reading A' }),
      currentVisit: visits.freshA,
    });
    expect(result.current.readingViewOpen).toBe(false);
    expect(result.current.sectionProps.readerText).toBe('Fresh reading A');
  });

  it('owns the exact generation request, progress, adoption, and success', async () => {
    const pending = deferred<Letter>();
    const updated = makeLetter({
      readingText: 'Generated reading A',
    });
    generateReadingViewMock.mockReturnValue(pending.promise);
    const executeLetterMutation = adoptingExecutor();
    const currentVisit = visit('letter-a', { current: true });
    const { result, rerender } = renderHook(
      ({ letter }) => useReadingViewWorkspace({
        visit: currentVisit,
        letter,
        transcriptText: letter.transcript.fullText,
        surfaceActive: true,
        executeLetterMutation,
      }),
      { initialProps: { letter: makeLetter({ readingText: undefined }) } },
    );

    let generation!: Promise<boolean>;
    await act(async () => {
      generation = result.current.generate();
      await Promise.resolve();
    });
    expect(result.current.sectionProps.readingViewGenerating).toBe(true);

    let accepted = false;
    await act(async () => {
      pending.resolve(updated);
      accepted = await generation;
    });

    expect(accepted).toBe(true);
    expect(generateReadingViewMock).toHaveBeenCalledWith('letter-a', 3);
    expect(result.current.sectionProps.readingViewGenerating).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith(
      'Reading view generated',
      'success',
    );

    rerender({ letter: updated });
    expect(result.current.sectionProps.readerText).toBe(
      'Generated reading A',
    );
  });

  it('cleans up progress without reporting a request failure as success', async () => {
    const pending = deferred<Letter>();
    generateReadingViewMock.mockReturnValue(pending.promise);
    const executeLetterMutation: ExecuteLetterReviewMutation =
      vi.fn(async (mutation) => {
        try {
          await mutation.request();
        } catch {
          // The production executor owns request-failure reporting.
        }
      });
    const currentVisit = visit('letter-a', { current: true });
    const { result } = renderHook(() => useReadingViewWorkspace({
      visit: currentVisit,
      letter: makeLetter({ readingText: undefined }),
      transcriptText: 'Raw A transcript',
      surfaceActive: true,
      executeLetterMutation,
    }));

    let generation!: Promise<boolean>;
    await act(async () => {
      generation = result.current.generate();
      await Promise.resolve();
    });
    expect(result.current.sectionProps.readingViewGenerating).toBe(true);

    let accepted = true;
    await act(async () => {
      pending.reject(new Error('generation failed'));
      accepted = await generation;
    });

    expect(accepted).toBe(false);
    expect(result.current.sectionProps.readerText).toBe('');
    expect(result.current.sectionProps.readingViewGenerating).toBe(false);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('keeps a late first-A completion inert during a fresh A visit', async () => {
    const pending = deferred<Letter>();
    generateReadingViewMock.mockReturnValue(pending.promise);
    const firstAActive = { current: true };
    const bActive = { current: false };
    const freshAActive = { current: false };
    const visits = {
      firstA: visit('letter-a', firstAActive),
      b: visit('letter-b', bActive),
      freshA: visit('letter-a', freshAActive),
    };
    const executeLetterMutation = adoptingExecutor();
    const { result, rerender } = renderHook(
      ({ letter, currentVisit }) => useReadingViewWorkspace({
        visit: currentVisit,
        letter,
        transcriptText: letter.transcript.fullText,
        surfaceActive: true,
        executeLetterMutation,
      }),
      {
        initialProps: {
          letter: makeLetter({ readingText: undefined }),
          currentVisit: visits.firstA,
        },
      },
    );

    let generation!: Promise<boolean>;
    await act(async () => {
      generation = result.current.generate();
      await Promise.resolve();
    });
    expect(result.current.sectionProps.readingViewGenerating).toBe(true);

    firstAActive.current = false;
    bActive.current = true;
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        title: 'Letter B',
        readingText: 'Reading B',
      }),
      currentVisit: visits.b,
    });
    bActive.current = false;
    freshAActive.current = true;
    rerender({
      letter: makeLetter({ readingText: 'Fresh reading A' }),
      currentVisit: visits.freshA,
    });

    expect(result.current.readingViewOpen).toBe(false);
    expect(result.current.sectionProps.readerText).toBe('Fresh reading A');
    expect(result.current.sectionProps.readingViewGenerating).toBe(false);

    let accepted = true;
    await act(async () => {
      pending.resolve(makeLetter({
        readingText: 'Late first-A reading',
      }));
      accepted = await generation;
    });

    expect(accepted).toBe(false);
    expect(result.current.readingViewOpen).toBe(false);
    expect(result.current.sectionProps.readerText).toBe('Fresh reading A');
    expect(result.current.sectionProps.readingViewGenerating).toBe(false);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('rejects captured controls and stays closed while the surface is inactive', async () => {
    const currentVisit = visit('letter-a', { current: true });
    const executeLetterMutation = adoptingExecutor();
    const { result, rerender } = renderHook(
      ({ surfaceActive }) => useReadingViewWorkspace({
        visit: currentVisit,
        letter: makeLetter(),
        transcriptText: 'Raw A transcript',
        surfaceActive,
        executeLetterMutation,
      }),
      { initialProps: { surfaceActive: true } },
    );

    act(() => {
      result.current.sectionProps.onReadingViewOpenChange(true);
    });
    expect(result.current.readingViewOpen).toBe(true);
    const capturedOpen = result.current.sectionProps.onReadingViewOpenChange;
    const capturedGenerate = result.current.generate;

    rerender({ surfaceActive: false });
    expect(result.current.readingViewOpen).toBe(false);

    let accepted = true;
    await act(async () => {
      capturedOpen(true);
      accepted = await capturedGenerate();
    });
    expect(accepted).toBe(false);
    expect(executeLetterMutation).not.toHaveBeenCalled();
    expect(generateReadingViewMock).not.toHaveBeenCalled();

    rerender({ surfaceActive: true });
    expect(result.current.readingViewOpen).toBe(false);
  });
});
