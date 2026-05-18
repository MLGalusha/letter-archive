import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDashboardActiveFilters } from "../useDashboardActiveFilters";

function renderActiveFilters(overrides: Partial<Parameters<typeof useDashboardActiveFilters>[0]> = {}) {
  const options: Parameters<typeof useDashboardActiveFilters>[0] = {
    collectionFilter: "all",
    collectionFilters: [],
    visibilityFilter: "ALL",
    searchQuery: "",
    transcriptStatusFilters: [],
    metadataStatusFilters: [],
    extraContentStatusFilters: [],
    workflowFilters: [],
    flaggedFilter: "ALL",
    missingFilters: [],
    contentShapeFilters: [],
    hasDateFilter: false,
    toggleVisibilityFilter: vi.fn(),
    removeCollectionFilter: vi.fn(),
    setSearchInput: vi.fn(),
    setSearchQuery: vi.fn(),
    getDateButtonText: () => "Date",
    clearDateFilters: vi.fn(),
    toggleTranscriptFilter: vi.fn(),
    toggleMetadataFilter: vi.fn(),
    toggleExtraContentFilter: vi.fn(),
    toggleWorkflowFilter: vi.fn(),
    toggleFlaggedFilter: vi.fn(),
    toggleMissingFilter: vi.fn(),
    toggleContentShapeFilter: vi.fn(),
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
      collectionFilters: ["003"],
      visibilityFilter: "PUBLISHED",
      searchQuery: "molly",
      transcriptStatusFilters: ["AI_DRAFT"],
      metadataStatusFilters: ["EDITED"],
      extraContentStatusFilters: ["VERIFIED"],
      workflowFilters: ["METADATA_DRAFTED"],
      flaggedFilter: "FLAGGED",
      missingFilters: ["sender", "date"],
      contentShapeFilters: ["photos"],
      hasDateFilter: true,
      getDateButtonText: () => "1886",
    });

    expect(result.current.activeFilterCount).toBe(12);
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
      "Missing sender",
      "Missing date",
      "Photos",
    ]);
  });

  it("creates a removable chip for each active collection code", () => {
    const removeCollectionFilter = vi.fn();
    const { result } = renderActiveFilters({
      collectionFilter: "003,009",
      collectionFilters: ["003", "009"],
      removeCollectionFilter,
    });

    expect(result.current.activeFilterChips.map((chip) => chip.label)).toEqual([
      "Collection 003",
      "Collection 009",
    ]);

    result.current.activeFilterChips[1]?.onRemove();

    expect(removeCollectionFilter).toHaveBeenCalledWith("009");
  });

  it("routes chip removal to the correct filter controller action", () => {
    const toggleVisibilityFilter = vi.fn();
    const toggleFlaggedFilter = vi.fn();
    const removeCollectionFilter = vi.fn();
    const setSearchInput = vi.fn();
    const setSearchQuery = vi.fn();
    const clearDateFilters = vi.fn();
    const toggleTranscriptFilter = vi.fn();
    const toggleMissingFilter = vi.fn();
    const toggleContentShapeFilter = vi.fn();

    const { result } = renderActiveFilters({
      collectionFilter: "009",
      collectionFilters: ["009"],
      visibilityFilter: "HIDDEN",
      searchQuery: "jimmie",
      transcriptStatusFilters: ["EMPTY"],
      flaggedFilter: "UNFLAGGED",
      missingFilters: ["recipient"],
      contentShapeFilters: ["telegram"],
      hasDateFilter: true,
      getDateButtonText: () => "1947",
      toggleVisibilityFilter,
      toggleFlaggedFilter,
      removeCollectionFilter,
      setSearchInput,
      setSearchQuery,
      clearDateFilters,
      toggleTranscriptFilter,
      toggleMissingFilter,
      toggleContentShapeFilter,
    });

    for (const chip of result.current.activeFilterChips) {
      chip.onRemove();
    }

    expect(toggleVisibilityFilter).toHaveBeenCalledWith("HIDDEN");
    expect(toggleFlaggedFilter).toHaveBeenCalledWith("UNFLAGGED");
    expect(removeCollectionFilter).toHaveBeenCalledWith("009");
    expect(setSearchInput).toHaveBeenCalledWith("");
    expect(setSearchQuery).toHaveBeenCalledWith("");
    expect(clearDateFilters).toHaveBeenCalled();
    expect(toggleTranscriptFilter).toHaveBeenCalledWith("EMPTY");
    expect(toggleMissingFilter).toHaveBeenCalledWith("recipient");
    expect(toggleContentShapeFilter).toHaveBeenCalledWith("telegram");
  });
});
