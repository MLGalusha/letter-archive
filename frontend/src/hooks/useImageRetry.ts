import { useEffect, useRef, useState } from 'react';
import { IMAGE_RETRY_DELAYS_MS } from '../utils/imageRetry';

/** Remount a failed image at most twice; source changes/unmount cancel pending retries. */
export function useImageRetry(src: string) {
  const [state, setState] = useState({ src, attempt: 0, failed: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = state.src === src ? state : { src, attempt: 0, failed: false };
  // Remember every source transition, even a successful source with no retry.
  // Otherwise A(failed) → B(success) → A would restore A's exhausted budget.
  if (state.src !== src) setState(current);
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [src]);
  const onError = () => {
    if (timer.current !== null || current.failed) return;
    // Cover the current broken request immediately, including during backoff.
    // The attempt count, rather than visibility, bounds subsequent retries.
    setState({ ...current, failed: true });
    const delay = IMAGE_RETRY_DELAYS_MS[current.attempt];
    if (delay === undefined) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      setState({ src, attempt: current.attempt + 1, failed: false });
    }, delay);
  };
  const onLoad = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (current.failed) setState({ ...current, failed: false });
  };
  return { attempt: current.attempt, failed: current.failed, onError, onLoad };
}
