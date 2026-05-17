import { useMemo } from "react";
import type { ContentStatus } from "../../../types/Letter";
import type { VisibilityFilter } from "./types";

export interface DashboardFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface UseDashboardActiveFiltersOptions {
  collectionFilter: string;
  visibilityFilter: VisibilityFilter;
  searchQuery: string;
  transcriptStatusFilters: ContentStatus[];
  metadataStatusFilters: ContentStatus[];
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  dateFromFilter: string | null;
  dateToFilter: string | null;
  hasDateFilter: boolean;
  toggleVisibilityFilter: (value: "PUBLISHED" | "HIDDEN") => void;
  handleCollectionInputChange: (value: string) => void;
  setSearchInput: (value: string) => void;
  setSearchQuery: (value: string) => void;
  getDateButtonText: () => string;
  clearDateFilters: () => void;
  toggleTranscriptFilter: (value: ContentStatus) => void;
  toggleMetadataFilter: (value: ContentStatus) => void;
}

export function useDashboardActiveFilters({
  collectionFilter,
  visibilityFilter,
  searchQuery,
  transcriptStatusFilters,
  metadataStatusFilters,
  yearFilter,
  monthFilter,
  dayFilter,
  dateFromFilter,
  dateToFilter,
  hasDateFilter,
  toggleVisibilityFilter,
  handleCollectionInputChange,
  setSearchInput,
  setSearchQuery,
  getDateButtonText,
  clearDateFilters,
  toggleTranscriptFilter,
  toggleMetadataFilter,
}: UseDashboardActiveFiltersOptions) {
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (collectionFilter !== "all") count++;
    if (visibilityFilter !== "ALL") count++;
    if (searchQuery) count++;
    if (transcriptStatusFilters.length > 0) count += transcriptStatusFilters.length;
    if (metadataStatusFilters.length > 0) count += metadataStatusFilters.length;
    if (yearFilter !== null) count++;
    if (monthFilter !== null) count++;
    if (dayFilter !== null) count++;
    if (dateFromFilter !== null) count++;
    if (dateToFilter !== null) count++;
    return count;
  }, [
    collectionFilter,
    visibilityFilter,
    searchQuery,
    transcriptStatusFilters,
    metadataStatusFilters,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
  ]);

  const activeFilterChips = useMemo<DashboardFilterChip[]>(() => {
    const chips: DashboardFilterChip[] = [];

    if (visibilityFilter !== "ALL") {
      chips.push({
        key: "visibility",
        label: visibilityFilter === "PUBLISHED" ? "Published" : "Hidden",
        onRemove: () => toggleVisibilityFilter(visibilityFilter),
      });
    }

    if (collectionFilter !== "all") {
      chips.push({
        key: "collection",
        label: `Collection ${collectionFilter}`,
        onRemove: () => handleCollectionInputChange(""),
      });
    }

    if (searchQuery) {
      chips.push({
        key: "search",
        label: `Search: ${searchQuery}`,
        onRemove: () => {
          setSearchInput("");
          setSearchQuery("");
        },
      });
    }

    if (hasDateFilter) {
      chips.push({
        key: "date",
        label: getDateButtonText(),
        onRemove: clearDateFilters,
      });
    }

    transcriptStatusFilters.forEach((status) => {
      chips.push({
        key: `transcript-${status}`,
        label: `Transcript ${status.toLowerCase().replace("_", " ")}`,
        onRemove: () => toggleTranscriptFilter(status),
      });
    });

    metadataStatusFilters.forEach((status) => {
      chips.push({
        key: `metadata-${status}`,
        label: `Metadata ${status.toLowerCase().replace("_", " ")}`,
        onRemove: () => toggleMetadataFilter(status),
      });
    });

    return chips;
  }, [
    visibilityFilter,
    collectionFilter,
    searchQuery,
    hasDateFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    toggleVisibilityFilter,
    handleCollectionInputChange,
    setSearchInput,
    setSearchQuery,
    getDateButtonText,
    clearDateFilters,
    toggleTranscriptFilter,
    toggleMetadataFilter,
  ]);

  return { activeFilterCount, activeFilterChips };
}
