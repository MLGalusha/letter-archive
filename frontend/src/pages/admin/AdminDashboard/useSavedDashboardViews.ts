import { useCallback, useEffect, useState } from "react";
import { SAVED_VIEWS_STORAGE_KEY } from "./constants";
import { decodeDashboardViewState } from "./dashboardStoredStateModel";
import type { DashboardViewState, SavedDashboardView } from "./types";
import {
  loadSavedDashboardViews,
  saveSavedDashboardViews,
} from "./utils";

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

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SAVED_VIEWS_STORAGE_KEY) {
        setSavedViews(loadSavedDashboardViews());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const saveView = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const savedView: SavedDashboardView = {
      id: crypto.randomUUID(),
      name: trimmedName,
      createdAt: new Date().toISOString(),
      state: decodeDashboardViewState(getCurrentState()),
    };
    const nextViews = [
      savedView,
      ...loadSavedDashboardViews(),
    ].slice(0, 12);

    if (!saveSavedDashboardViews(nextViews)) return;
    setSavedViews(nextViews);
    onSaved(trimmedName);
  }, [getCurrentState, onSaved]);

  const applyView = useCallback((view: SavedDashboardView) => {
    applyState(decodeDashboardViewState(view.state));
    onApplied(view.name);
  }, [applyState, onApplied]);

  const deleteView = useCallback((viewId: string) => {
    const nextViews = loadSavedDashboardViews()
      .filter((view) => view.id !== viewId);
    if (!saveSavedDashboardViews(nextViews)) return;
    setSavedViews(nextViews);
  }, []);

  return {
    savedViews,
    saveView,
    applyView,
    deleteView,
  };
}
