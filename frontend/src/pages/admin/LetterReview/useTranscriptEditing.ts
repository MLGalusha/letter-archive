import {
  startTransition,
  useCallback,
  useState,
  type Dispatch,
  type MouseEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  unverifyTranscript,
  updateLetter,
  verifyTranscript,
} from '../../../api/admin';
import { useTooltip } from '../../../hooks/useTooltip';
import type { Letter } from '../../../types/Letter';
import { highlightTranscriptMarkers } from '../../../utils/transcriptHighlight';
import type { AutoSaveData } from './useAutoSave';

type ToastType = 'success' | 'error' | 'info';
type ShowToast = (message: string, type: ToastType) => void;
type HandleMutationError = (error: unknown, fallback: string) => boolean;

interface UseTranscriptEditingOptions {
  letterId?: string;
  letter: Letter | null;
  transcript: string;
  setLetter: Dispatch<SetStateAction<Letter | null>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setTranscript: Dispatch<SetStateAction<string>>;
  handleMutationError: HandleMutationError;
  showToast: ShowToast;
  editorRef: RefObject<HTMLDivElement | null>;
  triggerAutoSave: (data: AutoSaveData) => Promise<void>;
}

export function useTranscriptEditing({
  letterId,
  letter,
  transcript,
  setLetter,
  setSaving,
  setTranscript,
  handleMutationError,
  showToast,
  editorRef,
  triggerAutoSave,
}: UseTranscriptEditingOptions) {
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(false);
  const [originalTranscriptText, setOriginalTranscriptText] = useState<
    string | null
  >(null);
  const [originalTranscriptVerified, setOriginalTranscriptVerified] =
    useState(false);
  const [hasTranscriptChanges, setHasTranscriptChanges] = useState(false);

  const {
    show: showEditTooltip,
    position: tooltipPosition,
    ref: editTooltipRef,
    showAt: showEditTooltipAt,
    close: closeEditTooltip,
  } = useTooltip();

  const resetEditingState = useCallback(() => {
    setIsTranscriptEditing(false);
    setOriginalTranscriptText(null);
    setOriginalTranscriptVerified(false);
    setHasTranscriptChanges(false);
  }, []);

  const handleTranscriptInput = useCallback(
    (newText: string) => {
      startTransition(() => {
        setTranscript(newText);
        setHasTranscriptChanges(
          originalTranscriptText !== null && newText !== originalTranscriptText,
        );
      });
      void triggerAutoSave({ transcriptionText: newText });
    },
    [originalTranscriptText, setTranscript, triggerAutoSave],
  );

  const handleVerifyTranscript = useCallback(async () => {
    if (!letterId || !letter) {
      return;
    }

    setSaving(true);

    try {
      const updated = await verifyTranscript(
        letterId,
        letter.primarySourceRevision,
      );
      const hadReadingText = letter?.readingText;
      setLetter(updated);
      resetEditingState();
      if (!hadReadingText && updated.readingText) {
        showToast('Transcript verified — reading view generated', 'success');
      } else {
        showToast('Transcript verified', 'success');
      }
    } catch (error) {
      handleMutationError(error, 'Failed to verify transcript');
    } finally {
      setSaving(false);
    }
  }, [
    handleMutationError,
    letter,
    letterId,
    resetEditingState,
    setLetter,
    setSaving,
    showToast,
  ]);

  const handleTranscriptClick = useCallback(
    (event: MouseEvent) => {
      if (
        !letter?.transcriptStatus ||
        letter.transcriptStatus !== 'VERIFIED' ||
        isTranscriptEditing
      ) {
        return;
      }

      showEditTooltipAt(event.clientX, event.clientY);
    },
    [isTranscriptEditing, letter?.transcriptStatus, showEditTooltipAt],
  );

  const handleTranscriptDoubleClick = useCallback(async () => {
    if (
      !letter?.transcriptStatus ||
      letter.transcriptStatus !== 'VERIFIED' ||
      !letterId
    ) {
      return;
    }

    closeEditTooltip();
    setOriginalTranscriptText(transcript);
    setOriginalTranscriptVerified(true);
    setSaving(true);

    try {
      const updated = await unverifyTranscript(
        letterId,
        letter.primarySourceRevision,
      );
      setLetter(updated);
      setIsTranscriptEditing(true);
      setHasTranscriptChanges(false);
      showToast('Verification removed', 'info');
    } catch (error) {
      handleMutationError(error, 'Failed to unverify transcript');
    } finally {
      setSaving(false);
    }
  }, [
    closeEditTooltip,
    handleMutationError,
    letter,
    letterId,
    setLetter,
    setSaving,
    showToast,
    transcript,
  ]);

  const handleTranscriptRevert = useCallback(async () => {
    if (!letterId || !letter || originalTranscriptText === null) {
      return;
    }

    if (!window.confirm('Discard all changes since editing started?')) {
      return;
    }

    setSaving(true);

    try {
      const updated = await updateLetter(letterId, {
        primarySourceRevision: letter.primarySourceRevision,
        transcriptionText: originalTranscriptText,
      });
      setLetter(updated);
      setTranscript(originalTranscriptText);

      if (editorRef.current) {
        editorRef.current.innerHTML =
          highlightTranscriptMarkers(originalTranscriptText);
      }

      if (originalTranscriptVerified) {
        const verifiedLetter = await verifyTranscript(
          letterId,
          updated.primarySourceRevision,
        );
        setLetter(verifiedLetter);
        showToast('Changes reverted and verification restored', 'success');
      } else {
        showToast('Changes reverted', 'success');
      }

      resetEditingState();
    } catch (error) {
      handleMutationError(error, 'Failed to revert changes');
    } finally {
      setSaving(false);
    }
  }, [
    editorRef,
    handleMutationError,
    letter,
    letterId,
    originalTranscriptText,
    originalTranscriptVerified,
    resetEditingState,
    setLetter,
    setSaving,
    setTranscript,
    showToast,
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
    originalTranscriptText,
    showEditTooltip,
    tooltipPosition,
  };
}
