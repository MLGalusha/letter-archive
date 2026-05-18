import { useState, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../../../../contexts/ToastContext";
import { DEFAULT_COLUMN_ORDER, SAVED_VIEWS_STORAGE_KEY } from "../constants";
import type { ColumnId, DashboardViewState, SavedDashboardView, SortColumn } from "../types";
import { useDashboardFilters } from "../useDashboardFilters";
import { useDashboardSavedViewState } from "../useDashboardSavedViewState";

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function useSavedViewHarness() {
  const filters = useDashboardFilters();
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([
    { field: "lastOpenedAt", direction: "desc" },
  ]);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(new Set(["sender", "date"]));
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(["date", "sender"]);
  const savedViewState = useDashboardSavedViewState({
    filters,
    sortColumns,
    setSortColumns,
    visibleColumns,
    setVisibleColumns,
    columnOrder,
    setColumnOrder,
  });

  return {
    filters,
    sortColumns,
    setSortColumns,
    visibleColumns,
    columnOrder,
    ...savedViewState,
  };
}

function makeViewState(overrides: Partial<DashboardViewState> = {}): DashboardViewState {
  return {
    visibilityFilter: "ALL",
    collectionFilter: "all",
    searchQuery: "",
    sortColumns: [],
    dateMode: "specific",
    year: null,
    month: null,
    day: null,
    dateFrom: null,
    dateTo: null,
    transcriptStatusFilters: [],
    metadataStatusFilters: [],
    extraContentStatusFilters: [],
    workflowFilters: [],
    flaggedFilter: "ALL",
    missingFilters: [],
    contentShapeFilters: [],
    visibleColumns: ["sender", "recipient"],
    columnOrder: ["sender", "recipient"],
    ...overrides,
  };
}

function makeSavedView(state: DashboardViewState): SavedDashboardView {
  return {
    id: "view-1",
    name: "Saved cleanup",
    createdAt: "2026-05-18T00:00:00.000Z",
    state,
  };
}

describe("useDashboardSavedViewState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("captures the current dashboard filters, sort, visible columns, and column order", () => {
    const { result } = renderHook(() => useSavedViewHarness(), { wrapper });

    act(() => {
      result.current.filters.setVisibilityFilter("PUBLISHED");
      result.current.filters.setCollectionFilter("003");
      result.current.filters.setCollectionInput("003");
      result.current.filters.setSearchInput("molly");
      result.current.filters.setSearchQuery("molly");
      result.current.filters.setDateMode("range");
      result.current.filters.setDateFromFilter("1886-01-01");
      result.current.filters.setDateToFilter("1886-12-31");
      result.current.filters.setTranscriptStatusFilters(["AI_DRAFT"]);
      result.current.filters.setMetadataStatusFilters(["EDITED"]);
      result.current.filters.setExtraContentStatusFilters(["VERIFIED"]);
      result.current.filters.setWorkflowFilters(["METADATA_DRAFTED"]);
      result.current.filters.setFlaggedFilter("FLAGGED");
      result.current.filters.setMissingFilters(["sender", "date"]);
      result.current.filters.setContentShapeFilters(["extras", "photos"]);
      result.current.setSortColumns([{ field: "letterDate", direction: "asc" }]);
    });

    act(() => {
      result.current.saveView("Cleanup");
    });

    expect(result.current.savedViews[0]?.state).toMatchObject({
      visibilityFilter: "PUBLISHED",
      collectionFilter: "003",
      searchQuery: "molly",
      sortColumns: [{ field: "letterDate", direction: "asc" }],
      dateMode: "range",
      dateFrom: "1886-01-01",
      dateTo: "1886-12-31",
      transcriptStatusFilters: ["AI_DRAFT"],
      metadataStatusFilters: ["EDITED"],
      extraContentStatusFilters: ["VERIFIED"],
      workflowFilters: ["METADATA_DRAFTED"],
      flaggedFilter: "FLAGGED",
      missingFilters: ["sender", "date"],
      contentShapeFilters: ["extras", "photos"],
      visibleColumns: ["sender", "date"],
      columnOrder: ["date", "sender"],
    });

    const persisted = JSON.parse(localStorage.getItem(SAVED_VIEWS_STORAGE_KEY) ?? "[]");
    expect(persisted[0]?.name).toBe("Cleanup");
  });

  it("applies saved dashboard state and backfills fields missing from older saved views", () => {
    const { result } = renderHook(() => useSavedViewHarness(), { wrapper });
    const legacyState = makeViewState({
      visibilityFilter: "HIDDEN",
      collectionFilter: "012",
      searchQuery: "jimmie",
      sortColumns: [{ field: "sender", direction: "asc" }],
      year: 1947,
      transcriptStatusFilters: ["VERIFIED"],
      metadataStatusFilters: ["AI_DRAFT"],
      visibleColumns: ["recipient", "visibility"],
      extraContentStatusFilters: undefined,
      workflowFilters: undefined,
      flaggedFilter: undefined,
      missingFilters: undefined,
      contentShapeFilters: undefined,
      columnOrder: undefined,
    } as Partial<DashboardViewState>);

    act(() => {
      result.current.applyView(makeSavedView(legacyState));
    });

    expect(result.current.filters.visibilityFilter).toBe("HIDDEN");
    expect(result.current.filters.collectionFilter).toBe("012");
    expect(result.current.filters.collectionFilters).toEqual(["012"]);
    expect(result.current.filters.collectionInput).toBe("");
    expect(result.current.filters.searchInput).toBe("jimmie");
    expect(result.current.filters.searchQuery).toBe("jimmie");
    expect(result.current.filters.yearFilter).toBe(1947);
    expect(result.current.filters.transcriptStatusFilters).toEqual(["VERIFIED"]);
    expect(result.current.filters.metadataStatusFilters).toEqual(["AI_DRAFT"]);
    expect(result.current.filters.extraContentStatusFilters).toEqual([]);
    expect(result.current.filters.workflowFilters).toEqual([]);
    expect(result.current.filters.flaggedFilter).toBe("ALL");
    expect(result.current.filters.missingFilters).toEqual([]);
    expect(result.current.filters.contentShapeFilters).toEqual([]);
    expect(result.current.sortColumns).toEqual([{ field: "sender", direction: "asc" }]);
    expect([...result.current.visibleColumns]).toEqual(["recipient", "visibility"]);
    expect(result.current.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });
});
