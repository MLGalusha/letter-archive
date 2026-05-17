import { useEffect } from "react";
import type { ContentStatus } from "../../../types/Letter";
import type { DateMode, SortColumn, VisibilityFilter } from "./types";
import { savePersistedState } from "./utils";

export function useDashboardPersistedState({
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
}: {
  visibilityFilter: VisibilityFilter;
  collectionFilter: string;
  searchQuery: string;
  sortColumns: SortColumn[];
  dateMode: DateMode;
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  dateFromFilter: string | null;
  dateToFilter: string | null;
  transcriptStatusFilters: ContentStatus[];
  metadataStatusFilters: ContentStatus[];
}) {
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
  ]);
}
