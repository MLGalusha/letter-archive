import { useCallback, useState } from "react";
import type { DashboardViewState, SavedDashboardView } from "./types";
import { loadSavedDashboardViews, saveSavedDashboardViews } from "./utils";

interface UseSavedDashboardViewsOptions {
  getCurrentState: () => DashboardViewState;
  applyState: (state: DashboardViewState) => void;
  onSaved: (name: string) => void;
  onApplied: (name: string) => void;
}

export function useSavedDashboardViews({
  getCurrentState,
  applyState,
  onSaved,
  onApplied,
}: UseSavedDashboardViewsOptions) {
  const [savedViews, setSavedViews] = useState<SavedDashboardView[]>(() =>
    loadSavedDashboardViews(),
  );

  const saveView = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setSavedViews((previous) => {
      const nextViews: SavedDashboardView[] = [
        {
          id: crypto.randomUUID(),
          name: trimmedName,
          createdAt: new Date().toISOString(),
          state: getCurrentState(),
        },
        ...previous,
      ].slice(0, 12);

      saveSavedDashboardViews(nextViews);
      return nextViews;
    });

    onSaved(trimmedName);
  }, [getCurrentState, onSaved]);

  const applyView = useCallback((view: SavedDashboardView) => {
    applyState(view.state);
    onApplied(view.name);
  }, [applyState, onApplied]);

  const deleteView = useCallback((viewId: string) => {
    setSavedViews((previous) => {
      const nextViews = previous.filter((view) => view.id !== viewId);
      saveSavedDashboardViews(nextViews);
      return nextViews;
    });
  }, []);

  return {
    savedViews,
    saveView,
    applyView,
    deleteView,
  };
}
