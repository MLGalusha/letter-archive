import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Letter } from '../../../types/Letter';

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
  activeLetterId: string | undefined,
) {
  const [storedLetter, setLetterState] = useState<Letter | null>(null);
  const currentLetterRef = useRef<Letter | null>(null);
  const activeLetterIdRef = useRef(activeLetterId);
  useLayoutEffect(() => {
    activeLetterIdRef.current = activeLetterId;
  }, [activeLetterId]);
  // Route ownership is synchronous: during A -> B navigation no hook may see
  // A's DTO paired with B's URL while the B request is still loading.
  const letter = storedLetter?.id === activeLetterId ? storedLetter : null;

  const setAuthoritativeLetter = useCallback((nextLetter: Letter) => {
    if (nextLetter.id !== activeLetterIdRef.current) return;
    currentLetterRef.current = nextLetter;
    setLetterState(nextLetter);
  }, []);

  const setLetter = useCallback<Dispatch<SetStateAction<Letter | null>>>(
    (nextAction) => {
      const currentLetter = currentLetterRef.current;
      const nextLetter = typeof nextAction === 'function'
        ? nextAction(currentLetter)
        : nextAction;

      if (
        nextLetter
        && nextLetter.id !== activeLetterIdRef.current
      ) {
        return;
      }

      if (
        currentLetter
        && nextLetter
        && currentLetter.id === nextLetter.id
        && currentLetter.primarySourceRevision
          !== nextLetter.primarySourceRevision
      ) {
        markSourceConflict(SOURCE_REFRESH_CONFLICT);
        return;
      }

      // Incremental responses from a route that has already been left are
      // stale by ownership, even when their source revision happens to match.
      if (
        currentLetter
        && nextLetter
        && currentLetter.id !== nextLetter.id
      ) {
        return;
      }

      currentLetterRef.current = nextLetter;
      setLetterState(nextLetter);
    },
    [markSourceConflict],
  );

  return {
    letter,
    setAuthoritativeLetter,
    setLetter,
  };
}
