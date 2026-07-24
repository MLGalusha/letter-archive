import { useCallback, useRef, useState } from 'react';
import {
  ApiError,
  getErrorMessage,
  SOURCE_REVISION_CHANGED_ERROR_CODE,
} from '../../../api/client';
import type { LetterReviewVisit } from './useLetterReviewVisit';

type ToastType = 'success' | 'error' | 'info';
type ShowToast = (message: string, type: ToastType) => void;

export interface LetterSourceConflict {
  detail: string;
}

interface LetterSourceConflictState extends LetterSourceConflict {
  visit: LetterReviewVisit;
}

/**
 * Owns the terminal state for a stale Letter Review tab.
 *
 * A source-bound 409 means the draft on screen was derived from a different
 * page epoch. Keep that draft mounted, block further mutations, and require an
 * explicit authoritative reload instead of repeatedly submitting the stale
 * revision.
 */
export function useLetterSourceConflict(
  showToast: ShowToast,
  visit: LetterReviewVisit,
) {
  const [conflictState, setConflictState] =
    useState<LetterSourceConflictState | null>(null);
  const conflictStateRef = useRef<LetterSourceConflictState | null>(null);
  // A same-visit DTO refresh must never rehabilitate drafts derived from the
  // stale source. A different route visit owns a clean draft even after an
  // A -> B -> A navigation to the same letter ID.
  const sourceConflict = conflictState?.visit === visit && visit.isActive()
    ? { detail: conflictState.detail }
    : null;

  const markSourceConflict = useCallback((detail: string): void => {
    if (!visit.isActive()) return;

    if (conflictStateRef.current?.visit !== visit) {
      const nextConflict = { detail, visit };
      conflictStateRef.current = nextConflict;
      setConflictState(nextConflict);
    }
    showToast(
      'This letter changed in another session. Your local draft is still here; reload before making more changes.',
      'error',
    );
  }, [showToast, visit]);

  const handleMutationError = useCallback((
    error: unknown,
    fallback: string,
  ): boolean => {
    // Stale mutation owners are terminal from their own perspective, but they
    // cannot report into or block the active visit.
    if (!visit.isActive()) return true;

    const detail = getErrorMessage(error, fallback);
    if (
      error instanceof ApiError
      && error.status === 409
      && error.code === SOURCE_REVISION_CHANGED_ERROR_CODE
    ) {
      markSourceConflict(detail);
      return true;
    }

    showToast(detail, 'error');
    return false;
  }, [markSourceConflict, showToast, visit]);

  const isMutationBlocked = useCallback(
    () => (
      !visit.isActive()
      || conflictStateRef.current?.visit === visit
    ),
    [visit],
  );

  return {
    handleMutationError,
    isMutationBlocked,
    markSourceConflict,
    mutationsBlocked: sourceConflict !== null,
    sourceConflict,
  };
}
