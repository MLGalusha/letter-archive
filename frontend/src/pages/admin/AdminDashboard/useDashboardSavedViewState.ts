import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useToast } from "../../../contexts/ToastContext";
import type { ContentStatus } from "../../../types/Letter";
import type {
  ColumnId,
  DashboardViewState,
  DateMode,
  SortColumn,
  VisibilityFilter,
} from "./types";
import { useSavedDashboardViews } from "./useSavedDashboardViews";

interface UseDashboardSavedViewStateOptions {
  visibilityFilter: VisibilityFilter;
  setVisibilityFilter: (value: VisibilityFilter) => void;
  collectionFilter: string;
  setCollectionFilter: (value: string) => void;
  setCollectionInput: (value: string) => void;
  searchQuery: string;
  setSearchInput: (value: string) => void;
  setSearchQuery: (value: string) => void;
  sortColumns: SortColumn[];
  setSortColumns: Dispatch<SetStateAction<SortColumn[]>>;
  dateMode: DateMode;
  setDateMode: (value: DateMode) => void;
  yearFilter: number | null;
  setYearFilter: (value: number | null) => void;
  monthFilter: number | null;
  setMonthFilter: (value: number | null) => void;
  dayFilter: number | null;
  setDayFilter: (value: number | null) => void;
  dateFromFilter: string | null;
  setDateFromFilter: (value: string | null) => void;
  dateToFilter: string | null;
  setDateToFilter: (value: string | null) => void;
  transcriptStatusFilters: ContentStatus[];
  setTranscriptStatusFilters: Dispatch<SetStateAction<ContentStatus[]>>;
  metadataStatusFilters: ContentStatus[];
  setMetadataStatusFilters: Dispatch<SetStateAction<ContentStatus[]>>;
  visibleColumns: Set<ColumnId>;
  setVisibleColumns: Dispatch<SetStateAction<Set<ColumnId>>>;
}

export function useDashboardSavedViewState({
  visibilityFilter,
  setVisibilityFilter,
  collectionFilter,
  setCollectionFilter,
  setCollectionInput,
  searchQuery,
  setSearchInput,
  setSearchQuery,
  sortColumns,
  setSortColumns,
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
  visibleColumns,
  setVisibleColumns,
}: UseDashboardSavedViewStateOptions) {
  const { showToast } = useToast();

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
    visibleColumns: Array.from(visibleColumns),
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
    visibleColumns,
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
    setVisibleColumns(new Set(state.visibleColumns));
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
    setVisibleColumns,
  ]);

  return useSavedDashboardViews({
    getCurrentState: getCurrentDashboardViewState,
    applyState: applyDashboardViewState,
    onSaved: (name) => showToast(`Saved view "${name}"`, "success"),
    onApplied: (name) => showToast(`Loaded view "${name}"`, "info"),
  });
}
