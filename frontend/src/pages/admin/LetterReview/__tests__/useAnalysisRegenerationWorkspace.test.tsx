import { act, renderHook } from '@testing-library/react';
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
import { useLetterReviewStatusResets } from '../useLetterReviewStatusResets';
import type { LetterReviewVisit } from '../useLetterReviewVisit';
import {
  useAnalysisRegenerationWorkspace,
  type AnalysisRegenerationChoice,
  type AnalysisRegenerationChoiceResult,
} from '../useAnalysisRegenerationWorkspace';

const {
  regenerateMetadataMock,
  reExtractLetterMock,
  showToastMock,
  trackEditMock,
} = vi.hoisted(() => ({
  regenerateMetadataMock: vi.fn(),
  reExtractLetterMock: vi.fn(),
  showToastMock: vi.fn(),
  trackEditMock: vi.fn(),
}));

vi.mock('../../../../api/admin/letters', () => ({
  regenerateMetadata: regenerateMetadataMock,
  reExtractLetter: reExtractLetterMock,
}));

vi.mock('../../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: showToastMock }),
}));

vi.mock('../../../../utils/recentEdits', () => ({
  trackEdit: trackEditMock,
}));

function makeLetter(overrides: Partial<Letter> = {}): Letter {
  return {
    id: 'letter-a',
    title: 'Letter A',
    primarySourceRevision: 3,
    collectionCode: 'COL',
    images: [],
    transcript: {
      pages: [{ pageNumber: 1, text: 'Persisted transcript' }],
      fullText: 'Persisted transcript',
      verified: true,
    },
    metadata: {
      sender: 'Persisted Sender',
      recipient: 'Persisted Recipient',
      verified: false,
    },
    status: 'needs_review',
    workflowState: 'TRANSCRIBED',
    visibility: 'HIDDEN',
    transcriptPublished: false,
    metadataPublished: false,
    transcriptStatus: 'VERIFIED',
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
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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
  sender: string;
  recipient: string;
  executeLetterMutation: ExecuteLetterReviewMutation;
}) {
  const scheduleStatusReset = useLetterReviewStatusResets(options.visit);
  return useAnalysisRegenerationWorkspace({
    ...options,
    scheduleStatusReset,
  });
}

describe('useAnalysisRegenerationWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    regenerateMetadataMock.mockImplementation(async () => makeLetter());
    reExtractLetterMock.mockImplementation(async () => makeLetter());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('owns a fresh correction draft per route visit and rejects captured controls', async () => {
    const pending = deferred<Letter>();
    regenerateMetadataMock.mockReturnValue(pending.promise);
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
      ({ currentVisit, letter, sender, recipient }) => useTestWorkspace({
        visit: currentVisit,
        letter,
        sender,
        recipient,
        executeLetterMutation,
      }),
      {
        initialProps: {
          currentVisit: visits.firstA,
          letter: makeLetter(),
          sender: 'Visible First-A Sender',
          recipient: 'Visible First-A Recipient',
        },
      },
    );

    act(() => {
      result.current.metadataSectionProps.onRegenerateMetadata();
    });
    expect(result.current.dialogProps).toMatchObject({
      isOpen: true,
      sender: 'Visible First-A Sender',
      recipient: 'Visible First-A Recipient',
    });
    const staleClose = result.current.dialogProps.onClose;
    const staleSenderChange = result.current.dialogProps.onSenderChange;
    const staleChoose = result.current.dialogProps.onChoose;
    let firstRegeneration!: Promise<AnalysisRegenerationChoiceResult>;
    await act(async () => {
      firstRegeneration = staleChoose('metadata');
      await Promise.resolve();
    });
    expect(result.current.metadataSectionProps.regenerateState).toBe(
      'regenerating',
    );

    firstAActive.current = false;
    bActive.current = true;
    rerender({
      currentVisit: visits.b,
      letter: makeLetter({ id: 'letter-b', title: 'Letter B' }),
      sender: 'Visible B Sender',
      recipient: 'Visible B Recipient',
    });
    bActive.current = false;
    freshAActive.current = true;
    rerender({
      currentVisit: visits.freshA,
      letter: makeLetter(),
      sender: 'Visible Fresh-A Sender',
      recipient: 'Visible Fresh-A Recipient',
    });

    expect(result.current.dialogProps.isOpen).toBe(false);
    expect(result.current.metadataSectionProps.regenerateState).toBe('idle');
    expect(result.current.entitySectionProps.reExtractState).toBe('idle');
    act(() => {
      result.current.metadataSectionProps.onRegenerateMetadata();
      staleSenderChange('Stale Sender');
      staleClose();
    });
    expect(result.current.dialogProps).toMatchObject({
      isOpen: true,
      sender: 'Visible Fresh-A Sender',
      recipient: 'Visible Fresh-A Recipient',
    });

    let staleResult!: AnalysisRegenerationChoiceResult;
    await act(async () => {
      staleResult = await staleChoose('both');
    });
    expect(staleResult).toEqual({
      accepted: false,
      shouldRestoreFocus: false,
    });
    expect(executeLetterMutation).toHaveBeenCalledTimes(1);
    expect(regenerateMetadataMock).toHaveBeenCalledTimes(1);
    expect(reExtractLetterMock).not.toHaveBeenCalled();

    let firstResult!: AnalysisRegenerationChoiceResult;
    await act(async () => {
      pending.resolve(makeLetter({
        metadata: {
          sender: 'Late First-A Sender',
          recipient: 'Late First-A Recipient',
          verified: false,
        },
      }));
      firstResult = await firstRegeneration;
    });
    expect(firstResult).toEqual({
      accepted: false,
      shouldRestoreFocus: false,
    });
    expect(result.current.metadataSectionProps.regenerateState).toBe('idle');
    expect(result.current.entitySectionProps.reExtractState).toBe('idle');
    expect(result.current.dialogProps).toMatchObject({
      isOpen: true,
      sender: 'Visible Fresh-A Sender',
      recipient: 'Visible Fresh-A Recipient',
    });
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it.each<{
    choice: AnalysisRegenerationChoice;
    expectedMetadataProgress: string;
    expectedEntityProgress: string;
    expectedToast: string;
    tracksEdit: boolean;
  }>([
    {
      choice: 'metadata',
      expectedMetadataProgress: 'done',
      expectedEntityProgress: 'idle',
      expectedToast: 'Metadata regenerated',
      tracksEdit: false,
    },
    {
      choice: 'entities',
      expectedMetadataProgress: 'idle',
      expectedEntityProgress: 'done',
      expectedToast: 'Entities re-extracted',
      tracksEdit: true,
    },
    {
      choice: 'both',
      expectedMetadataProgress: 'idle',
      expectedEntityProgress: 'idle',
      expectedToast: 'Metadata re-extracted with corrections',
      tracksEdit: true,
    },
  ])(
    'maps $choice to its exact accepted operation',
    async ({
      choice,
      expectedMetadataProgress,
      expectedEntityProgress,
      expectedToast,
      tracksEdit,
    }) => {
      const updated = makeLetter({
        id: 'letter-a',
        metadata: {
          sender: 'Returned Sender',
          recipient: 'Returned Recipient',
          verified: false,
        },
      });
      regenerateMetadataMock.mockResolvedValue(updated);
      reExtractLetterMock.mockResolvedValue(updated);
      const currentVisit = visit('letter-a', { current: true });
      const executeLetterMutation = adoptingExecutor();
      const { result } = renderHook(() => useTestWorkspace({
        visit: currentVisit,
        letter: makeLetter(),
        sender: 'Visible Sender',
        recipient: 'Visible Recipient',
        executeLetterMutation,
      }));

      act(() => {
        result.current.metadataSectionProps.onRegenerateMetadata();
        result.current.dialogProps.onSenderChange('Corrected Sender');
        result.current.dialogProps.onRecipientChange('Corrected Recipient');
      });
      let choiceResult!: AnalysisRegenerationChoiceResult;
      await act(async () => {
        choiceResult = await result.current.dialogProps.onChoose(choice);
      });

      expect(choiceResult).toEqual({
        accepted: true,
        shouldRestoreFocus: true,
      });
      expect(result.current.dialogProps.isOpen).toBe(false);
      expect(result.current.metadataSectionProps.regenerateState).toBe(
        expectedMetadataProgress,
      );
      expect(result.current.entitySectionProps.reExtractState).toBe(
        expectedEntityProgress,
      );
      expect(showToastMock).toHaveBeenCalledWith(expectedToast, 'success');

      if (choice === 'metadata') {
        expect(regenerateMetadataMock).toHaveBeenCalledWith(
          'letter-a',
          3,
          {
            confirmedSender: 'Corrected Sender',
            confirmedRecipient: 'Corrected Recipient',
          },
        );
        expect(reExtractLetterMock).not.toHaveBeenCalled();
      } else {
        expect(reExtractLetterMock).toHaveBeenCalledWith('letter-a', {
          primarySourceRevision: 3,
          confirmedSender: 'Corrected Sender',
          confirmedRecipient: 'Corrected Recipient',
          mode: choice === 'entities' ? 'entities_only' : 'full',
        });
        expect(regenerateMetadataMock).not.toHaveBeenCalled();
      }

      if (tracksEdit) {
        expect(trackEditMock).toHaveBeenCalledWith({
          id: updated.id,
          metadata: updated.metadata,
          collectionCode: updated.collectionCode,
        });
      } else {
        expect(trackEditMock).not.toHaveBeenCalled();
      }
    },
  );

  it('preserves the current blank correction asymmetry', async () => {
    const currentVisit = visit('letter-a', { current: true });
    const executeLetterMutation = adoptingExecutor();
    const { result } = renderHook(() => useTestWorkspace({
      visit: currentVisit,
      letter: makeLetter(),
      sender: 'Visible Sender',
      recipient: 'Visible Recipient',
      executeLetterMutation,
    }));

    act(() => {
      result.current.metadataSectionProps.onRegenerateMetadata();
      result.current.dialogProps.onSenderChange('');
      result.current.dialogProps.onRecipientChange('');
    });
    await act(async () => {
      await result.current.dialogProps.onChoose('metadata');
    });
    expect(regenerateMetadataMock).toHaveBeenLastCalledWith(
      'letter-a',
      3,
      {
        confirmedSender: undefined,
        confirmedRecipient: undefined,
      },
    );

    act(() => {
      result.current.metadataSectionProps.onRegenerateMetadata();
      result.current.dialogProps.onSenderChange('');
      result.current.dialogProps.onRecipientChange('');
    });
    await act(async () => {
      await result.current.dialogProps.onChoose('entities');
    });
    expect(reExtractLetterMock).toHaveBeenLastCalledWith('letter-a', {
      primarySourceRevision: 3,
      confirmedSender: 'Visible Sender',
      confirmedRecipient: 'Visible Recipient',
      mode: 'entities_only',
    });
  });

  it('starts progress inside the executor request and reports no success when adoption is withheld', async () => {
    const pending = deferred<Letter>();
    regenerateMetadataMock.mockReturnValue(pending.promise);
    const executeLetterMutation: ExecuteLetterReviewMutation =
      vi.fn(async (mutation) => {
        await mutation.request();
      });
    const currentVisit = visit('letter-a', { current: true });
    const { result } = renderHook(() => useTestWorkspace({
      visit: currentVisit,
      letter: makeLetter(),
      sender: 'Visible Sender',
      recipient: 'Visible Recipient',
      executeLetterMutation,
    }));

    act(() => {
      result.current.metadataSectionProps.onRegenerateMetadata();
    });
    let regeneration!: Promise<AnalysisRegenerationChoiceResult>;
    await act(async () => {
      regeneration = result.current.dialogProps.onChoose('metadata');
      await Promise.resolve();
    });
    expect(result.current.metadataSectionProps.regenerateState).toBe(
      'regenerating',
    );
    expect(result.current.dialogProps.isOpen).toBe(false);

    await act(async () => {
      pending.resolve(makeLetter());
      expect(await regeneration).toEqual({
        accepted: false,
        shouldRestoreFocus: true,
      });
    });
    expect(result.current.metadataSectionProps.regenerateState).toBe('idle');
    expect(showToastMock).not.toHaveBeenCalled();
    expect(trackEditMock).not.toHaveBeenCalled();
  });

  it('preserves standalone entity confirmation and attempt-safe completion resets', async () => {
    vi.useFakeTimers();
    const confirm = vi.spyOn(window, 'confirm');
    const secondPending = deferred<Letter>();
    reExtractLetterMock
      .mockResolvedValueOnce(makeLetter())
      .mockReturnValueOnce(secondPending.promise)
      .mockResolvedValueOnce(makeLetter());
    const currentVisit = visit('letter-a', { current: true });
    const executeLetterMutation = adoptingExecutor();
    const { result } = renderHook(() => useTestWorkspace({
      visit: currentVisit,
      letter: makeLetter(),
      sender: 'Visible Sender',
      recipient: 'Visible Recipient',
      executeLetterMutation,
    }));

    confirm.mockReturnValueOnce(false);
    act(() => {
      result.current.entitySectionProps.onReExtractEntities();
    });
    expect(confirm).toHaveBeenCalledWith(
      'Re-extract entities from the transcript? This will overwrite current entity data.',
    );
    expect(executeLetterMutation).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await act(async () => {
      result.current.entitySectionProps.onReExtractEntities();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.entitySectionProps.reExtractState).toBe('done');
    expect(reExtractLetterMock).toHaveBeenLastCalledWith('letter-a', {
      primarySourceRevision: 3,
      confirmedSender: 'Visible Sender',
      confirmedRecipient: 'Visible Recipient',
      mode: 'entities_only',
    });

    act(() => {
      result.current.metadataSectionProps.onRegenerateMetadata();
    });
    let secondRegeneration!: Promise<AnalysisRegenerationChoiceResult>;
    await act(async () => {
      secondRegeneration = result.current.dialogProps.onChoose('entities');
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(result.current.entitySectionProps.reExtractState).toBe(
      'extracting',
    );
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.entitySectionProps.reExtractState).toBe(
      'extracting',
    );

    await act(async () => {
      secondPending.resolve(makeLetter());
      expect(await secondRegeneration).toEqual({
        accepted: true,
        shouldRestoreFocus: true,
      });
    });
    expect(result.current.entitySectionProps.reExtractState).toBe('done');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.entitySectionProps.reExtractState).toBe('idle');
  });
});
