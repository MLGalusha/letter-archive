import { useCallback } from "react";
import { useToast } from "../../../contexts/ToastContext";
import { createDashboardViewState } from "./dashboardStoredStateModel";
import type {
  ColumnId,
  DashboardViewState,
  PersistedState,
  SortColumn,
} from "./types";
import { useSavedDashboardViews } from "./useSavedDashboardViews";

interface UseDashboardSavedViewStateOptions {
  storedState: PersistedState;
  visibleColumns: ReadonlySet<ColumnId>;
  columnOrder: readonly ColumnId[];
  replaceStoredFilters: (state: PersistedState) => void;
  replaceSortColumns: (columns: readonly SortColumn[]) => void;
  replaceStoredColumns: (
    state: Pick<DashboardViewState, "visibleColumns" | "columnOrder">,
  ) => void;
}

export function useDashboardSavedViewState({
  storedState,
  visibleColumns,
  columnOrder,
  replaceStoredFilters,
  replaceSortColumns,
  replaceStoredColumns,
}: UseDashboardSavedViewStateOptions) {
  const { showToast } = useToast();

  const getCurrentDashboardViewState = useCallback(
    (): DashboardViewState => createDashboardViewState({
      storedState,
      visibleColumns,
      columnOrder,
    }),
    [
      storedState,
      visibleColumns,
      columnOrder,
    ],
  );

  const applyDashboardViewState = useCallback((state: DashboardViewState) => {
    replaceStoredFilters(state);
    replaceSortColumns(state.sortColumns);
    replaceStoredColumns(state);
  }, [
    replaceStoredFilters,
    replaceSortColumns,
    replaceStoredColumns,
  ]);

  return useSavedDashboardViews({
    getCurrentState: getCurrentDashboardViewState,
    applyState: applyDashboardViewState,
    onSaved: (name) => showToast(`Saved view "${name}"`, "success"),
    onApplied: (name) => showToast(`Loaded view "${name}"`, "info"),
  });
}
