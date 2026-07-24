import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Letter } from '../../../types/Letter';
import type { LetterReviewVisit } from './useLetterReviewVisit';

type MarkSourceConflict = (detail: string) => void;

const SOURCE_REFRESH_CONFLICT =
  'A response for this letter has a different primary-source revision.';

/**
 * Separates authoritative route loads from incremental Letter DTO adoption.
 *
 * Full DTOs returned by source-independent mutations or background reads can
 * otherwise replace a rev-N editor with rev-N+1 while its drafts still belong
 * to rev N. Incremental callers receive a normal React Dispatch, but a
 * same-letter source change is rejected and turns the editor terminal.
 */
export function useGuardedLetterState(
  markSourceConflict: MarkSourceConflict,
  visit: LetterReviewVisit,
) {
  const [storedLetter, setLetterState] = useState<Letter | null>(null);
  const currentLetterRef = useRef<Letter | null>(null);
  // Route ownership is synchronous: during A -> B navigation no hook may see
  // A's DTO paired with B's URL while the B request is still loading.
  const letter = storedLetter?.id === visit.letterId ? storedLetter : null;

  const setAuthoritativeLetter = useCallback((nextLetter: Letter) => {
    if (!visit.isActive() || nextLetter.id !== visit.letterId) return;
    currentLetterRef.current = nextLetter;
    setLetterState(nextLetter);
  }, [visit]);

  const adoptIncrementalLetter = useCallback(
    (nextLetter: Letter | null): boolean => {
      if (!visit.isActive()) {
        return false;
      }

      const currentLetter = currentLetterRef.current;

      if (nextLetter && nextLetter.id !== visit.letterId) {
        return false;
      }

      if (
        currentLetter
        && nextLetter
        && currentLetter.id === nextLetter.id
        && currentLetter.primarySourceRevision
          !== nextLetter.primarySourceRevision
      ) {
        markSourceConflict(SOURCE_REFRESH_CONFLICT);
        return false;
      }

      // Incremental responses from a route that has already been left are
      // stale by ownership, even when their source revision happens to match.
      if (
        currentLetter
        && nextLetter
        && currentLetter.id !== nextLetter.id
      ) {
        return false;
      }

      currentLetterRef.current = nextLetter;
      setLetterState(nextLetter);
      return true;
    },
    [markSourceConflict, visit],
  );

  const tryAdoptLetter = useCallback(
    (nextLetter: Letter) => adoptIncrementalLetter(nextLetter),
    [adoptIncrementalLetter],
  );

  const setLetter = useCallback<Dispatch<SetStateAction<Letter | null>>>(
    (nextAction) => {
      if (!visit.isActive()) return;
      const currentLetter = currentLetterRef.current?.id === visit.letterId
        ? currentLetterRef.current
        : null;
      const nextLetter = typeof nextAction === 'function'
        ? nextAction(currentLetter)
        : nextAction;
      adoptIncrementalLetter(nextLetter);
    },
    [adoptIncrementalLetter, visit],
  );

  return {
    letter,
    setAuthoritativeLetter,
    setLetter,
    tryAdoptLetter,
  };
}
