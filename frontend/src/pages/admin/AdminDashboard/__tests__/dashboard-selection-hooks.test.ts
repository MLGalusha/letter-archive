import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardCommittedQuery } from "../dashboardQueryModel";
import { useDashboardRowSelection } from "../useDashboardRowSelection";
import { useDashboardSelection } from "../useDashboardSelection";

const rows = [
  { id: "letter-1", primarySourceRevision: 1 },
  { id: "letter-2", primarySourceRevision: 2 },
  { id: "letter-3", primarySourceRevision: 3 },
  { id: "letter-4", primarySourceRevision: 4 },
];

function makeQuery(
  overrides: Partial<DashboardCommittedQuery> = {},
): DashboardCommittedQuery {
  return {
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
    sortColumns: [{ field: "lastOpenedAt", direction: "desc" }],
    ...overrides,
  };
}

const queryA = makeQuery({ collectionFilter: "001" });
const queryB = makeQuery({
  collectionFilter: "002",
  searchQuery: "different result set",
});
const filteredSources = Array.from({ length: 51 }, (_, index) => ({
  letterId: `letter-${index + 1}`,
  primarySourceRevision: 100 + index,
}));
const firstPageRows = filteredSources.slice(0, 50).map((source) => ({
  id: source.letterId,
  primarySourceRevision: source.primarySourceRevision,
}));

function useSelectionHarness(
  initialRows = rows,
  query?: DashboardCommittedQuery,
) {
  const selection = useDashboardSelection(initialRows, query);
  const rowSelection = useDashboardRowSelection({
    rows: initialRows,
    selectedIds: selection.selectedIds,
    replaceExplicitSelection: selection.replaceExplicitSelection,
    toggleSelection: selection.toggleSelection,
  });

  return {
    ...selection,
    ...rowSelection,
  };
}

function makeMouseEvent({
  tagName = "TD",
  button = 0,
}: {
  tagName?: string;
  button?: number;
} = {}) {
  return {
    button,
    target: { tagName },
    preventDefault: vi.fn(),
  } as unknown as React.MouseEvent;
}

describe("dashboard selection hooks", () => {
  it("selects and clears the current page independently from filtered selection", () => {
    const { result } = renderHook(() => useDashboardSelection(rows));

    act(() => {
      result.current.handleSelectAllPage();
    });

    expect(result.current.allPageSelected).toBe(true);
    expect(result.current.allFilteredSelected).toBe(false);
    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
      "letter-4",
    ]);

    act(() => {
      result.current.handleSelectAllPage();
    });

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.allPageSelected).toBe(false);
  });

  it("marks all-filtered selection separately from page selection", () => {
    const { result } = renderHook(() => (
      useDashboardSelection(rows.slice(0, 2), queryA)
    ));

    act(() => {
      result.current.selectAllFiltered([
        { letterId: "letter-1", primarySourceRevision: 1 },
        { letterId: "letter-2", primarySourceRevision: 2 },
        { letterId: "letter-3", primarySourceRevision: 3 },
      ], result.current.selectionIntent);
    });

    expect(result.current.allFilteredSelected).toBe(true);
    expect(result.current.allPageSelected).toBe(true);
    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
    ]);
  });

  it("retains the source revision observed when a row was selected", () => {
    const initialRows = [
      { id: "letter-1", primarySourceRevision: 4 },
    ];
    const { result, rerender } = renderHook(
      ({ currentRows }) => useDashboardSelection(currentRows),
      { initialProps: { currentRows: initialRows } },
    );

    act(() => {
      result.current.toggleSelection("letter-1");
    });

    rerender({
      currentRows: [{ id: "letter-1", primarySourceRevision: 9 }],
    });

    expect(result.current.selectedSources).toEqual([
      { letterId: "letter-1", primarySourceRevision: 4 },
    ]);
  });

  it("shift-selects a checkbox range from the last clicked row", () => {
    const allSources = [
      ...rows.map(({ id, primarySourceRevision }) => ({
        letterId: id,
        primarySourceRevision,
      })),
      { letterId: "letter-off-page", primarySourceRevision: 99 },
    ];
    const { result } = renderHook(() => useSelectionHarness(rows, queryA));

    act(() => {
      result.current.handleCheckboxChange("letter-1", 0);
    });
    act(() => {
      result.current.selectAllFiltered(
        allSources,
        result.current.selectionIntent,
      );
    });

    act(() => {
      result.current.handleCheckboxChange("letter-3", 2, { shiftKey: true });
    });

    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
      "letter-4",
      "letter-off-page",
    ]);
    expect(result.current.selectedSources).toEqual(allSources);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("drag-selects a row range from an unselected starting row", () => {
    const { result } = renderHook(() => useSelectionHarness());
    const mouseDownEvent = makeMouseEvent();

    act(() => {
      result.current.handleRowMouseDown(1, mouseDownEvent);
    });

    act(() => {
      result.current.handleRowMouseEnter(3);
    });

    expect(mouseDownEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.hasDragMoved).toBe(true);
    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-2",
      "letter-3",
      "letter-4",
    ]);
  });

  it("drag-deselects a row range from a selected starting row", () => {
    const allSources = [
      ...rows.map(({ id, primarySourceRevision }) => ({
        letterId: id,
        primarySourceRevision,
      })),
      { letterId: "letter-off-page", primarySourceRevision: 99 },
    ];
    const { result } = renderHook(() => useSelectionHarness(rows, queryA));

    act(() => {
      result.current.selectAllFiltered(
        allSources,
        result.current.selectionIntent,
      );
    });

    act(() => {
      result.current.handleRowMouseDown(1, makeMouseEvent());
    });

    act(() => {
      result.current.handleRowMouseEnter(2);
    });

    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-4",
      "letter-off-page",
    ]);
    expect(result.current.selectedSources).toEqual([
      allSources[0],
      allSources[3],
      allSources[4],
    ]);
    expect(result.current.allFilteredSelected).toBe(false);
  });
});

describe("query-bound dashboard selection ownership", () => {
  it("keeps every filtered source snapshot, including sources beyond the current page", () => {
    const { result } = renderHook(() => (
      useDashboardSelection(firstPageRows, queryA)
    ));

    act(() => {
      result.current.selectAllFiltered(
        filteredSources,
        result.current.selectionIntent,
      );
    });

    expect(Array.from(result.current.selectedIds)).toEqual(
      filteredSources.map(({ letterId }) => letterId),
    );
    expect(result.current.selectedSources).toEqual(filteredSources);
    expect(result.current.allFilteredSelected).toBe(true);
  });

  it("revokes all-filtered scope synchronously when the committed query changes", () => {
    const { result, rerender } = renderHook(
      ({ query }) => useDashboardSelection(firstPageRows, query),
      { initialProps: { query: queryA } },
    );

    act(() => {
      result.current.selectAllFiltered(
        filteredSources,
        result.current.selectionIntent,
      );
    });
    expect(result.current.allFilteredSelected).toBe(true);

    rerender({ query: queryB });

    expect(result.current.allFilteredSelected).toBe(false);

    rerender({ query: queryA });

    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("makes an explicit replacement atomic with scope revocation and source retention", () => {
    const { result } = renderHook(() => (
      useDashboardSelection(firstPageRows, queryA)
    ));

    act(() => {
      result.current.selectAllFiltered(
        filteredSources,
        result.current.selectionIntent,
      );
    });
    act(() => {
      result.current.replaceExplicitSelection(
        new Set(["letter-1", "letter-51"]),
      );
    });

    expect(result.current.allFilteredSelected).toBe(false);
    expect(result.current.selectedSources).toEqual([
      filteredSources[0],
      filteredSources[50],
    ]);
  });

  it("makes manual selection atomic with scope revocation and source retention", () => {
    const currentRows = [
      { id: "letter-52", primarySourceRevision: 900 },
    ];
    const { result } = renderHook(() => (
      useDashboardSelection(currentRows, queryA)
    ));

    act(() => {
      result.current.selectAllFiltered(
        filteredSources,
        result.current.selectionIntent,
      );
    });
    act(() => {
      result.current.toggleSelection("letter-52");
    });

    expect(result.current.allFilteredSelected).toBe(false);
    expect(result.current.selectedSources).toEqual([
      ...filteredSources,
      { letterId: "letter-52", primarySourceRevision: 900 },
    ]);
  });

  it("makes current-page selection atomic with scope revocation and source retention", () => {
    const currentRows = [
      { id: "letter-52", primarySourceRevision: 900 },
      { id: "letter-53", primarySourceRevision: 901 },
    ];
    const { result } = renderHook(() => (
      useDashboardSelection(currentRows, queryA)
    ));

    act(() => {
      result.current.selectAllFiltered(
        filteredSources,
        result.current.selectionIntent,
      );
    });
    act(() => {
      result.current.handleSelectAllPage();
    });

    expect(result.current.allFilteredSelected).toBe(false);
    expect(result.current.selectedSources).toEqual([
      ...filteredSources,
      { letterId: "letter-52", primarySourceRevision: 900 },
      { letterId: "letter-53", primarySourceRevision: 901 },
    ]);
  });

  it("keeps an older mutation outcome from replacing newer manual intent", () => {
    const currentRows = [
      { id: "letter-1", primarySourceRevision: 101 },
      { id: "letter-2", primarySourceRevision: 202 },
    ];
    const { result } = renderHook(() => (
      useDashboardSelection(currentRows, queryA)
    ));

    act(() => {
      result.current.toggleSelection("letter-1");
    });
    let mutationIntent!: ReturnType<
      typeof result.current.makeSelectionExplicit
    >;
    act(() => {
      mutationIntent = result.current.makeSelectionExplicit();
    });
    act(() => {
      result.current.toggleSelection("letter-2");
      result.current.replaceExplicitSelection(
        new Set(["letter-1"]),
        mutationIntent,
      );
      result.current.clearSelectionIfCurrent(mutationIntent);
    });

    expect(result.current.selectedSources).toEqual([
      { letterId: "letter-1", primarySourceRevision: 101 },
      { letterId: "letter-2", primarySourceRevision: 202 },
    ]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("does not expose an independent all-filtered scope setter", () => {
    const { result } = renderHook(() => (
      useDashboardSelection(firstPageRows, queryA)
    ));

    expect(result.current).not.toHaveProperty("setAllFilteredSelected");
  });
});
