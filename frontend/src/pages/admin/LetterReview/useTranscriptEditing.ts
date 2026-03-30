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

interface UseTranscriptEditingOptions {
  letterId?: string;
  letter: Letter | null;
  transcript: string;
  setLetter: Dispatch<SetStateAction<Letter | null>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setTranscript: Dispatch<SetStateAction<string>>;
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
    if (!letterId) {
      return;
    }

    setSaving(true);

    try {
      const updated = await verifyTranscript(letterId);
      setLetter(updated);
      resetEditingState();
      showToast('Transcript verified', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to verify transcript',
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [letterId, resetEditingState, setLetter, setSaving, showToast]);

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
      const updated = await unverifyTranscript(letterId);
      setLetter(updated);
      setIsTranscriptEditing(true);
      setHasTranscriptChanges(false);
      showToast('Verification removed', 'info');
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : 'Failed to unverify transcript',
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [
    closeEditTooltip,
    letter?.transcriptStatus,
    letterId,
    setLetter,
    setSaving,
    showToast,
    transcript,
  ]);

  const handleTranscriptRevert = useCallback(async () => {
    if (!letterId || originalTranscriptText === null) {
      return;
    }

    if (!window.confirm('Discard all changes since editing started?')) {
      return;
    }

    setSaving(true);

    try {
      const updated = await updateLetter(letterId, {
        transcriptionText: originalTranscriptText,
      });
      setLetter(updated);
      setTranscript(originalTranscriptText);

      if (editorRef.current) {
        editorRef.current.innerHTML =
          highlightTranscriptMarkers(originalTranscriptText);
      }

      if (originalTranscriptVerified) {
        const verifiedLetter = await verifyTranscript(letterId);
        setLetter(verifiedLetter);
        showToast('Changes reverted and verification restored', 'success');
      } else {
        showToast('Changes reverted', 'success');
      }

      resetEditingState();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to revert changes',
        'error',
      );
    } finally {
      setSaving(false);
    }
  }, [
    editorRef,
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
