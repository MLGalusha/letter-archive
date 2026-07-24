import { useLayoutEffect, useMemo, useRef } from 'react';

/**
 * Identifies one committed visit to a Letter Review route.
 *
 * The object itself is the opaque identity. Returning to the same letter after
 * visiting another route creates a new object, so callbacks captured by the
 * earlier visit can fail closed even when the letter ID and source revision
 * happen to match.
 */
export interface LetterReviewVisit {
  readonly letterId: string | undefined;
  isActive: () => boolean;
}

export function useLetterReviewVisit(
  letterId: string | undefined,
): LetterReviewVisit {
  const activeVisitRef = useRef<LetterReviewVisit | null>(null);
  const visit = useMemo<LetterReviewVisit>(() => {
    const nextVisit: LetterReviewVisit = {
      letterId,
      isActive: () => activeVisitRef.current === nextVisit,
    };
    return nextVisit;
  }, [letterId]);

  useLayoutEffect(() => {
    activeVisitRef.current = visit;

    return () => {
      if (activeVisitRef.current === visit) {
        activeVisitRef.current = null;
      }
    };
  }, [visit]);

  return visit;
}
