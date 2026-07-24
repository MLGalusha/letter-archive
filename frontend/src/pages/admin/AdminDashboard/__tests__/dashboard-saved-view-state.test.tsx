import { useState, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ToastProvider } from "../../../../contexts/ToastContext";
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_DASHBOARD_SORT,
  SAVED_VIEWS_STORAGE_KEY,
  STORAGE_KEY,
} from "../constants";
import { createDashboardCommittedQuery } from "../dashboardQueryModel";
import { getDashboardCollectionFilters } from "../dashboardFilterStateModel";
import { createDashboardStoredState } from "../dashboardStoredStateModel";
import type {
  ColumnId,
  DashboardViewState,
  PersistedState,
  SavedDashboardView,
  SortColumn,
} from "../types";
import { useDashboardFilters } from "../useDashboardFilters";
import { useDashboardSavedViewState } from "../useDashboardSavedViewState";
import { loadPersistedState } from "../utils";

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function makePersistedState(
  overrides: Partial<PersistedState> = {},
): PersistedState {
  return {
    visibilityFilter: "ALL",
    collectionFilter: "all",
    searchQuery: "",
    sortColumns: [{ ...DEFAULT_DASHBOARD_SORT }],
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
    ...overrides,
  };
}

function useSavedViewHarness() {
  const [initialStoredState] = useState(loadPersistedState);
  const filters = useDashboardFilters(initialStoredState);
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([
    { field: "lastOpenedAt", direction: "desc" },
  ]);
  const [visibleColumns, setVisibleColumns] =
    useState<Set<ColumnId>>(new Set(["sender", "date"]));
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>([
    "date",
    "sender",
    ...DEFAULT_COLUMN_ORDER.filter((column) => (
      column !== "date" && column !== "sender"
    )),
  ]);
  const storedState = createDashboardStoredState(
    createDashboardCommittedQuery(filters.state.query, sortColumns),
    filters.state.dateMode,
  );
  const savedViewState = useDashboardSavedViewState({
    storedState,
    visibleColumns,
    columnOrder,
    replaceStoredFilters: filters.actions.replaceStoredFilters,
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

function makeViewState(
  overrides: Partial<DashboardViewState> = {},
): DashboardViewState {
  return {
    ...makePersistedState(),
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

  it("normalizes hostile persisted JSON before seeding filter and sort owners", () => {
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

    const initialStoredState = loadPersistedState();
    let mountedFilters!: ReturnType<typeof useDashboardFilters>;
    expect(() => {
      const { result } = renderHook(
        () => useDashboardFilters(initialStoredState),
      );
      mountedFilters = result.current;
    }).not.toThrow();

    expect({
      ...mountedFilters.state,
      drafts: mountedFilters.drafts,
      initialSortColumns: initialStoredState.sortColumns,
    }).toEqual({
      query: {
        collectionFilter: "all",
        visibilityFilter: "ALL",
        searchQuery: "",
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
      },
      dateMode: "specific",
      drafts: {
        contentFilterView: "transcript",
        collectionInput: "",
        searchInput: "",
      },
      initialSortColumns: [{ ...DEFAULT_DASHBOARD_SORT }],
    });
  });

  it("captures current filters, sort, visible columns, and column order", () => {
    const { result } = renderHook(
      () => useSavedViewHarness(),
      { wrapper },
    );

    act(() => {
      result.current.filters.actions.replaceStoredFilters(
        makePersistedState({
          visibilityFilter: "PUBLISHED",
          collectionFilter: "003",
          searchQuery: "molly",
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
        }),
      );
      result.current.setSortColumns([
        { field: "letterDate", direction: "asc" },
      ]);
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

    const persisted = JSON.parse(
      localStorage.getItem(SAVED_VIEWS_STORAGE_KEY) ?? "[]",
    );
    expect(persisted[0]?.name).toBe("Cleanup");
  });

  it("applies saved state and backfills fields missing from older views", () => {
    const { result } = renderHook(
      () => useSavedViewHarness(),
      { wrapper },
    );
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

    const { query } = result.current.filters.state;
    expect(query).toMatchObject({
      visibilityFilter: "HIDDEN",
      collectionFilter: "012",
      searchQuery: "jimmie",
      yearFilter: 1947,
      transcriptStatusFilters: ["VERIFIED"],
      metadataStatusFilters: ["AI_DRAFT"],
      extraContentStatusFilters: [],
      workflowFilters: [],
      flaggedFilter: "ALL",
      missingFilters: [],
      contentShapeFilters: [],
    });
    expect(
      getDashboardCollectionFilters(result.current.filters.state),
    ).toEqual(["012"]);
    expect(result.current.filters.drafts).toMatchObject({
      collectionInput: "",
      searchInput: "jimmie",
    });
    expect(result.current.sortColumns).toEqual([
      { field: "sender", direction: "asc" },
    ]);
    expect([...result.current.visibleColumns]).toEqual([
      "recipient",
      "visibility",
    ]);
    expect(result.current.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("safely applies a partial legacy view as one complete snapshot", () => {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify([{
      id: "legacy-view",
      name: "Legacy cleanup",
      createdAt: "2025-01-01T00:00:00.000Z",
      state: {
        searchQuery: "needle",
        visibleColumns: ["sender", "sender", "unknown-column"],
      },
    }]));

    const { result } = renderHook(
      () => useSavedViewHarness(),
      { wrapper },
    );

    act(() => {
      result.current.filters.actions.toggleVisibilityFilter("PUBLISHED");
      result.current.filters.actions.toggleTranscriptFilter("VERIFIED");
      result.current.setSortColumns([
        { field: "sender", direction: "asc" },
      ]);
    });

    expect(result.current.savedViews).toHaveLength(1);
    expect(() => {
      act(() => {
        result.current.applyView(result.current.savedViews[0]);
      });
    }).not.toThrow();

    expect(result.current.filters.state).toEqual({
      query: {
        collectionFilter: "all",
        visibilityFilter: "ALL",
        searchQuery: "needle",
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
      },
      dateMode: "specific",
    });
    expect(result.current.filters.drafts.searchInput).toBe("needle");
    expect(result.current.sortColumns).toEqual([DEFAULT_DASHBOARD_SORT]);
    expect([...result.current.visibleColumns]).toEqual(["sender"]);
    expect(result.current.columnOrder).toEqual(DEFAULT_COLUMN_ORDER);
  });

  it("replaces the snapshot exactly and owns every applied array", () => {
    const expectedColumnOrder: ColumnId[] = [
      "visibility",
      "sender",
      ...DEFAULT_COLUMN_ORDER.filter((column) => (
        column !== "visibility" && column !== "sender"
      )),
    ];
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
      columnOrder: [...expectedColumnOrder],
    });
    const savedView = makeSavedView(sourceState);
    const { result } = renderHook(
      () => useSavedViewHarness(),
      { wrapper },
    );

    act(() => {
      result.current.applyView(savedView);
    });

    const queryAfterApply = result.current.filters.state.query;
    expect(queryAfterApply).toMatchObject({
      transcriptStatusFilters: ["VERIFIED"],
      metadataStatusFilters: ["AI_DRAFT"],
      extraContentStatusFilters: ["EDITED"],
      workflowFilters: ["METADATA_DRAFTED"],
      missingFilters: ["date"],
      contentShapeFilters: ["photos"],
    });
    expect(result.current.sortColumns).toEqual([
      { field: "sender", direction: "asc" },
    ]);
    expect([...result.current.visibleColumns]).toEqual([
      "sender",
      "visibility",
    ]);
    expect(result.current.columnOrder).toEqual(expectedColumnOrder);

    sourceState.transcriptStatusFilters.push("EMPTY");
    sourceState.metadataStatusFilters.push("VERIFIED");
    sourceState.extraContentStatusFilters.push("EMPTY");
    sourceState.workflowFilters.push("REVIEWED");
    sourceState.missingFilters.push("sender");
    sourceState.contentShapeFilters.push("cover");
    sourceState.sortColumns.push({
      field: "createdAt",
      direction: "desc",
    });
    sourceState.visibleColumns.push("recipient");
    sourceState.columnOrder.push("recipient");

    expect(result.current.filters.state.query).toBe(queryAfterApply);
    expect(queryAfterApply).toMatchObject({
      transcriptStatusFilters: ["VERIFIED"],
      metadataStatusFilters: ["AI_DRAFT"],
      extraContentStatusFilters: ["EDITED"],
      workflowFilters: ["METADATA_DRAFTED"],
      missingFilters: ["date"],
      contentShapeFilters: ["photos"],
    });
    expect(result.current.sortColumns).toEqual([
      { field: "sender", direction: "asc" },
    ]);
    expect([...result.current.visibleColumns]).toEqual([
      "sender",
      "visibility",
    ]);
    expect(result.current.columnOrder).toEqual(expectedColumnOrder);
  });

  it("cancels an older search draft when applying a saved view", () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      () => useSavedViewHarness(),
      { wrapper },
    );
    const savedView = makeSavedView(makeViewState({
      searchQuery: "saved search",
    }));

    act(() => {
      result.current.filters.actions.changeSearchInput("older draft");
    });
    act(() => {
      result.current.applyView(savedView);
      vi.advanceTimersByTime(300);
    });

    expect(result.current.filters.drafts.searchInput).toBe("saved search");
    expect(result.current.filters.state.query.searchQuery).toBe(
      "saved search",
    );
  });
});
