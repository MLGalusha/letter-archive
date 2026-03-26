import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface HeaderDockState {
  content: ReactNode | null;
  active: boolean;
  visible: boolean;
  scrollReveal?: boolean;
  /** When true, the site title stays visible alongside the dock content */
  showTitle?: boolean;
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

export function HeaderDockProvider({ children }: { children: ReactNode }) {
  const [dock, setDock] = useState<HeaderDockState>(EMPTY_DOCK);

  const value = useMemo(() => ({ dock, setDock }), [dock]);

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
