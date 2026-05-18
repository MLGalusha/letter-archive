import { useMemo } from "react";
import type { ContentStatus, WorkflowState } from "../../../types/Letter";
import { CONTENT_SHAPE_FILTERS, MISSING_FILTERS, WORKFLOW_FILTERS } from "./constants";
import type { ContentShapeFilter, FlaggedFilter, MissingFilter, VisibilityFilter } from "./types";

export interface DashboardFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface UseDashboardActiveFiltersOptions {
  collectionFilter: string;
  collectionFilters: string[];
  visibilityFilter: VisibilityFilter;
  searchQuery: string;
  transcriptStatusFilters: ContentStatus[];
  metadataStatusFilters: ContentStatus[];
  extraContentStatusFilters: ContentStatus[];
  workflowFilters: WorkflowState[];
  flaggedFilter: FlaggedFilter;
  missingFilters: MissingFilter[];
  contentShapeFilters: ContentShapeFilter[];
  hasDateFilter: boolean;
  toggleVisibilityFilter: (value: "PUBLISHED" | "HIDDEN") => void;
  removeCollectionFilter: (code: string) => void;
  setSearchInput: (value: string) => void;
  setSearchQuery: (value: string) => void;
  getDateButtonText: () => string;
  clearDateFilters: () => void;
  toggleTranscriptFilter: (value: ContentStatus) => void;
  toggleMetadataFilter: (value: ContentStatus) => void;
  toggleExtraContentFilter: (value: ContentStatus) => void;
  toggleWorkflowFilter: (value: WorkflowState) => void;
  toggleFlaggedFilter: (value: Exclude<FlaggedFilter, "ALL">) => void;
  toggleMissingFilter: (value: MissingFilter) => void;
  toggleContentShapeFilter: (value: ContentShapeFilter) => void;
}

function formatContentStatusLabel(status: ContentStatus) {
  return status.toLowerCase().replace("_", " ");
}

function formatWorkflowLabel(workflow: WorkflowState) {
  const option = WORKFLOW_FILTERS.find((filter) => filter.value === workflow);
  return option?.label ?? workflow.toLowerCase().replace(/_/g, " ");
}

function formatMissingFilterLabel(filter: MissingFilter) {
  return MISSING_FILTERS.find((option) => option.value === filter)?.label ?? filter;
}

function formatContentShapeFilterLabel(filter: ContentShapeFilter) {
  return CONTENT_SHAPE_FILTERS.find((option) => option.value === filter)?.label ?? filter;
}

export function useDashboardActiveFilters({
  collectionFilter,
  collectionFilters,
  visibilityFilter,
  searchQuery,
  transcriptStatusFilters,
  metadataStatusFilters,
  extraContentStatusFilters,
  workflowFilters,
  flaggedFilter,
  missingFilters,
  contentShapeFilters,
  hasDateFilter,
  toggleVisibilityFilter,
  removeCollectionFilter,
  setSearchInput,
  setSearchQuery,
  getDateButtonText,
  clearDateFilters,
  toggleTranscriptFilter,
  toggleMetadataFilter,
  toggleExtraContentFilter,
  toggleWorkflowFilter,
  toggleFlaggedFilter,
  toggleMissingFilter,
  toggleContentShapeFilter,
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
      const activeCollectionFilters = collectionFilters.length > 0 ? collectionFilters : collectionFilter.split(",");
      activeCollectionFilters.forEach((code) => {
        chips.push({
          key: `collection-${code}`,
          label: `Collection ${code}`,
          onRemove: () => removeCollectionFilter(code),
        });
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

    missingFilters.forEach((filter) => {
      chips.push({
        key: `missing-${filter}`,
        label: formatMissingFilterLabel(filter),
        onRemove: () => toggleMissingFilter(filter),
      });
    });

    contentShapeFilters.forEach((filter) => {
      chips.push({
        key: `content-shape-${filter}`,
        label: formatContentShapeFilterLabel(filter),
        onRemove: () => toggleContentShapeFilter(filter),
      });
    });

    return chips;
  }, [
    visibilityFilter,
    collectionFilter,
    collectionFilters,
    searchQuery,
    hasDateFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
    extraContentStatusFilters,
    workflowFilters,
    flaggedFilter,
    missingFilters,
    contentShapeFilters,
    toggleVisibilityFilter,
    removeCollectionFilter,
    setSearchInput,
    setSearchQuery,
    getDateButtonText,
    clearDateFilters,
    toggleTranscriptFilter,
    toggleMetadataFilter,
    toggleExtraContentFilter,
    toggleWorkflowFilter,
    toggleFlaggedFilter,
    toggleMissingFilter,
    toggleContentShapeFilter,
  ]);

  const activeFilterCount = activeFilterChips.length;

  return { activeFilterCount, activeFilterChips };
}
