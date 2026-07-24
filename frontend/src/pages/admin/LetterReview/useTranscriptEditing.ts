import {
  startTransition,
  useCallback,
  useLayoutEffect,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from 'react';
import {
  unverifyTranscript,
  updateLetter,
  verifyTranscript,
} from '../../../api/admin';
import { useTooltip } from '../../../hooks/useTooltip';
import type { Letter } from '../../../types/Letter';
import type { AutoSaveData } from './useAutoSave';
import type { BeginLetterSaving } from './useLetterSavingState';
import type { LetterReviewVisit } from './useLetterReviewVisit';

type ToastType = 'success' | 'error' | 'info';
type ShowToast = (message: string, type: ToastType) => void;
type HandleMutationError = (error: unknown, fallback: string) => boolean;

interface UseTranscriptEditingOptions {
  visit: LetterReviewVisit;
  letterId?: string;
  letter: Letter | null;
  transcript: string;
  tryAdoptLetter: (letter: Letter) => boolean;
  beginSaving: BeginLetterSaving;
  flushPendingSaves: () => Promise<boolean>;
  setTranscript: Dispatch<SetStateAction<string>>;
  handleMutationError: HandleMutationError;
  showToast: ShowToast;
  triggerAutoSave: (data: AutoSaveData) => Promise<void>;
}

interface TranscriptEditingSession {
  owner: LetterReviewVisit;
  isTranscriptEditing: boolean;
  originalTranscriptText: string | null;
  hasTranscriptChanges: boolean;
}

const sessionFrom = (owner: LetterReviewVisit): TranscriptEditingSession => ({
  owner,
  isTranscriptEditing: false,
  originalTranscriptText: null,
  hasTranscriptChanges: false,
});

export function useTranscriptEditing({
  visit,
  letterId,
  letter,
  transcript,
  tryAdoptLetter,
  beginSaving,
  flushPendingSaves,
  setTranscript,
  handleMutationError,
  showToast,
  triggerAutoSave,
}: UseTranscriptEditingOptions) {
  const [storedSession, setStoredSession] = useState(
    () => sessionFrom(visit),
  );
  const sessionIsCurrent = storedSession.owner === visit;
  const session = sessionIsCurrent
    ? storedSession
    : sessionFrom(visit);
  const {
    hasTranscriptChanges,
    isTranscriptEditing,
    originalTranscriptText,
  } = session;

  const {
    show: storedTooltipIsOpen,
    position: tooltipPosition,
    ref: editTooltipRef,
    showAt: showEditTooltipAt,
    close: closeEditTooltip,
  } = useTooltip();

  useLayoutEffect(() => {
    setStoredSession((current) => (
      current.owner === visit ? current : sessionFrom(visit)
    ));
    closeEditTooltip();
  }, [closeEditTooltip, visit]);

  const updateSession = useCallback((
    patch: Partial<Omit<TranscriptEditingSession, 'owner'>>,
  ) => {
    setStoredSession((current) => (
      current.owner === visit
        ? { ...current, ...patch }
        : current
    ));
  }, [visit]);

  const resetEditingState = useCallback(() => {
    updateSession({
      isTranscriptEditing: false,
      originalTranscriptText: null,
      hasTranscriptChanges: false,
    });
  }, [updateSession]);

  const handleTranscriptInput = useCallback(
    (newText: string) => {
      if (!visit.isActive()) {
        return;
      }

      startTransition(() => {
        setTranscript(newText);
        updateSession({
          hasTranscriptChanges:
            originalTranscriptText !== null
            && newText !== originalTranscriptText,
        });
      });
      void triggerAutoSave({ transcriptionText: newText });
    },
    [
      originalTranscriptText,
      setTranscript,
      triggerAutoSave,
      updateSession,
      visit,
    ],
  );

  const handleVerifyTranscript = useCallback(async () => {
    if (!visit.isActive() || !letterId || !letter) {
      return;
    }

    const releaseSaving = beginSaving();

    try {
      if (!visit.isActive() || !await flushPendingSaves()) return;

      const updated = await verifyTranscript(
        letterId,
        letter.primarySourceRevision,
      );
      const hadReadingText = letter?.readingText;
      if (!tryAdoptLetter(updated)) return;
      setTranscript(updated.transcript.fullText);
      resetEditingState();
      if (!hadReadingText && updated.readingText) {
        showToast('Transcript verified — reading view generated', 'success');
      } else {
        showToast('Transcript verified', 'success');
      }
    } catch (error) {
      handleMutationError(error, 'Failed to verify transcript');
    } finally {
      releaseSaving();
    }
  }, [
    handleMutationError,
    letter,
    letterId,
    resetEditingState,
    beginSaving,
    flushPendingSaves,
    setTranscript,
    showToast,
    tryAdoptLetter,
    visit,
  ]);

  const handleTranscriptClick = useCallback(
    (event: MouseEvent) => {
      if (
        !visit.isActive() ||
        !letter?.transcriptStatus ||
        letter.transcriptStatus !== 'VERIFIED' ||
        isTranscriptEditing
      ) {
        return;
      }

      showEditTooltipAt(event.clientX, event.clientY);
    },
    [
      isTranscriptEditing,
      letter?.transcriptStatus,
      showEditTooltipAt,
      visit,
    ],
  );

  const handleTranscriptDoubleClick = useCallback(async () => {
    if (
      !visit.isActive() ||
      !letter?.transcriptStatus ||
      letter.transcriptStatus !== 'VERIFIED' ||
      !letterId
    ) {
      return;
    }

    closeEditTooltip();
    updateSession({
      originalTranscriptText: transcript,
    });
    const releaseSaving = beginSaving();

    try {
      if (!visit.isActive() || !await flushPendingSaves()) return;

      const updated = await unverifyTranscript(
        letterId,
        letter.primarySourceRevision,
      );
      if (!tryAdoptLetter(updated)) return;
      setTranscript(updated.transcript.fullText);
      updateSession({
        isTranscriptEditing: true,
        hasTranscriptChanges: false,
      });
      showToast('Verification removed', 'info');
    } catch (error) {
      handleMutationError(error, 'Failed to unverify transcript');
    } finally {
      releaseSaving();
    }
  }, [
    closeEditTooltip,
    handleMutationError,
    letter,
    letterId,
    beginSaving,
    flushPendingSaves,
    showToast,
    setTranscript,
    transcript,
    tryAdoptLetter,
    updateSession,
    visit,
  ]);

  const handleTranscriptRevert = useCallback(async () => {
    if (
      !visit.isActive()
      || !letterId
      || !letter
      || originalTranscriptText === null
    ) {
      return;
    }

    if (!window.confirm('Discard all changes since editing started?')) {
      return;
    }

    const releaseSaving = beginSaving();

    try {
      if (!visit.isActive() || !await flushPendingSaves()) return;

      const updated = await updateLetter(letterId, {
        primarySourceRevision: letter.primarySourceRevision,
        transcriptionText: originalTranscriptText,
      });
      if (!tryAdoptLetter(updated)) return;
      setTranscript(originalTranscriptText);

      const verifiedLetter = await verifyTranscript(
        letterId,
        updated.primarySourceRevision,
      );
      if (!tryAdoptLetter(verifiedLetter)) return;
      showToast('Changes reverted and verification restored', 'success');

      resetEditingState();
    } catch (error) {
      handleMutationError(error, 'Failed to revert changes');
    } finally {
      releaseSaving();
    }
  }, [
    handleMutationError,
    letter,
    letterId,
    originalTranscriptText,
    resetEditingState,
    beginSaving,
    flushPendingSaves,
    setTranscript,
    showToast,
    tryAdoptLetter,
    visit,
  ]);

  return {
    editTooltipRef,
    handleTranscriptClick,
    handleTranscriptDoubleClick,
    handleTranscriptInput,
    handleTranscriptRevert,
    handleVerifyTranscript,
    hasTranscriptChanges,
    isTranscriptEditing,
    showEditTooltip: sessionIsCurrent && storedTooltipIsOpen,
    tooltipPosition,
  };
}
