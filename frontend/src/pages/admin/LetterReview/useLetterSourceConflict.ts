import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getErrorMessage,
  SOURCE_REVISION_CHANGED_ERROR_CODE,
} from '../../../api/client';

type ToastType = 'success' | 'error' | 'info';
type ShowToast = (message: string, type: ToastType) => void;

export interface LetterSourceConflict {
  detail: string;
}

export interface LetterSourceIdentity {
  letterId?: string;
}

interface LetterSourceConflictState extends LetterSourceConflict {
  identityKey: string;
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
  identity: LetterSourceIdentity,
) {
  const [conflictState, setConflictState] =
    useState<LetterSourceConflictState | null>(null);
  const conflictStateRef = useRef<LetterSourceConflictState | null>(null);
  // A same-letter DTO refresh must never rehabilitate drafts derived from the
  // stale source. Only navigating to another letter (a new owner key) or a
  // complete application reload may clear this terminal state.
  const identityKey = identity.letterId ?? '';
  const previousIdentityKeyRef = useRef(identityKey);
  useEffect(() => {
    if (previousIdentityKeyRef.current === identityKey) return;
    previousIdentityKeyRef.current = identityKey;
    conflictStateRef.current = null;
    // This is an intentional state-machine transition: committed navigation
    // owns a different draft, so the previous letter's terminal state expires.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConflictState(null);
  }, [identityKey]);
  const sourceConflict = conflictState?.identityKey === identityKey
    ? { detail: conflictState.detail }
    : null;

  const markSourceConflict = useCallback((detail: string): void => {
    if (conflictStateRef.current?.identityKey !== identityKey) {
      const nextConflict = { detail, identityKey };
      conflictStateRef.current = nextConflict;
      setConflictState(nextConflict);
    }
    showToast(
      'This letter changed in another session. Your local draft is still here; reload before making more changes.',
      'error',
    );
  }, [identityKey, showToast]);

  const handleMutationError = useCallback((
    error: unknown,
    fallback: string,
  ): boolean => {
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
  }, [markSourceConflict, showToast]);

  const isMutationBlocked = useCallback(
    () => conflictStateRef.current?.identityKey === identityKey,
    [identityKey],
  );

  return {
    handleMutationError,
    isMutationBlocked,
    markSourceConflict,
    mutationsBlocked: sourceConflict !== null,
    sourceConflict,
  };
}
