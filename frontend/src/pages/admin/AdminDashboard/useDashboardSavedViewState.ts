import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useToast } from "../../../contexts/ToastContext";
import type { ContentStatus, WorkflowState } from "../../../types/Letter";
import { DEFAULT_COLUMN_ORDER } from "./constants";
import type {
  ColumnId,
  DashboardViewState,
  SortColumn,
} from "./types";
import type { DashboardFilterControls } from "./useDashboardFilters";
import { useSavedDashboardViews } from "./useSavedDashboardViews";

interface UseDashboardSavedViewStateOptions {
  filters: DashboardFilterControls;
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
  visibleColumns: Set<ColumnId>;
  setVisibleColumns: Dispatch<SetStateAction<Set<ColumnId>>>;
  columnOrder: ColumnId[];
  setColumnOrder: Dispatch<SetStateAction<ColumnId[]>>;
}

export function useDashboardSavedViewState({
  filters,
  sortColumns,
  setSortColumns,
  visibleColumns,
  setVisibleColumns,
  columnOrder,
  setColumnOrder,
}: UseDashboardSavedViewStateOptions) {
  const { showToast } = useToast();
  const {
    visibilityFilter,
    setVisibilityFilter,
    collectionFilter,
    setCollectionFilter,
    setCollectionInput,
    searchQuery,
    setSearchInput,
    setSearchQuery,
    dateMode,
    setDateMode,
    yearFilter,
    setYearFilter,
    monthFilter,
    setMonthFilter,
    dayFilter,
    setDayFilter,
    dateFromFilter,
    setDateFromFilter,
    dateToFilter,
    setDateToFilter,
    transcriptStatusFilters,
    setTranscriptStatusFilters,
    metadataStatusFilters,
    setMetadataStatusFilters,
    extraContentStatusFilters,
    setExtraContentStatusFilters,
    workflowFilters,
    setWorkflowFilters,
    flaggedFilter,
    setFlaggedFilter,
  } = filters;

  const getCurrentDashboardViewState = useCallback((): DashboardViewState => ({
    visibilityFilter,
    collectionFilter,
    searchQuery,
    sortColumns,
    dateMode,
    year: yearFilter,
    month: monthFilter,
    day: dayFilter,
    dateFrom: dateFromFilter,
    dateTo: dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    extraContentStatusFilters,
    workflowFilters,
    flaggedFilter,
    visibleColumns: Array.from(visibleColumns),
    columnOrder,
  }), [
    visibilityFilter,
    collectionFilter,
    searchQuery,
    sortColumns,
    dateMode,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    extraContentStatusFilters,
    workflowFilters,
    flaggedFilter,
    visibleColumns,
    columnOrder,
  ]);

  const applyDashboardViewState = useCallback((state: DashboardViewState) => {
    setVisibilityFilter(state.visibilityFilter);
    setCollectionFilter(state.collectionFilter);
    setCollectionInput(state.collectionFilter === "all" ? "" : state.collectionFilter);
    setSearchInput(state.searchQuery);
    setSearchQuery(state.searchQuery);
    setSortColumns(state.sortColumns);
    setDateMode(state.dateMode);
    setYearFilter(state.year);
    setMonthFilter(state.month);
    setDayFilter(state.day);
    setDateFromFilter(state.dateFrom);
    setDateToFilter(state.dateTo);
    setTranscriptStatusFilters(state.transcriptStatusFilters as ContentStatus[]);
    setMetadataStatusFilters(state.metadataStatusFilters as ContentStatus[]);
    setExtraContentStatusFilters((state.extraContentStatusFilters ?? []) as ContentStatus[]);
    setWorkflowFilters((state.workflowFilters ?? []) as WorkflowState[]);
    setFlaggedFilter(state.flaggedFilter ?? "ALL");
    setVisibleColumns(new Set(state.visibleColumns));
    setColumnOrder(state.columnOrder ?? DEFAULT_COLUMN_ORDER);
  }, [
    setVisibilityFilter,
    setCollectionFilter,
    setCollectionInput,
    setSearchInput,
    setSearchQuery,
    setSortColumns,
    setDateMode,
    setYearFilter,
    setMonthFilter,
    setDayFilter,
    setDateFromFilter,
    setDateToFilter,
    setTranscriptStatusFilters,
    setMetadataStatusFilters,
    setExtraContentStatusFilters,
    setWorkflowFilters,
    setFlaggedFilter,
    setVisibleColumns,
    setColumnOrder,
  ]);

  return useSavedDashboardViews({
    getCurrentState: getCurrentDashboardViewState,
    applyState: applyDashboardViewState,
    onSaved: (name) => showToast(`Saved view "${name}"`, "success"),
    onApplied: (name) => showToast(`Loaded view "${name}"`, "info"),
  });
}
