import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDashboardActiveFilters } from "../useDashboardActiveFilters";

function renderActiveFilters(overrides: Partial<Parameters<typeof useDashboardActiveFilters>[0]> = {}) {
  const options: Parameters<typeof useDashboardActiveFilters>[0] = {
    collectionFilter: "all",
    visibilityFilter: "ALL",
    searchQuery: "",
    transcriptStatusFilters: [],
    metadataStatusFilters: [],
    extraContentStatusFilters: [],
    workflowFilters: [],
    flaggedFilter: "ALL",
    hasDateFilter: false,
    toggleVisibilityFilter: vi.fn(),
    handleCollectionInputChange: vi.fn(),
    setSearchInput: vi.fn(),
    setSearchQuery: vi.fn(),
    getDateButtonText: () => "Date",
    clearDateFilters: vi.fn(),
    toggleTranscriptFilter: vi.fn(),
    toggleMetadataFilter: vi.fn(),
    toggleExtraContentFilter: vi.fn(),
    toggleWorkflowFilter: vi.fn(),
    toggleFlaggedFilter: vi.fn(),
    ...overrides,
  };

  return {
    options,
    ...renderHook(() => useDashboardActiveFilters(options)),
  };
}

describe("useDashboardActiveFilters", () => {
  it("counts and labels active filter chips", () => {
    const { result } = renderActiveFilters({
      collectionFilter: "003",
      visibilityFilter: "PUBLISHED",
      searchQuery: "molly",
      transcriptStatusFilters: ["AI_DRAFT"],
      metadataStatusFilters: ["EDITED"],
      extraContentStatusFilters: ["VERIFIED"],
      workflowFilters: ["METADATA_DRAFTED"],
      flaggedFilter: "FLAGGED",
      hasDateFilter: true,
      getDateButtonText: () => "1886",
    });

    expect(result.current.activeFilterCount).toBe(9);
    expect(result.current.activeFilterChips.map((chip) => chip.label)).toEqual([
      "Published",
      "Flagged",
      "Collection 003",
      "Search: molly",
      "1886",
      "Transcript ai draft",
      "Metadata edited",
      "Extras verified",
      "Pipeline: Metadata drafted",
    ]);
  });

  it("routes chip removal to the correct filter controller action", () => {
    const toggleVisibilityFilter = vi.fn();
    const toggleFlaggedFilter = vi.fn();
    const handleCollectionInputChange = vi.fn();
    const setSearchInput = vi.fn();
    const setSearchQuery = vi.fn();
    const clearDateFilters = vi.fn();
    const toggleTranscriptFilter = vi.fn();

    const { result } = renderActiveFilters({
      collectionFilter: "009",
      visibilityFilter: "HIDDEN",
      searchQuery: "jimmie",
      transcriptStatusFilters: ["EMPTY"],
      flaggedFilter: "UNFLAGGED",
      hasDateFilter: true,
      getDateButtonText: () => "1947",
      toggleVisibilityFilter,
      toggleFlaggedFilter,
      handleCollectionInputChange,
      setSearchInput,
      setSearchQuery,
      clearDateFilters,
      toggleTranscriptFilter,
    });

    for (const chip of result.current.activeFilterChips) {
      chip.onRemove();
    }

    expect(toggleVisibilityFilter).toHaveBeenCalledWith("HIDDEN");
    expect(toggleFlaggedFilter).toHaveBeenCalledWith("UNFLAGGED");
    expect(handleCollectionInputChange).toHaveBeenCalledWith("");
    expect(setSearchInput).toHaveBeenCalledWith("");
    expect(setSearchQuery).toHaveBeenCalledWith("");
    expect(clearDateFilters).toHaveBeenCalled();
    expect(toggleTranscriptFilter).toHaveBeenCalledWith("EMPTY");
  });
});
