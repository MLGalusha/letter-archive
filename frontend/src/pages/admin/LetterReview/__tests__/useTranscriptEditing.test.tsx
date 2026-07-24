import { act, renderHook, waitFor } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Letter } from '../../../../types/Letter';
import { useTranscriptEditing } from '../useTranscriptEditing';
import type { LetterReviewVisit } from '../useLetterReviewVisit';

const {
  unverifyTranscriptMock,
  updateLetterMock,
  verifyTranscriptMock,
} = vi.hoisted(() => ({
  unverifyTranscriptMock: vi.fn(),
  updateLetterMock: vi.fn(),
  verifyTranscriptMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  unverifyTranscript: unverifyTranscriptMock,
  updateLetter: updateLetterMock,
  verifyTranscript: verifyTranscriptMock,
}));

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-a',
    title: 'Letter A',
    primarySourceRevision: 3,
    images: [],
    transcript: {
      pages: [],
      fullText: 'Original A transcript',
      verified: true,
    },
    metadata: { verified: false },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'VERIFIED',
    metadataContentStatus: 'EDITED',
    extraContentStatus: 'EMPTY',
    transcriptVerifiedAt: '2026-07-24T12:00:00.000Z',
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
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function optionsFor(
  letter: Letter,
  currentVisit: LetterReviewVisit,
  overrides: Partial<Parameters<typeof useTranscriptEditing>[0]> = {},
) {
  return {
    visit: currentVisit,
    letterId: letter.id,
    letter,
    transcript: letter.transcript.fullText,
    tryAdoptLetter: vi.fn(() => currentVisit.isActive()),
    beginSaving: vi.fn(() => vi.fn()),
    flushPendingSaves: vi.fn(async () => true),
    setTranscript: vi.fn(),
    handleMutationError: vi.fn(() => false),
    showToast: vi.fn(),
    editorRef: { current: null },
    triggerAutoSave: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('useTranscriptEditing visit ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('drops A editing, baseline, and dirty state before verified B can render', async () => {
    const aActive = { current: true };
    const bActive = { current: false };
    const visitA = visit('letter-a', aActive);
    const visitB = visit('letter-b', bActive);
    const letterA = makeLetter();
    const letterB = makeLetter({
      id: 'letter-b',
      title: 'Letter B',
      transcript: {
        pages: [],
        fullText: 'Verified B transcript',
        verified: true,
      },
    });
    unverifyTranscriptMock.mockResolvedValue(makeLetter({
      transcriptStatus: 'EDITED',
      transcript: {
        pages: [],
        fullText: 'Original A transcript',
        verified: false,
      },
      transcriptVerifiedAt: undefined,
    }));
    const { result, rerender } = renderHook(
      ({ letter, visit: currentVisit }) => useTranscriptEditing(
        optionsFor(letter, currentVisit),
      ),
      {
        initialProps: {
          letter: letterA,
          visit: visitA,
        },
      },
    );

    await act(async () => {
      await result.current.handleTranscriptDoubleClick();
    });
    act(() => {
      result.current.handleTranscriptInput('Changed A transcript');
    });
    expect(result.current.isTranscriptEditing).toBe(true);
    expect(result.current.hasTranscriptChanges).toBe(true);

    rerender({
      letter: makeLetter({
        primarySourceRevision: 4,
        transcriptStatus: 'EDITED',
        transcript: {
          pages: [],
          fullText: 'Changed A transcript',
          verified: false,
        },
        transcriptVerifiedAt: undefined,
      }),
      visit: visitA,
    });
    expect(result.current.isTranscriptEditing).toBe(true);
    expect(result.current.hasTranscriptChanges).toBe(true);

    aActive.current = false;
    bActive.current = true;
    rerender({ letter: letterB, visit: visitB });

    expect(result.current.isTranscriptEditing).toBe(false);
    expect(result.current.hasTranscriptChanges).toBe(false);

    const confirm = vi.spyOn(window, 'confirm');
    await act(async () => {
      await result.current.handleTranscriptRevert();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(updateLetterMock).not.toHaveBeenCalled();
  });

  it('ignores late first-A unverify completion during a fresh A visit', async () => {
    const pending = deferred<Letter>();
    unverifyTranscriptMock.mockReturnValue(pending.promise);
    const firstAActive = { current: true };
    const bActive = { current: false };
    const freshAActive = { current: false };
    const visits = {
      firstA: visit('letter-a', firstAActive),
      b: visit('letter-b', bActive),
      freshA: visit('letter-a', freshAActive),
    };
    const tryAdoptLetter = vi.fn(() => firstAActive.current);
    const setTranscript = vi.fn();
    const showToast = vi.fn();
    const sharedEffects = {
      tryAdoptLetter,
      setTranscript,
      showToast,
    };
    const { result, rerender } = renderHook(
      ({ letter, visit: currentVisit }) => useTranscriptEditing(
        optionsFor(letter, currentVisit, sharedEffects),
      ),
      {
        initialProps: {
          letter: makeLetter(),
          visit: visits.firstA,
        },
      },
    );

    let firstUnverify!: Promise<void>;
    act(() => {
      firstUnverify = result.current.handleTranscriptDoubleClick();
    });
    await waitFor(() => {
      expect(unverifyTranscriptMock).toHaveBeenCalledWith('letter-a', 3);
    });

    firstAActive.current = false;
    bActive.current = true;
    rerender({
      letter: makeLetter({ id: 'letter-b', title: 'Letter B' }),
      visit: visits.b,
    });
    bActive.current = false;
    freshAActive.current = true;
    rerender({
      letter: makeLetter({
        transcript: {
          pages: [],
          fullText: 'Fresh A transcript',
          verified: true,
        },
      }),
      visit: visits.freshA,
    });

    await act(async () => {
      const lateLetter = makeLetter({
        transcriptStatus: 'EDITED',
        transcript: {
          pages: [],
          fullText: 'Late first-A transcript',
          verified: false,
        },
      });
      pending.resolve(lateLetter);
      await firstUnverify;

      expect(tryAdoptLetter).toHaveBeenCalledTimes(1);
      expect(tryAdoptLetter).toHaveBeenCalledWith(lateLetter);
    });

    expect(result.current.isTranscriptEditing).toBe(false);
    expect(result.current.hasTranscriptChanges).toBe(false);
    expect(setTranscript).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('closes a verified-edit tooltip when the route visit changes', () => {
    const aActive = { current: true };
    const bActive = { current: false };
    const visitA = visit('letter-a', aActive);
    const visitB = visit('letter-b', bActive);
    const { result, rerender } = renderHook(
      ({ letter, visit: currentVisit }) => useTranscriptEditing(
        optionsFor(letter, currentVisit),
      ),
      {
        initialProps: {
          letter: makeLetter(),
          visit: visitA,
        },
      },
    );

    act(() => {
      result.current.handleTranscriptClick({
        clientX: 20,
        clientY: 30,
      } as never);
    });
    expect(result.current.showEditTooltip).toBe(true);

    aActive.current = false;
    bActive.current = true;
    rerender({
      letter: makeLetter({ id: 'letter-b', title: 'Letter B' }),
      visit: visitB,
    });

    expect(result.current.showEditTooltip).toBe(false);
  });

  it('ignores captured tooltip handlers from an inactive visit', async () => {
    const aActive = { current: true };
    const bActive = { current: false };
    const visitA = visit('letter-a', aActive);
    const visitB = visit('letter-b', bActive);
    const { result, rerender } = renderHook(
      ({ letter, visit: currentVisit }) => useTranscriptEditing(
        optionsFor(letter, currentVisit),
      ),
      {
        initialProps: {
          letter: makeLetter(),
          visit: visitA,
        },
      },
    );
    const staleClick = result.current.handleTranscriptClick;
    const staleDoubleClick = result.current.handleTranscriptDoubleClick;

    aActive.current = false;
    bActive.current = true;
    rerender({
      letter: makeLetter({ id: 'letter-b', title: 'Letter B' }),
      visit: visitB,
    });

    act(() => {
      staleClick({ clientX: 20, clientY: 30 } as never);
    });
    expect(result.current.showEditTooltip).toBe(false);

    act(() => {
      result.current.handleTranscriptClick({
        clientX: 40,
        clientY: 50,
      } as never);
    });
    expect(result.current.showEditTooltip).toBe(true);

    await act(async () => {
      await staleDoubleClick();
    });
    expect(result.current.showEditTooltip).toBe(true);
    expect(unverifyTranscriptMock).not.toHaveBeenCalled();
  });
});
