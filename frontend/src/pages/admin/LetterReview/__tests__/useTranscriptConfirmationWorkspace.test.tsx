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
import { useTranscriptConfirmationWorkspace } from '../useTranscriptConfirmationWorkspace';

const {
  confirmTranscriptMock,
  showToastMock,
} = vi.hoisted(() => ({
  confirmTranscriptMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock('../../../../api/admin/letters', () => ({
  confirmTranscript: confirmTranscriptMock,
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
    transcriptStatus: 'EDITED',
    metadataContentStatus: 'EMPTY',
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

describe('useTranscriptConfirmationWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    confirmTranscriptMock.mockResolvedValue(makeLetter({
      transcriptConfirmedAt: '2026-07-24T13:00:00.000Z',
    }));
  });

  it('seeds and controls a fresh draft from the live editor on every open', () => {
    const currentVisit = visit('letter-a', { current: true });
    const executeLetterMutation = adoptingExecutor();
    const { result, rerender } = renderHook(
      ({ sender, recipient }) => useTranscriptConfirmationWorkspace({
        visit: currentVisit,
        letter: makeLetter(),
        sender,
        recipient,
        executeLetterMutation,
      }),
      {
        initialProps: {
          sender: 'Visible Sender',
          recipient: 'Visible Recipient',
        },
      },
    );

    act(() => {
      result.current.openDialog();
    });
    expect(result.current.dialogProps).toMatchObject({
      isOpen: true,
      sender: 'Visible Sender',
      recipient: 'Visible Recipient',
    });

    act(() => {
      result.current.dialogProps.onSenderChange('Draft Sender');
      result.current.dialogProps.onRecipientChange('Draft Recipient');
    });
    expect(result.current.dialogProps).toMatchObject({
      sender: 'Draft Sender',
      recipient: 'Draft Recipient',
    });

    act(() => {
      result.current.dialogProps.onClose();
    });
    rerender({
      sender: 'New Visible Sender',
      recipient: 'New Visible Recipient',
    });
    act(() => {
      result.current.openDialog();
    });
    expect(result.current.dialogProps).toMatchObject({
      isOpen: true,
      sender: 'New Visible Sender',
      recipient: 'New Visible Recipient',
    });
    expect(executeLetterMutation).not.toHaveBeenCalled();
    expect(confirmTranscriptMock).not.toHaveBeenCalled();
  });

  it('snapshots the exact target and raw corrections before executor delay', async () => {
    const executorGate = deferred<void>();
    const updated = makeLetter({
      transcriptConfirmedAt: '2026-07-24T13:00:00.000Z',
      metadata: {
        sender: 'Returned Sender',
        recipient: 'Returned Recipient',
        verified: false,
      },
    });
    confirmTranscriptMock.mockResolvedValue(updated);
    const executeLetterMutation: ExecuteLetterReviewMutation =
      vi.fn(async (mutation) => {
        await executorGate.promise;
        const adopted = await mutation.request();
        mutation.afterAdopt?.(adopted);
      });
    const currentVisit = visit('letter-a', { current: true });
    const { result, rerender } = renderHook(
      ({ letter, sender, recipient }) => (
        useTranscriptConfirmationWorkspace({
          visit: currentVisit,
          letter,
          sender,
          recipient,
          executeLetterMutation,
        })
      ),
      {
        initialProps: {
          letter: makeLetter(),
          sender: 'Visible Sender',
          recipient: 'Visible Recipient',
        },
      },
    );

    act(() => {
      result.current.openDialog();
      result.current.dialogProps.onSenderChange('  Raw Sender  ');
      result.current.dialogProps.onRecipientChange('');
    });
    let confirmation!: Promise<boolean>;
    await act(async () => {
      confirmation = result.current.confirm();
      await Promise.resolve();
    });
    expect(result.current.dialogProps.isOpen).toBe(false);
    expect(executeLetterMutation).toHaveBeenCalledTimes(1);
    expect(executeLetterMutation).toHaveBeenCalledWith(expect.objectContaining({
      failureMessage: 'Failed to confirm transcript',
    }));
    expect(confirmTranscriptMock).not.toHaveBeenCalled();

    rerender({
      letter: makeLetter({ primarySourceRevision: 99 }),
      sender: 'Later Sender',
      recipient: 'Later Recipient',
    });

    let accepted = false;
    await act(async () => {
      executorGate.resolve();
      accepted = await confirmation;
    });

    expect(accepted).toBe(true);
    expect(confirmTranscriptMock).toHaveBeenCalledWith(
      'letter-a',
      3,
      {
        confirmedSender: '  Raw Sender  ',
        confirmedRecipient: undefined,
      },
    );
    expect(showToastMock).toHaveBeenCalledWith(
      'Transcript confirmed — metadata extracted',
      'success',
    );
  });

  it('publishes no success when the executor withholds adoption', async () => {
    const executeLetterMutation: ExecuteLetterReviewMutation =
      vi.fn(async (mutation) => {
        await mutation.request();
      });
    const currentVisit = visit('letter-a', { current: true });
    const { result } = renderHook(() => (
      useTranscriptConfirmationWorkspace({
        visit: currentVisit,
        letter: makeLetter(),
        sender: '',
        recipient: '',
        executeLetterMutation,
      })
    ));

    act(() => {
      result.current.openDialog();
    });
    let accepted = true;
    await act(async () => {
      accepted = await result.current.confirm();
    });

    expect(accepted).toBe(false);
    expect(confirmTranscriptMock).toHaveBeenCalledWith(
      'letter-a',
      3,
      {
        confirmedSender: undefined,
        confirmedRecipient: undefined,
      },
    );
    expect(showToastMock).not.toHaveBeenCalled();
  });

  it('isolates first-A state, controls, and late completion from B and fresh A', async () => {
    const pending = deferred<Letter>();
    confirmTranscriptMock.mockReturnValue(pending.promise);
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
      ({ currentVisit, letter, sender, recipient }) => (
        useTranscriptConfirmationWorkspace({
          visit: currentVisit,
          letter,
          sender,
          recipient,
          executeLetterMutation,
        })
      ),
      {
        initialProps: {
          currentVisit: visits.firstA,
          letter: makeLetter(),
          sender: 'First-A Sender',
          recipient: 'First-A Recipient',
        },
      },
    );

    act(() => {
      result.current.openDialog();
      result.current.dialogProps.onSenderChange('Submitted First-A Sender');
    });
    const staleOpen = result.current.openDialog;
    const staleClose = result.current.dialogProps.onClose;
    const staleChange = result.current.dialogProps.onSenderChange;
    const staleConfirm = result.current.confirm;
    let firstConfirmation!: Promise<boolean>;
    await act(async () => {
      firstConfirmation = result.current.confirm();
      await Promise.resolve();
    });
    expect(confirmTranscriptMock).toHaveBeenCalledTimes(1);

    firstAActive.current = false;
    bActive.current = true;
    rerender({
      currentVisit: visits.b,
      letter: makeLetter({ id: 'letter-b', title: 'Letter B' }),
      sender: 'B Sender',
      recipient: 'B Recipient',
    });
    bActive.current = false;
    freshAActive.current = true;
    rerender({
      currentVisit: visits.freshA,
      letter: makeLetter(),
      sender: 'Fresh-A Sender',
      recipient: 'Fresh-A Recipient',
    });

    act(() => {
      result.current.openDialog();
      result.current.dialogProps.onSenderChange('Fresh-A Draft');
      staleOpen();
      staleChange('Stale Overwrite');
      staleClose();
    });
    let staleAccepted = true;
    await act(async () => {
      staleAccepted = await staleConfirm();
    });
    expect(staleAccepted).toBe(false);
    expect(confirmTranscriptMock).toHaveBeenCalledTimes(1);
    expect(result.current.dialogProps).toMatchObject({
      isOpen: true,
      sender: 'Fresh-A Draft',
      recipient: 'Fresh-A Recipient',
    });

    let firstAccepted = true;
    await act(async () => {
      pending.resolve(makeLetter({
        transcriptConfirmedAt: '2026-07-24T13:00:00.000Z',
      }));
      firstAccepted = await firstConfirmation;
    });
    expect(firstAccepted).toBe(false);
    expect(result.current.dialogProps).toMatchObject({
      isOpen: true,
      sender: 'Fresh-A Draft',
      recipient: 'Fresh-A Recipient',
    });
    expect(showToastMock).not.toHaveBeenCalled();
  });
});
