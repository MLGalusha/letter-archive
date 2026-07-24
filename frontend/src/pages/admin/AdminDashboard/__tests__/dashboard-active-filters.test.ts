import { describe, expect, it, vi } from "vitest";
import { createDashboardActiveFilters } from "../dashboardActiveFilters";
import {
  makeDashboardFilterActions,
  makeDashboardFilterState,
} from "./dashboardFilterFixtures";

describe("createDashboardActiveFilters", () => {
  it("counts and labels active filter chips in the established order", () => {
    const result = createDashboardActiveFilters({
      state: makeDashboardFilterState({
        query: {
          collectionFilter: "003",
          visibilityFilter: "PUBLISHED",
          searchQuery: "molly",
          yearFilter: 1886,
          transcriptStatusFilters: ["AI_DRAFT"],
          metadataStatusFilters: ["EDITED"],
          extraContentStatusFilters: ["VERIFIED"],
          workflowFilters: ["METADATA_DRAFTED"],
          flaggedFilter: "FLAGGED",
          missingFilters: ["sender", "date"],
          contentShapeFilters: ["photos"],
        },
      }),
      actions: makeDashboardFilterActions(),
      dateButtonText: "1886",
    });

    expect(result.activeFilterCount).toBe(12);
    expect(result.activeFilterChips.map((chip) => chip.label)).toEqual([
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
    const result = createDashboardActiveFilters({
      state: makeDashboardFilterState({
        query: { collectionFilter: "003,009" },
      }),
      actions: makeDashboardFilterActions({ removeCollectionFilter }),
      dateButtonText: "Date",
    });

    expect(result.activeFilterChips.map((chip) => chip.label)).toEqual([
      "Collection 003",
      "Collection 009",
    ]);

    result.activeFilterChips[1]?.onRemove();

    expect(removeCollectionFilter).toHaveBeenCalledWith("009");
  });

  it("routes chip removal through idempotent named actions", () => {
    const clearVisibilityFilter = vi.fn();
    const clearFlaggedFilter = vi.fn();
    const removeCollectionFilter = vi.fn();
    const clearSearch = vi.fn();
    const clearDateFilters = vi.fn();
    const removeTranscriptFilter = vi.fn();
    const removeMetadataFilter = vi.fn();
    const removeExtraContentFilter = vi.fn();
    const removeWorkflowFilter = vi.fn();
    const removeMissingFilter = vi.fn();
    const removeContentShapeFilter = vi.fn();
    const result = createDashboardActiveFilters({
      state: makeDashboardFilterState({
        query: {
          collectionFilter: "009",
          visibilityFilter: "HIDDEN",
          searchQuery: "jimmie",
          yearFilter: 1947,
          transcriptStatusFilters: ["EMPTY"],
          metadataStatusFilters: ["EDITED"],
          extraContentStatusFilters: ["VERIFIED"],
          workflowFilters: ["METADATA_DRAFTED"],
          flaggedFilter: "UNFLAGGED",
          missingFilters: ["recipient"],
          contentShapeFilters: ["telegram"],
        },
      }),
      actions: makeDashboardFilterActions({
        clearVisibilityFilter,
        clearFlaggedFilter,
        removeCollectionFilter,
        clearSearch,
        clearDateFilters,
        removeTranscriptFilter,
        removeMetadataFilter,
        removeExtraContentFilter,
        removeWorkflowFilter,
        removeMissingFilter,
        removeContentShapeFilter,
      }),
      dateButtonText: "1947",
    });

    for (const chip of result.activeFilterChips) {
      chip.onRemove();
    }

    expect(clearVisibilityFilter).toHaveBeenCalledOnce();
    expect(clearFlaggedFilter).toHaveBeenCalledOnce();
    expect(removeCollectionFilter).toHaveBeenCalledWith("009");
    expect(clearSearch).toHaveBeenCalledOnce();
    expect(clearDateFilters).toHaveBeenCalledOnce();
    expect(removeTranscriptFilter).toHaveBeenCalledWith("EMPTY");
    expect(removeMetadataFilter).toHaveBeenCalledWith("EDITED");
    expect(removeExtraContentFilter).toHaveBeenCalledWith("VERIFIED");
    expect(removeWorkflowFilter).toHaveBeenCalledWith(
      "METADATA_DRAFTED",
    );
    expect(removeMissingFilter).toHaveBeenCalledWith("recipient");
    expect(removeContentShapeFilter).toHaveBeenCalledWith("telegram");
  });
});
