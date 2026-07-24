import { useCallback, useState } from "react";

export type DashboardManager =
  | "filters"
  | "savedViews"
  | "sort"
  | "columns";

export function useDashboardManagerState() {
  const [activeManager, setActiveManager] =
    useState<DashboardManager | null>(null);

  const setManagerOpen = useCallback((
    manager: DashboardManager,
    open: boolean,
  ) => {
    setActiveManager((current) => {
      if (open) {
        return current === manager ? current : manager;
      }

      return current === manager ? null : current;
    });
  }, []);

  const toggleManager = useCallback((manager: DashboardManager) => {
    setActiveManager((current) => (
      current === manager ? null : manager
    ));
  }, []);

  const closeManager = useCallback((manager: DashboardManager) => {
    setActiveManager((current) => (
      current === manager ? null : current
    ));
  }, []);

  const closeAllManagers = useCallback(() => {
    setActiveManager(null);
  }, []);

  return {
    activeManager,
    setManagerOpen,
    toggleManager,
    closeManager,
    closeAllManagers,
  };
}
