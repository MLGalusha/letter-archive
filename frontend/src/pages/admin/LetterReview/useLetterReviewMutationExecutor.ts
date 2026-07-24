import { useCallback, useMemo } from 'react';
import type { Letter } from '../../../types/Letter';
import type { BeginLetterSaving } from './useLetterSavingState';
import type { LetterReviewVisit } from './useLetterReviewVisit';

type HandleMutationError = (
  error: unknown,
  fallback: string,
) => boolean;

interface UseLetterReviewMutationExecutorOptions {
  visit: LetterReviewVisit;
  beginSaving: BeginLetterSaving;
  flushPendingSaves: () => Promise<boolean>;
  tryAdoptLetter: (letter: Letter) => boolean;
  hydrateAdoptedLetter: (letter: Letter) => void;
  handleMutationError: HandleMutationError;
}

interface LetterReviewMutation {
  request: () => Promise<Letter>;
  failureMessage: string;
  afterAdopt?: (letter: Letter) => void;
}

export type ExecuteLetterReviewMutation = (
  mutation: LetterReviewMutation,
) => Promise<void>;

/**
 * Owns the common boundary around one Letter-returning direct mutation.
 *
 * Domain callers still own request payloads, confirmation, and success copy.
 * One optional synchronous completion keeps domain state inside the guarded
 * adoption-to-release interval without introducing lifecycle callback bags.
 * This boundary owns exactly the cross-domain invariants: one saving lease,
 * per-visit request ordering, autosave flush ordering, route-visit liveness,
 * guarded DTO adoption, full hydration, request-failure reporting, and one
 * release. Post-adoption code is intentionally outside the request error
 * boundary: a local programming error must not report a committed server write
 * as a failed mutation that is safe to retry.
 */
export function useLetterReviewMutationExecutor({
  visit,
  beginSaving,
  flushPendingSaves,
  tryAdoptLetter,
  hydrateAdoptedLetter,
  handleMutationError,
}: UseLetterReviewMutationExecutorOptions): ExecuteLetterReviewMutation {
  const queue = useMemo(() => ({
    visit,
    tail: Promise.resolve(),
  }), [visit]);

  return useCallback(({
    request,
    failureMessage,
    afterAdopt,
  }: LetterReviewMutation): Promise<void> => {
    const releaseSaving = beginSaving();
    const previous = queue.tail;

    const execution = (async () => {
      await previous;

      try {
        if (!visit.isActive()) return;

        let updatedLetter: Letter;
        try {
          if (!await flushPendingSaves()) return;
          updatedLetter = await request();
        } catch (error) {
          handleMutationError(error, failureMessage);
          return;
        }

        if (!tryAdoptLetter(updatedLetter)) return;
        hydrateAdoptedLetter(updatedLetter);
        afterAdopt?.(updatedLetter);
      } finally {
        releaseSaving();
      }
    })();

    queue.tail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }, [
    beginSaving,
    flushPendingSaves,
    handleMutationError,
    hydrateAdoptedLetter,
    queue,
    tryAdoptLetter,
    visit,
  ]);
}
