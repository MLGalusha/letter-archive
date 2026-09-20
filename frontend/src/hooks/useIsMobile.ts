import { useCallback, useSyncExternalStore } from 'react';

const DEFAULT_BREAKPOINT = 640;

export default function useIsMobile(breakpoint = DEFAULT_BREAKPOINT) {
  const query = `(max-width: ${breakpoint}px)`;

  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const mediaQuery = window.matchMedia(query);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [query]);

  const getSnapshot = useCallback(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
    [query],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
