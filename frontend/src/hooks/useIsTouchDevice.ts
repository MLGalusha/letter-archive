import { useSyncExternalStore } from 'react';

const TOUCH_QUERY = '(pointer: coarse)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mediaQuery = window.matchMedia(TOUCH_QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(TOUCH_QUERY).matches
    : false;
}

/**
 * Detects touch-primary devices using the `(pointer: coarse)` media query.
 * Returns true for phones/tablets where the primary input is a finger.
 * Listens for changes (e.g. iPad connecting/disconnecting a mouse).
 */
export default function useIsTouchDevice(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
