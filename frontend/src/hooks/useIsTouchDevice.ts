import { useEffect, useState } from 'react';

/**
 * Detects touch-primary devices using the `(pointer: coarse)` media query.
 * Returns true for phones/tablets where the primary input is a finger.
 * Listens for changes (e.g. iPad connecting/disconnecting a mouse).
 */
export default function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(pointer: coarse)');
    const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    setIsTouch(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isTouch;
}
