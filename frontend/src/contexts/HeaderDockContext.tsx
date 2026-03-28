import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface HeaderDockState {
  content: ReactNode | null;
  active: boolean;
  visible: boolean;
  scrollReveal?: boolean;
  /** When true, the site title stays visible alongside the dock content */
  showTitle?: boolean;
  /** Override the "Collections" nav link text and destination */
  collectionsLink?: { label: string; to: string };
}

interface HeaderDockContextValue {
  dock: HeaderDockState;
  setDock: (dock: HeaderDockState) => void;
}

const EMPTY_DOCK: HeaderDockState = {
  content: null,
  active: false,
  visible: false,
};

const HeaderDockContext = createContext<HeaderDockContextValue | null>(null);

const EMPTY_DEBOUNCE_MS = 80;

export function HeaderDockProvider({ children }: { children: ReactNode }) {
  const [dock, setDockRaw] = useState<HeaderDockState>(EMPTY_DOCK);
  const emptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDock = useCallback((next: HeaderDockState) => {
    // Clear any pending empty-dock transition
    if (emptyTimerRef.current) {
      clearTimeout(emptyTimerRef.current);
      emptyTimerRef.current = null;
    }

    // Debounce transitions to EMPTY_DOCK so page swaps don't flash
    if (!next.content && !next.active) {
      emptyTimerRef.current = setTimeout(() => {
        emptyTimerRef.current = null;
        setDockRaw(next);
      }, EMPTY_DEBOUNCE_MS);
    } else {
      setDockRaw(next);
    }
  }, []);

  const value = useMemo(() => ({ dock, setDock }), [dock, setDock]);

  return <HeaderDockContext.Provider value={value}>{children}</HeaderDockContext.Provider>;
}

export function useHeaderDock() {
  const context = useContext(HeaderDockContext);

  if (!context) {
    throw new Error("useHeaderDock must be used within a HeaderDockProvider");
  }

  return context;
}

export { EMPTY_DOCK };
