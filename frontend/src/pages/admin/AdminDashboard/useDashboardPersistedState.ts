import { useEffect } from "react";
import type { SortColumn } from "./types";
import type { DashboardFilterControls } from "./useDashboardFilters";
import { savePersistedState } from "./utils";

export function useDashboardPersistedState({
  filters,
  sortColumns,
}: {
  filters: DashboardFilterControls;
  sortColumns: SortColumn[];
}) {
  const {
    visibilityFilter,
    collectionFilter,
    searchQuery,
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
  } = filters;

  useEffect(() => {
    savePersistedState({
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
    });
  }, [
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
  ]);
}
