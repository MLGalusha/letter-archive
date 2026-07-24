import { useState, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../../contexts/ToastContext";
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_DASHBOARD_SORT,
  SAVED_VIEWS_STORAGE_KEY,
  STORAGE_KEY,
} from "../constants";
import { createDashboardCommittedQuery } from "../dashboardQueryModel";
import { createDashboardStoredState } from "../dashboardStoredStateModel";
import type {
  ColumnId,
  DashboardViewState,
  SavedDashboardView,
  SortColumn,
} from "../types";
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
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>([
    "date",
    "sender",
    ...DEFAULT_COLUMN_ORDER.filter((column) => (
      column !== "date" && column !== "sender"
    )),
  ]);
  const storedState = createDashboardStoredState(
    createDashboardCommittedQuery({
      collectionFilter: filters.collectionFilter,
      visibilityFilter: filters.visibilityFilter,
      searchQuery: filters.searchQuery,
      yearFilter: filters.yearFilter,
      monthFilter: filters.monthFilter,
      dayFilter: filters.dayFilter,
      dateFromFilter: filters.dateFromFilter,
      dateToFilter: filters.dateToFilter,
      transcriptStatusFilters: filters.transcriptStatusFilters,
      metadataStatusFilters: filters.metadataStatusFilters,
      extraContentStatusFilters: filters.extraContentStatusFilters,
      workflowFilters: filters.workflowFilters,
      flaggedFilter: filters.flaggedFilter,
      missingFilters: filters.missingFilters,
      contentShapeFilters: filters.contentShapeFilters,
    }, sortColumns),
    filters.dateMode,
  );
  const savedViewState = useDashboardSavedViewState({
    storedState,
    visibleColumns,
    columnOrder,
    replaceStoredFilters: filters.replaceStoredFilters,
    replaceSortColumns: (columns) => {
      setSortColumns(columns.map((column) => ({ ...column })));
    },
    replaceStoredColumns: (state) => {
      setVisibleColumns(new Set(state.visibleColumns));
      setColumnOrder([...state.columnOrder]);
    },
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("normalizes hostile persisted filter JSON before exposing Dashboard state", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      visibilityFilter: "PUBLIC",
      collectionFilter: 42,
      searchQuery: { nested: "query" },
      sortColumns: [{ field: "createdAt", direction: "sideways" }],
      dateMode: "weekly",
      year: "1886",
      month: 13,
      day: 0,
      dateFrom: "1886-01-01",
      dateTo: [],
      transcriptStatusFilters: { status: "VERIFIED" },
      metadataStatusFilters: "AI_DRAFT",
      extraContentStatusFilters: null,
      workflowFilters: ["NOT_A_WORKFLOW"],
      flaggedFilter: "MAYBE",
      missingFilters: ["not-a-field"],
      contentShapeFilters: "photos",
    }));

    let mountedFilters!: ReturnType<typeof useDashboardFilters>;
    expect(() => {
      const { result } = renderHook(() => useDashboardFilters());
      mountedFilters = result.current;
    }).not.toThrow();

    expect({
      visibilityFilter: mountedFilters.visibilityFilter,
      collectionFilter: mountedFilters.collectionFilter,
      searchInput: mountedFilters.searchInput,
      searchQuery: mountedFilters.searchQuery,
      dateMode: mountedFilters.dateMode,
      yearFilter: mountedFilters.yearFilter,
      monthFilter: mountedFilters.monthFilter,
      dayFilter: mountedFilters.dayFilter,
      dateFromFilter: mountedFilters.dateFromFilter,
      dateToFilter: mountedFilters.dateToFilter,
      transcriptStatusFilters: mountedFilters.transcriptStatusFilters,
      metadataStatusFilters: mountedFilters.metadataStatusFilters,
      extraContentStatusFilters: mountedFilters.extraContentStatusFilters,
      workflowFilters: mountedFilters.workflowFilters,
      flaggedFilter: mountedFilters.flaggedFilter,
      missingFilters: mountedFilters.missingFilters,
      contentShapeFilters: mountedFilters.contentShapeFilters,
      initialSortColumns: mountedFilters.initialSortColumns,
    }).toEqual({
      visibilityFilter: "ALL",
      collectionFilter: "all",
      searchInput: "",
      searchQuery: "",
      dateMode: "specific",
      yearFilter: null,
      monthFilter: null,
      dayFilter: null,
      dateFromFilter: null,
      dateToFilter: null,
      transcriptStatusFilters: [],
      metadataStatusFilters: [],
      extraContentStatusFilters: [],
      workflowFilters: [],
      flaggedFilter: "ALL",
      missingFilters: [],
      contentShapeFilters: [],
      initialSortColumns: [{ ...DEFAULT_DASHBOARD_SORT }],
    });
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
      result.current.filters.setDateFromFilter("18860101");
      result.current.filters.setDateToFilter("18861231");
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
      dateFrom: "18860101",
      dateTo: "18861231",
      transcriptStatusFilters: ["AI_DRAFT"],
      metadataStatusFilters: ["EDITED"],
      extraContentStatusFilters: ["VERIFIED"],
      workflowFilters: ["METADATA_DRAFTED"],
      flaggedFilter: "FLAGGED",
      missingFilters: ["sender", "date"],
      contentShapeFilters: ["extras", "photos"],
      visibleColumns: ["sender", "date"],
      columnOrder: [
        "date",
        "sender",
        ...DEFAULT_COLUMN_ORDER.filter((column) => (
          column !== "date" && column !== "sender"
        )),
      ],
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

  it("decodes and safely applies a partial legacy saved view as one complete snapshot", () => {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify([{
      id: "legacy-view",
      name: "Legacy cleanup",
      createdAt: "2025-01-01T00:00:00.000Z",
      state: {
        searchQuery: "needle",
        visibleColumns: ["sender", "sender", "unknown-column"],
      },
    }]));

    const { result } = renderHook(() => useSavedViewHarness(), { wrapper });

    act(() => {
      result.current.filters.setVisibilityFilter("PUBLISHED");
      result.current.filters.setTranscriptStatusFilters(["VERIFIED"]);
      result.current.setSortColumns([{ field: "sender", direction: "asc" }]);
    });

    expect(result.current.savedViews).toHaveLength(1);
    expect(() => {
      act(() => {
        result.current.applyView(result.current.savedViews[0]);
      });
    }).not.toThrow();

    expect(result.current.filters.visibilityFilter).toBe("ALL");
    expect(result.current.filters.collectionFilter).toBe("all");
    expect(result.current.filters.searchInput).toBe("needle");
    expect(result.current.filters.searchQuery).toBe("needle");
    expect(result.current.filters.dateMode).toBe("specific");
    expect(result.current.filters.yearFilter).toBeNull();
    expect(result.current.filters.monthFilter).toBeNull();
    expect(result.current.filters.dayFilter).toBeNull();
    expect(result.current.filters.dateFromFilter).toBeNull();
    expect(result.current.filters.dateToFilter).toBeNull();
    expect(result.current.filters.transcriptStatusFilters).toEqual([]);
    expect(result.current.filters.metadataStatusFilters).toEqual([]);
    expect(result.current.filters.extraContentStatusFilters).toEqual([]);
    expect(result.current.filters.workflowFilters).toEqual([]);
    expect(result.current.filters.flaggedFilter).toBe("ALL");
    expect(result.current.filters.missingFilters).toEqual([]);
    expect(result.current.filters.contentShapeFilters).toEqual([]);
    expect(result.current.sortColumns).toEqual([DEFAULT_DASHBOARD_SORT]);
    expect([...result.current.visibleColumns]).toEqual(["sender"]);
    expect(result.current.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("replaces the stored snapshot exactly and owns every applied array", () => {
    const sourceState = makeViewState({
      visibilityFilter: "HIDDEN",
      collectionFilter: "004,012",
      searchQuery: "owned snapshot",
      sortColumns: [{ field: "sender", direction: "asc" }],
      transcriptStatusFilters: ["VERIFIED"],
      metadataStatusFilters: ["AI_DRAFT"],
      extraContentStatusFilters: ["EDITED"],
      workflowFilters: ["METADATA_DRAFTED"],
      missingFilters: ["date"],
      contentShapeFilters: ["photos"],
      visibleColumns: ["sender", "visibility"],
      columnOrder: [
        "visibility",
        "sender",
        ...DEFAULT_COLUMN_ORDER.filter((column) => (
          column !== "visibility" && column !== "sender"
        )),
      ],
    });
    const savedView = makeSavedView(sourceState);
    const { result } = renderHook(() => useSavedViewHarness(), { wrapper });

    act(() => {
      result.current.filters.setTranscriptStatusFilters(["EMPTY", "AI_DRAFT"]);
      result.current.filters.setMetadataStatusFilters(["VERIFIED"]);
      result.current.setSortColumns([{ field: "letterDate", direction: "desc" }]);
      result.current.applyView(savedView);
    });

    expect(result.current.filters.transcriptStatusFilters).toEqual(["VERIFIED"]);
    expect(result.current.filters.metadataStatusFilters).toEqual(["AI_DRAFT"]);
    expect(result.current.filters.extraContentStatusFilters).toEqual(["EDITED"]);
    expect(result.current.filters.workflowFilters).toEqual(["METADATA_DRAFTED"]);
    expect(result.current.filters.missingFilters).toEqual(["date"]);
    expect(result.current.filters.contentShapeFilters).toEqual(["photos"]);
    expect(result.current.sortColumns).toEqual([{ field: "sender", direction: "asc" }]);
    expect([...result.current.visibleColumns]).toEqual(["sender", "visibility"]);
    expect(result.current.columnOrder).toEqual([
      "visibility",
      "sender",
      ...DEFAULT_COLUMN_ORDER.filter((column) => (
        column !== "visibility" && column !== "sender"
      )),
    ]);

    sourceState.transcriptStatusFilters.push("EMPTY");
    sourceState.metadataStatusFilters.push("VERIFIED");
    sourceState.extraContentStatusFilters.push("EMPTY");
    sourceState.workflowFilters.push("REVIEWED");
    sourceState.missingFilters.push("sender");
    sourceState.contentShapeFilters.push("cover");
    sourceState.sortColumns.push({ field: "createdAt", direction: "desc" });
    sourceState.visibleColumns.push("recipient");
    sourceState.columnOrder.push("recipient");

    expect(result.current.filters.transcriptStatusFilters).toEqual(["VERIFIED"]);
    expect(result.current.filters.metadataStatusFilters).toEqual(["AI_DRAFT"]);
    expect(result.current.filters.extraContentStatusFilters).toEqual(["EDITED"]);
    expect(result.current.filters.workflowFilters).toEqual(["METADATA_DRAFTED"]);
    expect(result.current.filters.missingFilters).toEqual(["date"]);
    expect(result.current.filters.contentShapeFilters).toEqual(["photos"]);
    expect(result.current.sortColumns).toEqual([{ field: "sender", direction: "asc" }]);
    expect([...result.current.visibleColumns]).toEqual(["sender", "visibility"]);
    expect(result.current.columnOrder).toEqual([
      "visibility",
      "sender",
      ...DEFAULT_COLUMN_ORDER.filter((column) => (
        column !== "visibility" && column !== "sender"
      )),
    ]);
  });

  it("cancels an older search draft when applying a saved view", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSavedViewHarness(), { wrapper });
    const savedView = makeSavedView(makeViewState({
      searchQuery: "saved search",
    }));

    act(() => {
      result.current.filters.setSearchInput("older draft");
    });
    act(() => {
      result.current.applyView(savedView);
      vi.advanceTimersByTime(300);
    });

    expect(result.current.filters.searchInput).toBe("saved search");
    expect(result.current.filters.searchQuery).toBe("saved search");
  });
});
