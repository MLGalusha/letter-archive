import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Header dock state — the flags the header needs to know about, *not* the
 * content itself. Dock content is portaled into a slot the header renders
 * (see HeaderDock.tsx + Header.tsx), so it lives in the owning page's React
 * tree and is unaffected by header re-renders.
 */
export interface HeaderDockState {
  /** true when a page has declared a <HeaderDock> with children */
  hasContent: boolean;
  /** letter-detail mode: transparent header background so content scrolls under */
  transparent: boolean;
  /** override "Collections" nav link label + target */
  collectionsLink?: { label: string; to: string };
}

export const EMPTY_DOCK_STATE: HeaderDockState = {
  hasContent: false,
  transparent: false,
};

interface HeaderDockContextValue {
  state: HeaderDockState;
  setState: (next: HeaderDockState) => void;
  slotEl: HTMLDivElement | null;
  registerSlot: (el: HTMLDivElement | null) => void;
}

const HeaderDockContext = createContext<HeaderDockContextValue | null>(null);

/**
 * Debounce transitions that *empty* the dock so navigating between two
 * pages that both declare a dock doesn't flash the empty state.
 */
const EMPTY_DEBOUNCE_MS = 80;

export function HeaderDockProvider({ children }: { children: ReactNode }) {
  const [state, setStateRaw] = useState<HeaderDockState>(EMPTY_DOCK_STATE);
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const emptyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setState = useCallback((next: HeaderDockState) => {
    if (emptyTimerRef.current) {
      clearTimeout(emptyTimerRef.current);
      emptyTimerRef.current = null;
    }
    if (!next.hasContent) {
      emptyTimerRef.current = setTimeout(() => {
        emptyTimerRef.current = null;
        setStateRaw(next);
      }, EMPTY_DEBOUNCE_MS);
    } else {
      setStateRaw(next);
    }
  }, []);

  const registerSlot = useCallback((el: HTMLDivElement | null) => {
    setSlotEl(el);
  }, []);

  const value = useMemo<HeaderDockContextValue>(
    () => ({ state, setState, slotEl, registerSlot }),
    [state, setState, slotEl, registerSlot],
  );

  return <HeaderDockContext.Provider value={value}>{children}</HeaderDockContext.Provider>;
}

export function useHeaderDock() {
  const context = useContext(HeaderDockContext);
  if (!context) {
    throw new Error("useHeaderDock must be used within a HeaderDockProvider");
  }
  return context;
}
