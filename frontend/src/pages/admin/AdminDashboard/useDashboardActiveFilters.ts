import { useMemo } from "react";
import type { ContentStatus, WorkflowState } from "../../../types/Letter";
import { WORKFLOW_FILTERS } from "./constants";
import type { FlaggedFilter, VisibilityFilter } from "./types";

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
  extraContentStatusFilters: ContentStatus[];
  workflowFilters: WorkflowState[];
  flaggedFilter: FlaggedFilter;
  hasDateFilter: boolean;
  toggleVisibilityFilter: (value: "PUBLISHED" | "HIDDEN") => void;
  handleCollectionInputChange: (value: string) => void;
  setSearchInput: (value: string) => void;
  setSearchQuery: (value: string) => void;
  getDateButtonText: () => string;
  clearDateFilters: () => void;
  toggleTranscriptFilter: (value: ContentStatus) => void;
  toggleMetadataFilter: (value: ContentStatus) => void;
  toggleExtraContentFilter: (value: ContentStatus) => void;
  toggleWorkflowFilter: (value: WorkflowState) => void;
  toggleFlaggedFilter: (value: Exclude<FlaggedFilter, "ALL">) => void;
}

function formatContentStatusLabel(status: ContentStatus) {
  return status.toLowerCase().replace("_", " ");
}

function formatWorkflowLabel(workflow: WorkflowState) {
  const option = WORKFLOW_FILTERS.find((filter) => filter.value === workflow);
  return option?.label ?? workflow.toLowerCase().replace(/_/g, " ");
}

export function useDashboardActiveFilters({
  collectionFilter,
  visibilityFilter,
  searchQuery,
  transcriptStatusFilters,
  metadataStatusFilters,
  extraContentStatusFilters,
  workflowFilters,
  flaggedFilter,
  hasDateFilter,
  toggleVisibilityFilter,
  handleCollectionInputChange,
  setSearchInput,
  setSearchQuery,
  getDateButtonText,
  clearDateFilters,
  toggleTranscriptFilter,
  toggleMetadataFilter,
  toggleExtraContentFilter,
  toggleWorkflowFilter,
  toggleFlaggedFilter,
}: UseDashboardActiveFiltersOptions) {
  const activeFilterChips = useMemo<DashboardFilterChip[]>(() => {
    const chips: DashboardFilterChip[] = [];

    if (visibilityFilter !== "ALL") {
      chips.push({
        key: "visibility",
        label: visibilityFilter === "PUBLISHED" ? "Published" : "Hidden",
        onRemove: () => toggleVisibilityFilter(visibilityFilter),
      });
    }

    if (flaggedFilter !== "ALL") {
      chips.push({
        key: "flagged",
        label: flaggedFilter === "FLAGGED" ? "Flagged" : "Unflagged",
        onRemove: () => toggleFlaggedFilter(flaggedFilter),
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
        label: `Transcript ${formatContentStatusLabel(status)}`,
        onRemove: () => toggleTranscriptFilter(status),
      });
    });

    metadataStatusFilters.forEach((status) => {
      chips.push({
        key: `metadata-${status}`,
        label: `Metadata ${formatContentStatusLabel(status)}`,
        onRemove: () => toggleMetadataFilter(status),
      });
    });

    extraContentStatusFilters.forEach((status) => {
      chips.push({
        key: `extras-${status}`,
        label: `Extras ${formatContentStatusLabel(status)}`,
        onRemove: () => toggleExtraContentFilter(status),
      });
    });

    workflowFilters.forEach((workflow) => {
      chips.push({
        key: `workflow-${workflow}`,
        label: `Pipeline: ${formatWorkflowLabel(workflow)}`,
        onRemove: () => toggleWorkflowFilter(workflow),
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
    extraContentStatusFilters,
    workflowFilters,
    flaggedFilter,
    toggleVisibilityFilter,
    handleCollectionInputChange,
    setSearchInput,
    setSearchQuery,
    getDateButtonText,
    clearDateFilters,
    toggleTranscriptFilter,
    toggleMetadataFilter,
    toggleExtraContentFilter,
    toggleWorkflowFilter,
    toggleFlaggedFilter,
  ]);

  const activeFilterCount = activeFilterChips.length;

  return { activeFilterCount, activeFilterChips };
}
