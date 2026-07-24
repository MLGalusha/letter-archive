import { act, renderHook } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { TranscribeLetterResponse } from '../../../../api/admin';
import type { Letter } from '../../../../types/Letter';
import type { ExecuteLetterReviewMutation } from '../useLetterReviewMutationExecutor';
import { useLetterReviewStatusResets } from '../useLetterReviewStatusResets';
import type { LetterReviewVisit } from '../useLetterReviewVisit';
import { useLetterTranscriptionWorkspace } from '../useLetterTranscriptionWorkspace';

const {
  showToastMock,
  transcribeLetterMock,
} = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  transcribeLetterMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  transcribeLetter: transcribeLetterMock,
}));

vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-a',
    title: 'Letter A',
    primarySourceRevision: 3,
    images: [],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Persisted transcript' }],
      fullText: 'Persisted transcript',
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

function response(
  letter: Letter,
  pageCount = 2,
): TranscribeLetterResponse {
  return {
    letter,
    transcribed: {
      pageCount,
      textLength: letter.transcript.fullText.length,
    },
  };
}

function adoptingExecutor(): ExecuteLetterReviewMutation {
  return vi.fn(async (mutation) => {
    const updated = await mutation.request();
    mutation.afterAdopt?.(updated);
  });
}

function useTestWorkspace(options: {
  visit: LetterReviewVisit;
  letter: Letter | null;
  transcriptText: string;
  executeLetterMutation: ExecuteLetterReviewMutation;
}) {
  const scheduleStatusReset = useLetterReviewStatusResets(options.visit);
  return useLetterTranscriptionWorkspace({
    ...options,
    scheduleStatusReset,
  });
}

describe('useLetterTranscriptionWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens replacement choices from the visible transcript, not the stale DTO', async () => {
    const executeLetterMutation = adoptingExecutor();
    const currentVisit = visit('letter-a', { current: true });
    const { result } = renderHook(() => useTestWorkspace({
      visit: currentVisit,
      letter: makeLetter({
        transcript: {
          pages: [],
          fullText: '',
          verified: false,
        },
      }),
      transcriptText: 'Unsaved visible transcript',
      executeLetterMutation,
    }));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.requestTranscription();
    });

    expect(accepted).toBe(false);
    expect(result.current.regenerationDialogOpen).toBe(true);
    expect(executeLetterMutation).not.toHaveBeenCalled();
    expect(transcribeLetterMock).not.toHaveBeenCalled();
  });

  it('transcribes a visibly cleared draft and adapts the accepted response envelope', async () => {
    const pending = deferred<TranscribeLetterResponse>();
    const updated = makeLetter({
      transcript: {
        pages: [
          { pageNumber: 1, text: 'Generated page one' },
          { pageNumber: 2, text: 'Generated page two' },
        ],
        fullText: 'Generated page one\n\nGenerated page two',
        verified: false,
      },
    });
    transcribeLetterMock.mockReturnValue(pending.promise);
    const executeLetterMutation: ExecuteLetterReviewMutation =
      vi.fn(async (mutation) => {
        const adopted = await mutation.request();
        expect(adopted).toBe(updated);
        mutation.afterAdopt?.(adopted);
      });
    const currentVisit = visit('letter-a', { current: true });
    const { result } = renderHook(() => useTestWorkspace({
      visit: currentVisit,
      letter: makeLetter(),
      transcriptText: '   ',
      executeLetterMutation,
    }));

    let transcription!: Promise<boolean>;
    await act(async () => {
      transcription = result.current.requestTranscription();
      await Promise.resolve();
    });
    expect(result.current.regenerationDialogOpen).toBe(false);
    expect(result.current.sectionProps.letterTranscribeState).toBe(
      'transcribing',
    );
    expect(result.current.sectionProps.letterTranscribeMessage).toBe(
      'Transcribing letter...',
    );

    let accepted = false;
    await act(async () => {
      pending.resolve(response(updated, 2));
      accepted = await transcription;
    });

    expect(accepted).toBe(true);
    expect(transcribeLetterMock).toHaveBeenCalledWith('letter-a', 3);
    expect(result.current.sectionProps.letterTranscribeState).toBe('done');
    expect(result.current.sectionProps.letterTranscribeMessage).toBe(
      'Transcribed 2 page(s)',
    );
    expect(showToastMock).toHaveBeenCalledWith(
      'Letter transcribed (2 page(s))',
      'success',
    );
  });

  it('cleans progress and reports no success when adoption is rejected', async () => {
    transcribeLetterMock.mockResolvedValue(response(makeLetter()));
    const executeLetterMutation: ExecuteLetterReviewMutation =
      vi.fn(async (mutation) => {
        await mutation.request();
      });
    const currentVisit = visit('letter-a', { current: true });
    const { result } = renderHook(() => useTestWorkspace({
      visit: currentVisit,
      letter: makeLetter(),
      transcriptText: '',
      executeLetterMutation,
    }));

    let accepted = true;
    await act(async () => {
      accepted = await result.current.transcribe();
    });

    expect(accepted).toBe(false);
    expect(result.current.sectionProps.letterTranscribeState).toBe('idle');
    expect(result.current.sectionProps.letterTranscribeMessage).toBeNull();
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('resets A to B to fresh A and rejects late or captured first-A controls', async () => {
    const pending = deferred<TranscribeLetterResponse>();
    transcribeLetterMock.mockReturnValue(pending.promise);
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
      ({ currentVisit, letter, transcriptText }) => (
        useTestWorkspace({
          visit: currentVisit,
          letter,
          transcriptText,
          executeLetterMutation,
        })
      ),
      {
        initialProps: {
          currentVisit: visits.firstA,
          letter: makeLetter(),
          transcriptText: '',
        },
      },
    );

    let firstTranscription!: Promise<boolean>;
    await act(async () => {
      firstTranscription = result.current.transcribe();
      await Promise.resolve();
    });
    expect(result.current.sectionProps.letterTranscribeState).toBe(
      'transcribing',
    );
    const staleRequest = result.current.requestTranscription;
    const staleTranscribe = result.current.transcribe;
    const staleClose = result.current.closeRegenerationDialog;

    firstAActive.current = false;
    bActive.current = true;
    rerender({
      currentVisit: visits.b,
      letter: makeLetter({ id: 'letter-b', title: 'Letter B' }),
      transcriptText: 'Visible B transcript',
    });
    bActive.current = false;
    freshAActive.current = true;
    rerender({
      currentVisit: visits.freshA,
      letter: makeLetter(),
      transcriptText: 'Fresh A transcript',
    });

    expect(result.current.sectionProps.letterTranscribeState).toBe('idle');
    expect(result.current.sectionProps.letterTranscribeMessage).toBeNull();
    expect(result.current.regenerationDialogOpen).toBe(false);
    await act(async () => {
      await result.current.requestTranscription();
    });
    expect(result.current.regenerationDialogOpen).toBe(true);
    act(() => {
      staleClose();
    });
    expect(result.current.regenerationDialogOpen).toBe(true);
    act(() => {
      result.current.closeRegenerationDialog();
    });

    let staleRequestAccepted = true;
    let staleTranscriptionAccepted = true;
    await act(async () => {
      staleRequestAccepted = await staleRequest();
      staleTranscriptionAccepted = await staleTranscribe();
    });
    expect(staleRequestAccepted).toBe(false);
    expect(staleTranscriptionAccepted).toBe(false);
    expect(executeLetterMutation).toHaveBeenCalledTimes(1);
    expect(transcribeLetterMock).toHaveBeenCalledTimes(1);

    let firstAccepted = true;
    await act(async () => {
      pending.resolve(response(makeLetter({
        transcript: {
          pages: [{ pageNumber: 1, text: 'Late first-A transcript' }],
          fullText: 'Late first-A transcript',
          verified: false,
        },
      })));
      firstAccepted = await firstTranscription;
    });

    expect(firstAccepted).toBe(false);
    expect(result.current.sectionProps.letterTranscribeState).toBe('idle');
    expect(result.current.sectionProps.letterTranscribeMessage).toBeNull();
    expect(result.current.regenerationDialogOpen).toBe(false);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('does not let an older done reset erase a newer transcription attempt', async () => {
    vi.useFakeTimers();
    const secondPending = deferred<TranscribeLetterResponse>();
    transcribeLetterMock
      .mockResolvedValueOnce(response(makeLetter(), 1))
      .mockReturnValueOnce(secondPending.promise);
    const currentVisit = visit('letter-a', { current: true });
    const { result } = renderHook(() => useTestWorkspace({
      visit: currentVisit,
      letter: makeLetter(),
      transcriptText: '',
      executeLetterMutation: adoptingExecutor(),
    }));

    await act(async () => {
      expect(await result.current.transcribe()).toBe(true);
    });
    expect(result.current.sectionProps.letterTranscribeState).toBe('done');

    let secondTranscription!: Promise<boolean>;
    await act(async () => {
      secondTranscription = result.current.transcribe();
      await Promise.resolve();
    });
    expect(result.current.sectionProps.letterTranscribeState).toBe(
      'transcribing',
    );

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.sectionProps.letterTranscribeState).toBe(
      'transcribing',
    );
    expect(result.current.sectionProps.letterTranscribeMessage).toBe(
      'Transcribing letter...',
    );

    await act(async () => {
      secondPending.resolve(response(makeLetter(), 3));
      expect(await secondTranscription).toBe(true);
    });
    expect(result.current.sectionProps.letterTranscribeState).toBe('done');
    expect(result.current.sectionProps.letterTranscribeMessage).toBe(
      'Transcribed 3 page(s)',
    );

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.sectionProps.letterTranscribeState).toBe('idle');
    expect(result.current.sectionProps.letterTranscribeMessage).toBeNull();
  });
});
