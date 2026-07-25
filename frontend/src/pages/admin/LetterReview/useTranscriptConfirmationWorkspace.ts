import {
  useCallback,
  useState,
} from 'react';
import { confirmTranscript } from '../../../api/admin/letters';
import { useToast } from '../../../contexts/ToastContext';
import type { Letter } from '../../../types/Letter';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';
import type { LetterReviewVisit } from './useLetterReviewVisit';

interface ConfirmationDraft {
  sender: string;
  recipient: string;
}

interface TranscriptConfirmationSession {
  owner: LetterReviewVisit;
  dialog: ConfirmationDraft | null;
}

interface UseTranscriptConfirmationWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  sender: string;
  recipient: string;
  executeLetterMutation: ExecuteLetterReviewMutation;
}

const sessionFrom = (
  owner: LetterReviewVisit,
): TranscriptConfirmationSession => ({
  owner,
  dialog: null,
});

/**
 * Owns transcript-confirmation intent for one committed Letter Review visit.
 *
 * This workspace owns only the correction draft, exact request envelope, and
 * accepted-result feedback. The shared mutation executor remains the sole
 * owner of saving, autosave ordering, guarded adoption, hydration, and errors.
 */
export function useTranscriptConfirmationWorkspace({
  visit,
  letter,
  sender,
  recipient,
  executeLetterMutation,
}: UseTranscriptConfirmationWorkspaceOptions) {
  const { showToast } = useToast();
  const [storedSession, setStoredSession] = useState(
    () => sessionFrom(visit),
  );
  const session = storedSession.owner === visit
    ? storedSession
    : sessionFrom(visit);

  const updateSession = useCallback((
    update: (
      current: TranscriptConfirmationSession,
    ) => TranscriptConfirmationSession,
  ) => {
    setStoredSession((current) => update(
      current.owner === visit
        ? current
        : sessionFrom(visit),
    ));
  }, [visit]);

  const openDialog = useCallback(() => {
    if (!visit.isActive() || !letter) return;
    updateSession((current) => ({
      ...current,
      dialog: {
        sender: sender || '',
        recipient: recipient || '',
      },
    }));
  }, [
    letter,
    recipient,
    sender,
    updateSession,
    visit,
  ]);

  const closeDialog = useCallback(() => {
    if (!visit.isActive()) return;
    updateSession((current) => ({
      ...current,
      dialog: null,
    }));
  }, [updateSession, visit]);

  const changeDialogField = useCallback((
    field: keyof ConfirmationDraft,
    value: string,
  ) => {
    if (!visit.isActive()) return;
    updateSession((current) => (
      current.dialog
        ? {
            ...current,
            dialog: {
              ...current.dialog,
              [field]: value,
            },
          }
        : current
    ));
  }, [updateSession, visit]);

  const confirm = useCallback(async (): Promise<boolean> => {
    if (!visit.isActive() || !letter || !session.dialog) {
      return false;
    }

    const target = {
      id: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
      confirmedSender: session.dialog.sender || undefined,
      confirmedRecipient: session.dialog.recipient || undefined,
    };
    updateSession((current) => ({
      ...current,
      dialog: null,
    }));

    let accepted = false;
    await executeLetterMutation({
      request: () => confirmTranscript(
        target.id,
        target.primarySourceRevision,
        {
          confirmedSender: target.confirmedSender,
          confirmedRecipient: target.confirmedRecipient,
        },
      ),
      failureMessage: 'Failed to confirm transcript',
      afterAdopt: () => {
        if (!visit.isActive()) return;
        accepted = true;
        showToast(
          'Transcript confirmed — metadata extracted',
          'success',
        );
      },
    });
    return accepted;
  }, [
    executeLetterMutation,
    letter,
    session.dialog,
    showToast,
    updateSession,
    visit,
  ]);

  return {
    openDialog,
    confirm,
    dialogProps: {
      isOpen: session.dialog !== null,
      sender: session.dialog?.sender ?? '',
      recipient: session.dialog?.recipient ?? '',
      onSenderChange: (value: string) => {
        changeDialogField('sender', value);
      },
      onRecipientChange: (value: string) => {
        changeDialogField('recipient', value);
      },
      onClose: closeDialog,
      onConfirm: () => {
        void confirm();
      },
    },
  } as const;
}
