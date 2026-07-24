import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

/**
 * Keeps the shared busy flag owned by the route that started the mutation.
 *
 * Letter Review stays mounted during A -> B navigation. A late `finally`
 * must therefore clear only A's flag, never a newer mutation started by B.
 */
export function useLetterSavingState(
  activeLetterId: string | undefined,
): readonly [boolean, Dispatch<SetStateAction<boolean>>] {
  const [savingBySession, setSavingBySession] = useState(
    () => new Map<symbol, boolean>(),
  );
  const ownerKey = useMemo(
    () => Symbol(activeLetterId ?? 'no-letter'),
    [activeLetterId],
  );

  const setSaving = useCallback<Dispatch<SetStateAction<boolean>>>(
    (nextAction) => {
      setSavingBySession((currentBySession) => {
        const current = currentBySession.get(ownerKey) ?? false;
        const next = typeof nextAction === 'function'
          ? nextAction(current)
          : nextAction;

        if (next === current) return currentBySession;
        const updated = new Map(currentBySession);
        if (next) updated.set(ownerKey, true);
        else updated.delete(ownerKey);
        return updated;
      });
    },
    [ownerKey],
  );

  return [savingBySession.get(ownerKey) ?? false, setSaving] as const;
}
