import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import {
  useBlocker,
  type BlockerFunction,
} from 'react-router-dom';

interface UseLineReviewNavigationGuardOptions {
  active: boolean;
  hasPendingChanges: () => boolean;
  flushPendingChanges: () => Promise<boolean>;
}

/**
 * Keeps the Letter Review route mounted while pending geometry is flushed.
 *
 * React Router owns the attempted transition. We only allow it to proceed
 * after the child geometry lane and the parent autosave lane both succeed.
 */
export function useLineReviewNavigationGuard({
  active,
  hasPendingChanges,
  flushPendingChanges,
}: UseLineReviewNavigationGuardOptions) {
  const activeRef = useRef(active);
  const hasPendingChangesRef = useRef(hasPendingChanges);
  const flushPendingChangesRef = useRef(flushPendingChanges);
  const activeTransitionRef = useRef<Promise<void> | null>(null);
  useLayoutEffect(() => {
    activeRef.current = active;
    hasPendingChangesRef.current = hasPendingChanges;
    flushPendingChangesRef.current = flushPendingChanges;
  }, [
    active,
    flushPendingChanges,
    hasPendingChanges,
  ]);

  const shouldBlock = useCallback<BlockerFunction>(({
    currentLocation,
    nextLocation,
  }) => (
    activeRef.current
    && currentLocation.pathname !== nextLocation.pathname
    && hasPendingChangesRef.current()
  ), []);
  const blocker = useBlocker(shouldBlock);
  const blockerRef = useRef(blocker);
  useLayoutEffect(() => {
    blockerRef.current = blocker;
  }, [blocker]);

  useEffect(() => {
    if (
      blocker.state !== 'blocked'
      || activeTransitionRef.current
    ) {
      return;
    }

    const transition = (async () => {
      try {
        const saved = await flushPendingChangesRef.current();
        const latestBlocker = blockerRef.current;
        if (latestBlocker.state !== 'blocked') return;
        if (saved) {
          latestBlocker.proceed();
        } else {
          latestBlocker.reset();
        }
      } catch {
        const latestBlocker = blockerRef.current;
        if (latestBlocker.state === 'blocked') {
          latestBlocker.reset();
        }
      }
    })();

    activeTransitionRef.current = transition;
    void transition.finally(() => {
      if (activeTransitionRef.current === transition) {
        activeTransitionRef.current = null;
      }
    });
  }, [blocker]);

  return {
    navigationPending: blocker.state !== 'unblocked',
  } as const;
}
