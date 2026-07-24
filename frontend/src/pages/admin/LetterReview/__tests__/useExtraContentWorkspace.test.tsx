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
import type { ExecuteLetterReviewMutation } from '../useLetterReviewMutationExecutor';
import { useExtraContentWorkspace } from '../useExtraContentWorkspace';
import type { LetterReviewVisit } from '../useLetterReviewVisit';

const {
  showToastMock,
  transcribeExtrasMock,
  unverifyExtraContentMock,
  updateExtraContentMock,
  verifyExtraContentMock,
} = vi.hoisted(() => ({
  showToastMock: vi.fn(),
  transcribeExtrasMock: vi.fn(),
  unverifyExtraContentMock: vi.fn(),
  updateExtraContentMock: vi.fn(),
  verifyExtraContentMock: vi.fn(),
}));

vi.mock('../../../../api/admin', () => ({
  transcribeExtras: transcribeExtrasMock,
  unverifyExtraContent: unverifyExtraContentMock,
  updateExtraContent: updateExtraContentMock,
  verifyExtraContent: verifyExtraContentMock,
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
    transcript: { pages: [], fullText: '', verified: false },
    metadata: { verified: false },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'EDITED',
    metadataContentStatus: 'EDITED',
    extraContentStatus: 'AI_DRAFT',
    extraContentTranscript: 'Original envelope note',
    createdAt: '2026-07-24T12:00:00.000Z',
    flagged: false,
    ...overrides,
  };
}

function activeVisit(letterId = 'letter-a'): LetterReviewVisit {
  return {
    letterId,
    isActive: () => true,
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

describe('useExtraContentWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms replacement from the visible draft rather than a stale Letter DTO', async () => {
    const scheduleDebouncedSave = vi.fn();
    const executeLetterMutation = adoptingExecutor();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const visit = activeVisit();
    const { result } = renderHook(() =>
      useExtraContentWorkspace({
        visit,
        letter: makeLetter({
          extraContentTranscript: undefined,
          extraContentStatus: 'EMPTY',
        }),
        saving: false,
        scheduleDebouncedSave,
        tryAdoptLetter: vi.fn(() => true),
        executeLetterMutation,
      }),
    );

    act(() => {
      result.current.sectionProps.onExtraContentChange(
        'Unsaved visible cover note',
      );
    });
    let accepted = true;
    await act(async () => {
      accepted = await result.current.transcribe();
    });

    expect(result.current.sectionProps.extraContent).toBe(
      'Unsaved visible cover note',
    );
    expect(confirm).toHaveBeenCalledWith(
      'Replace extra content transcription? This will overwrite the current content.',
    );
    expect(accepted).toBe(false);
    expect(executeLetterMutation).not.toHaveBeenCalled();
    expect(transcribeExtrasMock).not.toHaveBeenCalled();
  });

  it('skips replacement confirmation when the visible draft was cleared', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const updated = makeLetter({
      extraContentTranscript: 'Regenerated cover note',
    });
    transcribeExtrasMock.mockResolvedValue({
      letter: updated,
      transcribedCount: 1,
      extraContentStatus: 'AI_DRAFT',
    });
    const visit = activeVisit();
    const { result } = renderHook(() =>
      useExtraContentWorkspace({
        visit,
        letter: makeLetter(),
        saving: false,
        scheduleDebouncedSave: vi.fn(),
        tryAdoptLetter: vi.fn(() => true),
        executeLetterMutation: adoptingExecutor(),
      }),
    );

    act(() => {
      result.current.sectionProps.onExtraContentChange('');
    });
    let accepted = false;
    await act(async () => {
      accepted = await result.current.transcribe();
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(accepted).toBe(true);
    expect(transcribeExtrasMock).toHaveBeenCalledWith('letter-a', 3);
  });

  it('owns accepted transcription progress, hydration, and success reporting', async () => {
    const pending = deferred<{
      letter: Letter;
      transcribedCount: number;
      extraContentStatus: 'AI_DRAFT';
    }>();
    const updated = makeLetter({
      extraContentTranscript: 'Generated telegram text',
    });
    transcribeExtrasMock.mockReturnValue(pending.promise);
    const visit = activeVisit();
    const { result } = renderHook(() =>
      useExtraContentWorkspace({
        visit,
        letter: makeLetter(),
        saving: false,
        scheduleDebouncedSave: vi.fn(),
        tryAdoptLetter: vi.fn(() => true),
        executeLetterMutation: adoptingExecutor(),
      }),
    );

    let transcription!: Promise<boolean>;
    await act(async () => {
      transcription = result.current.transcribe({
        confirmReplacement: false,
      });
      await Promise.resolve();
    });
    expect(result.current.sectionProps.extraContentTranscribing).toBe(true);

    let accepted = false;
    await act(async () => {
      pending.resolve({
        letter: updated,
        transcribedCount: 1,
        extraContentStatus: 'AI_DRAFT',
      });
      accepted = await transcription;
    });

    expect(accepted).toBe(true);
    expect(transcribeExtrasMock).toHaveBeenCalledWith('letter-a', 3);
    expect(result.current.sectionProps.extraContent).toBe(
      'Generated telegram text',
    );
    expect(result.current.sectionProps.extraContentTranscribing).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith(
      'Transcribed 1 extra item(s)',
      'success',
    );
  });

  it('cleans up progress without publishing success when adoption is rejected', async () => {
    const updated = makeLetter({
      primarySourceRevision: 4,
      extraContentTranscript: 'Wrong-source content',
    });
    transcribeExtrasMock.mockResolvedValue({
      letter: updated,
      transcribedCount: 2,
      extraContentStatus: 'AI_DRAFT',
    });
    const executeLetterMutation: ExecuteLetterReviewMutation =
      vi.fn(async (mutation) => {
        await mutation.request();
      });
    const visit = activeVisit();
    const { result } = renderHook(() =>
      useExtraContentWorkspace({
        visit,
        letter: makeLetter(),
        saving: false,
        scheduleDebouncedSave: vi.fn(),
        tryAdoptLetter: vi.fn(() => false),
        executeLetterMutation,
      }),
    );

    let accepted = true;
    await act(async () => {
      accepted = await result.current.transcribe({
        confirmReplacement: false,
      });
    });

    expect(accepted).toBe(false);
    expect(result.current.sectionProps.extraContent).toBe(
      'Original envelope note',
    );
    expect(result.current.sectionProps.extraContentTranscribing).toBe(false);
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('schedules the exact autosave lane and preserves a newer visible draft', async () => {
    const scheduleDebouncedSave = vi.fn();
    const tryAdoptLetter = vi.fn(() => true);
    const firstSaved = makeLetter({
      extraContentTranscript: 'First edit',
      extraContentStatus: 'EDITED',
    });
    updateExtraContentMock.mockResolvedValue(firstSaved);
    const visit = activeVisit();
    const { result } = renderHook(() =>
      useExtraContentWorkspace({
        visit,
        letter: makeLetter(),
        saving: false,
        scheduleDebouncedSave,
        tryAdoptLetter,
        executeLetterMutation: adoptingExecutor(),
      }),
    );

    act(() => {
      result.current.sectionProps.onExtraContentChange('First edit');
    });
    const firstSave = scheduleDebouncedSave.mock.calls[0][0];
    act(() => {
      result.current.sectionProps.onExtraContentChange('Newer edit');
    });

    await act(async () => {
      await firstSave();
    });

    expect(scheduleDebouncedSave).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      {
        lane: 'extra-content',
        errorMessage: 'Failed to save extra content',
        onError: expect.any(Function),
      },
    );
    expect(updateExtraContentMock).toHaveBeenCalledWith(
      'letter-a',
      'First edit',
      3,
    );
    expect(tryAdoptLetter).toHaveBeenCalledWith(firstSaved);
    expect(result.current.sectionProps.extraContent).toBe('Newer edit');
  });

  it('ignores a late first-A autosave response after a fresh A visit', async () => {
    const pending = deferred<Letter>();
    updateExtraContentMock.mockReturnValue(pending.promise);
    const firstVisit = { active: true };
    const secondVisit = { active: false };
    const freshVisit = { active: false };
    const visits = {
      first: {
        letterId: 'letter-a',
        isActive: () => firstVisit.active,
      },
      second: {
        letterId: 'letter-b',
        isActive: () => secondVisit.active,
      },
      fresh: {
        letterId: 'letter-a',
        isActive: () => freshVisit.active,
      },
    } satisfies Record<string, LetterReviewVisit>;
    const scheduleDebouncedSave = vi.fn();
    const shared = {
      saving: false,
      scheduleDebouncedSave,
      tryAdoptLetter: vi.fn(() => true),
      executeLetterMutation: adoptingExecutor(),
    };
    const { result, rerender } = renderHook(
      ({ letter, visit }) => useExtraContentWorkspace({
        ...shared,
        letter,
        visit,
      }),
      {
        initialProps: {
          letter: makeLetter(),
          visit: visits.first,
        },
      },
    );

    act(() => {
      result.current.sectionProps.onExtraContentChange('First-A edit');
    });
    const firstSave = scheduleDebouncedSave.mock.calls[0][0];
    let save!: Promise<void>;
    await act(async () => {
      save = firstSave();
      await Promise.resolve();
    });

    firstVisit.active = false;
    secondVisit.active = true;
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        extraContentTranscript: 'Letter B extra',
      }),
      visit: visits.second,
    });
    secondVisit.active = false;
    freshVisit.active = true;
    rerender({
      letter: makeLetter({
        extraContentTranscript: 'Fresh A extra',
      }),
      visit: visits.fresh,
    });

    await act(async () => {
      pending.resolve(makeLetter({
        extraContentTranscript: 'Late first-A edit',
      }));
      await save;
    });

    expect(result.current.sectionProps.extraContent).toBe('Fresh A extra');
  });

  it('owns verification transitions and the line-review editing gate', async () => {
    const verifiedLetter = makeLetter({
      extraContentStatus: 'VERIFIED',
      extraContentVerifiedAt: '2026-07-24T12:00:00.000Z',
    });
    const editableLetter = makeLetter({
      extraContentStatus: 'EDITED',
      extraContentVerifiedAt: undefined,
    });
    unverifyExtraContentMock.mockResolvedValue(editableLetter);
    verifyExtraContentMock.mockResolvedValue(verifiedLetter);
    const executeLetterMutation = adoptingExecutor();
    const visit = activeVisit();
    const shared = {
      visit,
      saving: false,
      scheduleDebouncedSave: vi.fn(),
      tryAdoptLetter: vi.fn(() => true),
      executeLetterMutation,
    };
    const { result, rerender } = renderHook(
      ({ letter }) => useExtraContentWorkspace({ ...shared, letter }),
      { initialProps: { letter: verifiedLetter } },
    );

    act(() => {
      result.current.sectionProps.onVerifyExtraContent();
    });
    await waitFor(() => {
      expect(unverifyExtraContentMock).toHaveBeenCalledWith('letter-a', 3);
      expect(result.current.lineReviewBlocked).toBe(true);
    });
    expect(showToastMock).toHaveBeenCalledWith(
      'Extra content verification removed',
      'info',
    );

    rerender({ letter: editableLetter });
    act(() => {
      result.current.sectionProps.onVerifyExtraContent();
    });
    await waitFor(() => {
      expect(verifyExtraContentMock).toHaveBeenCalledWith('letter-a', 3);
      expect(result.current.lineReviewBlocked).toBe(false);
    });
    expect(showToastMock).toHaveBeenCalledWith(
      'Extra content verified',
      'success',
    );
  });

  it('resets a fresh A visit immediately and ignores late first-A transcription', async () => {
    const pending = deferred<{
      letter: Letter;
      transcribedCount: number;
      extraContentStatus: 'AI_DRAFT';
    }>();
    transcribeExtrasMock.mockReturnValue(pending.promise);
    const firstVisit = { active: true };
    const secondVisit = { active: false };
    const freshVisit = { active: false };
    const visits = {
      first: {
        letterId: 'letter-a',
        isActive: () => firstVisit.active,
      },
      second: {
        letterId: 'letter-b',
        isActive: () => secondVisit.active,
      },
      fresh: {
        letterId: 'letter-a',
        isActive: () => freshVisit.active,
      },
    } satisfies Record<string, LetterReviewVisit>;
    const executeFor = (
      visit: LetterReviewVisit,
    ): ExecuteLetterReviewMutation => async (mutation) => {
      if (!visit.isActive()) return;
      const updated = await mutation.request();
      if (!visit.isActive()) return;
      mutation.afterAdopt?.(updated);
    };
    const shared = {
      saving: false,
      scheduleDebouncedSave: vi.fn(),
      tryAdoptLetter: vi.fn(() => true),
    };
    const { result, rerender } = renderHook(
      ({ letter, visit }) => useExtraContentWorkspace({
        ...shared,
        letter,
        visit,
        executeLetterMutation: executeFor(visit),
      }),
      {
        initialProps: {
          letter: makeLetter(),
          visit: visits.first,
        },
      },
    );

    let firstTranscription!: Promise<boolean>;
    await act(async () => {
      firstTranscription = result.current.transcribe({
        confirmReplacement: false,
      });
      await Promise.resolve();
    });
    expect(result.current.sectionProps.extraContentTranscribing).toBe(true);

    firstVisit.active = false;
    secondVisit.active = true;
    rerender({
      letter: makeLetter({
        id: 'letter-b',
        extraContentTranscript: 'Letter B extra',
      }),
      visit: visits.second,
    });
    secondVisit.active = false;
    freshVisit.active = true;
    rerender({
      letter: makeLetter({
        extraContentTranscript: 'Fresh A extra',
      }),
      visit: visits.fresh,
    });

    expect(result.current.sectionProps.extraContent).toBe('Fresh A extra');
    expect(result.current.sectionProps.extraContentTranscribing).toBe(false);

    await act(async () => {
      pending.resolve({
        letter: makeLetter({
          extraContentTranscript: 'Late first-A extra',
        }),
        transcribedCount: 1,
        extraContentStatus: 'AI_DRAFT',
      });
      await firstTranscription;
    });

    expect(result.current.sectionProps.extraContent).toBe('Fresh A extra');
    expect(result.current.sectionProps.extraContentTranscribing).toBe(false);
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
