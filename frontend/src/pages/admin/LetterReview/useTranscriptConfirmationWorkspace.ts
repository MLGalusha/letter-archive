import {
  useCallback,
  useState,
} from 'react';
import { useToast } from '../../../contexts/ToastContext';
import type { Letter } from '../../../types/Letter';
import { sha256Utf8 } from '../../../utils/sha256';
import {
  getTranscriptConfirmationFeedback,
  resolveTranscriptConfirmationOutcome,
  TranscriptConfirmationAcceptedError,
  TranscriptConfirmationOutcomeUnknownError,
  type ResolvedTranscriptConfirmation,
} from '../transcriptConfirmationOutcome';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';
import type { LetterReviewVisit } from './useLetterReviewVisit';

interface ConfirmationDraft {
  sender: string;
  recipient: string;
}

interface TranscriptConfirmationSession {
  owner: LetterReviewVisit;
  dialog: ConfirmationDraft | null;
  replayBlocked: boolean;
}

interface UseTranscriptConfirmationWorkspaceOptions {
  visit: LetterReviewVisit;
  letter: Letter | null;
  transcriptText: string;
  sender: string;
  recipient: string;
  executeLetterMutation: ExecuteLetterReviewMutation;
}

const sessionFrom = (
  owner: LetterReviewVisit,
): TranscriptConfirmationSession => ({
  owner,
  dialog: null,
  replayBlocked: false,
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
  transcriptText,
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
    if (!visit.isActive() || !letter || session.replayBlocked) return;
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
    session.replayBlocked,
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
    if (
      !visit.isActive()
      || !letter
      || !session.dialog
      || session.replayBlocked
    ) {
      return false;
    }

    const target = {
      id: letter.id,
      primarySourceRevision: letter.primarySourceRevision,
      transcriptText,
      confirmedSender: session.dialog.sender || undefined,
      confirmedRecipient: session.dialog.recipient || undefined,
    };
    updateSession((current) => ({
      ...current,
      dialog: null,
    }));

    let accepted = false;
    let outcome: ResolvedTranscriptConfirmation | undefined;
    await executeLetterMutation({
      request: async () => {
        try {
          outcome = await resolveTranscriptConfirmationOutcome({
            letterId: target.id,
            primarySourceRevision: target.primarySourceRevision,
            transcriptDigest: await sha256Utf8(target.transcriptText),
            confirmedSender: target.confirmedSender,
            confirmedRecipient: target.confirmedRecipient,
          });
          return outcome.letter;
        } catch (error) {
          if (
            visit.isActive()
            && (
              error instanceof TranscriptConfirmationAcceptedError
              || error instanceof TranscriptConfirmationOutcomeUnknownError
            )
          ) {
            updateSession((current) => ({
              ...current,
              replayBlocked: true,
            }));
          }
          throw error;
        }
      },
      failureMessage: 'Failed to confirm transcript',
      afterAdopt: () => {
        if (!visit.isActive() || !outcome) return;
        accepted = true;
        const feedback = getTranscriptConfirmationFeedback(outcome);
        showToast(feedback.message, feedback.type);
      },
    });
    return accepted;
  }, [
    executeLetterMutation,
    letter,
    session.dialog,
    session.replayBlocked,
    showToast,
    transcriptText,
    updateSession,
    visit,
  ]);

  return {
    openDialog,
    confirm,
    replayBlocked: session.replayBlocked,
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
