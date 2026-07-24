import { useCallback } from 'react';
import {
  addNote,
  updateNoteStatus,
} from '../../../api/admin/letters';
import type {
  Letter,
  StructuredNoteDraft,
} from '../../../types/Letter';
import type { ExecuteLetterReviewMutation } from './useLetterReviewMutationExecutor';

type NoteStatus = 'resolved' | 'dismissed';

interface UseStructuredNoteActionsOptions {
  letter: Letter | null;
  executeLetterMutation: ExecuteLetterReviewMutation;
  showToast: (
    message: string,
    type: 'success' | 'error' | 'info',
  ) => void;
}

/**
 * Owns the two source-fenced mutations for the structured-notes workspace.
 */
export function useStructuredNoteActions({
  letter,
  executeLetterMutation,
  showToast,
}: UseStructuredNoteActionsOptions) {
  const handleNoteStatusChange = useCallback(async (
    noteId: string,
    status: NoteStatus,
  ) => {
    if (!letter) return;
    const action = status === 'resolved' ? 'resolve' : 'dismiss';

    await executeLetterMutation({
      request: () => updateNoteStatus(
        letter.id,
        letter.primarySourceRevision,
        noteId,
        status,
      ),
      failureMessage: `Failed to ${action} note`,
      afterAdopt: () => {
        showToast(`Note ${status}`, 'success');
      },
    });
  }, [executeLetterMutation, letter, showToast]);

  const handleAddNote = useCallback(async (
    note: StructuredNoteDraft,
  ) => {
    if (!letter) return;

    await executeLetterMutation({
      request: () => addNote(
        letter.id,
        letter.primarySourceRevision,
        note,
      ),
      failureMessage: 'Failed to add note',
      afterAdopt: () => {
        showToast('Note added', 'success');
      },
    });
  }, [executeLetterMutation, letter, showToast]);

  return {
    handleAddNote,
    handleNoteStatusChange,
  } as const;
}
