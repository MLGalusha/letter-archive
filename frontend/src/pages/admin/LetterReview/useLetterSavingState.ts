import { useCallback, useState } from 'react';
import type { LetterReviewVisit } from './useLetterReviewVisit';

export type ReleaseLetterSaving = () => void;
export type BeginLetterSaving = () => ReleaseLetterSaving;

interface SavingOwner {
  visit: LetterReviewVisit;
  leases: ReadonlySet<symbol>;
}

/**
 * Owns explicit-mutation busy leases for the active route visit.
 *
 * Each operation releases only its own idempotent lease. Route changes expose
 * a fresh unlocked owner immediately, while late releases from an earlier A
 * visit cannot unlock B or a later A visit.
 */
export function useLetterSavingState(visit: LetterReviewVisit) {
  const [stored, setStored] = useState<SavingOwner>(() => ({
    visit,
    leases: new Set(),
  }));
  const saving = stored.visit === visit && stored.leases.size > 0;

  const beginSaving = useCallback<BeginLetterSaving>(() => {
    if (!visit.isActive()) {
      return () => {};
    }

    const lease = Symbol('letter-saving');
    let released = false;
    setStored((current) => {
      const leases = current.visit === visit
        ? new Set(current.leases)
        : new Set<symbol>();
      leases.add(lease);
      return { visit, leases };
    });

    return () => {
      if (released) return;
      released = true;
      if (!visit.isActive()) return;

      setStored((current) => {
        if (current.visit !== visit || !current.leases.has(lease)) {
          return current;
        }

        const leases = new Set(current.leases);
        leases.delete(lease);
        return { visit, leases };
      });
    };
  }, [visit]);

  return { saving, beginSaving } as const;
}
