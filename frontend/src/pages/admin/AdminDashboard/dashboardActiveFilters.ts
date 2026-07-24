import type { ContentStatus, WorkflowState } from "../../../types/Letter";
import {
  CONTENT_SHAPE_FILTERS,
  MISSING_FILTERS,
  WORKFLOW_FILTERS,
} from "./constants";
import {
  getDashboardCollectionFilters,
  hasDashboardDateFilter,
  type DashboardFilterState,
} from "./dashboardFilterStateModel";
import type { DashboardFilterActions } from "./useDashboardFilters";
import type { ContentShapeFilter, MissingFilter } from "./types";

export interface DashboardFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface CreateDashboardActiveFiltersOptions {
  state: DashboardFilterState;
  actions: DashboardFilterActions;
  dateButtonText: string;
}

function formatContentStatusLabel(status: ContentStatus) {
  return status.toLowerCase().replace("_", " ");
}

function formatWorkflowLabel(workflow: WorkflowState) {
  const option = WORKFLOW_FILTERS.find(
    (filter) => filter.value === workflow,
  );
  return option?.label ?? workflow.toLowerCase().replace(/_/g, " ");
}

function formatMissingFilterLabel(filter: MissingFilter) {
  return MISSING_FILTERS.find(
    (option) => option.value === filter,
  )?.label ?? filter;
}

function formatContentShapeFilterLabel(filter: ContentShapeFilter) {
  return CONTENT_SHAPE_FILTERS.find(
    (option) => option.value === filter,
  )?.label ?? filter;
}

export function createDashboardActiveFilters({
  state,
  actions,
  dateButtonText,
}: CreateDashboardActiveFiltersOptions): {
  activeFilterCount: number;
  activeFilterChips: DashboardFilterChip[];
} {
  const { query } = state;
  const chips: DashboardFilterChip[] = [];

  if (query.visibilityFilter !== "ALL") {
    chips.push({
      key: "visibility",
      label: query.visibilityFilter === "PUBLISHED"
        ? "Published"
        : "Hidden",
      onRemove: actions.clearVisibilityFilter,
    });
  }

  if (query.flaggedFilter !== "ALL") {
    chips.push({
      key: "flagged",
      label: query.flaggedFilter === "FLAGGED"
        ? "Flagged"
        : "Unflagged",
      onRemove: actions.clearFlaggedFilter,
    });
  }

  getDashboardCollectionFilters(state).forEach((code) => {
    chips.push({
      key: `collection-${code}`,
      label: `Collection ${code}`,
      onRemove: () => actions.removeCollectionFilter(code),
    });
  });

  if (query.searchQuery) {
    chips.push({
      key: "search",
      label: `Search: ${query.searchQuery}`,
      onRemove: actions.clearSearch,
    });
  }

  if (hasDashboardDateFilter(state)) {
    chips.push({
      key: "date",
      label: dateButtonText,
      onRemove: actions.clearDateFilters,
    });
  }

  query.transcriptStatusFilters.forEach((status) => {
    chips.push({
      key: `transcript-${status}`,
      label: `Transcript ${formatContentStatusLabel(status)}`,
      onRemove: () => actions.removeTranscriptFilter(status),
    });
  });

  query.metadataStatusFilters.forEach((status) => {
    chips.push({
      key: `metadata-${status}`,
      label: `Metadata ${formatContentStatusLabel(status)}`,
      onRemove: () => actions.removeMetadataFilter(status),
    });
  });

  query.extraContentStatusFilters.forEach((status) => {
    chips.push({
      key: `extras-${status}`,
      label: `Extras ${formatContentStatusLabel(status)}`,
      onRemove: () => actions.removeExtraContentFilter(status),
    });
  });

  query.workflowFilters.forEach((workflow) => {
    chips.push({
      key: `workflow-${workflow}`,
      label: `Pipeline: ${formatWorkflowLabel(workflow)}`,
      onRemove: () => actions.removeWorkflowFilter(workflow),
    });
  });

  query.missingFilters.forEach((filter) => {
    chips.push({
      key: `missing-${filter}`,
      label: formatMissingFilterLabel(filter),
      onRemove: () => actions.removeMissingFilter(filter),
    });
  });

  query.contentShapeFilters.forEach((filter) => {
    chips.push({
      key: `content-shape-${filter}`,
      label: formatContentShapeFilterLabel(filter),
      onRemove: () => actions.removeContentShapeFilter(filter),
    });
  });

  return {
    activeFilterCount: chips.length,
    activeFilterChips: chips,
  };
}
