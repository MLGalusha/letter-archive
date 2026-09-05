import { useEffect, useLayoutEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

/** Keep the owning review mounted until its queued edits have settled. */
export function useReviewNavigationGuard(
  pending: boolean,
  flush: () => Promise<boolean>,
) {
  const current = useRef({ pending, flush });
  useLayoutEffect(() => { current.current = { pending, flush }; }, [pending, flush]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    current.current.pending && currentLocation.pathname !== nextLocation.pathname
  ));
  const saving = useRef(false);
  const blockerRef = useRef(blocker);
  useLayoutEffect(() => { blockerRef.current = blocker; }, [blocker]);

  useEffect(() => {
    const warnOnExit = (event: BeforeUnloadEvent) => {
      if (!current.current.pending) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnOnExit);
    return () => window.removeEventListener('beforeunload', warnOnExit);
  }, []);

  useEffect(() => {
    if (blocker.state !== 'blocked' || saving.current) return;
    saving.current = true;
    void (async () => {
      let saved = false;
      try { saved = await current.current.flush(); } catch { /* Stay on the editor. */ }
      const latest = blockerRef.current;
      if (latest.state === 'blocked') {
        const discard = !saved && window.confirm(
          'Changes could not be saved. Leave this review and discard unsaved changes?',
        );
        if (saved || discard) latest.proceed();
        else latest.reset();
      }
      saving.current = false;
    })();
  }, [blocker]);
}
