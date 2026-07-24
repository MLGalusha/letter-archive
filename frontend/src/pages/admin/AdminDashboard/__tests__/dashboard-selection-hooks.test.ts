import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDashboardRowSelection } from "../useDashboardRowSelection";
import { useDashboardSelection } from "../useDashboardSelection";

const rows = [
  { id: "letter-1" },
  { id: "letter-2" },
  { id: "letter-3" },
  { id: "letter-4" },
];

function useSelectionHarness(initialRows = rows) {
  const selection = useDashboardSelection(initialRows);
  const rowSelection = useDashboardRowSelection({
    rows: initialRows,
    selectedIds: selection.selectedIds,
    setSelectedIds: selection.setSelectedIds,
    setAllFilteredSelected: selection.setAllFilteredSelected,
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
    const { result } = renderHook(() => useDashboardSelection(rows.slice(0, 2)));

    act(() => {
      result.current.selectAllFiltered(["letter-1", "letter-2", "letter-3"]);
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
    const { result } = renderHook(() => useSelectionHarness());

    act(() => {
      result.current.handleCheckboxChange("letter-1", 0);
    });

    act(() => {
      result.current.handleCheckboxChange("letter-3", 2, { shiftKey: true });
    });

    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
    ]);
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
    const { result } = renderHook(() => useSelectionHarness());

    act(() => {
      result.current.handleSelectAllPage();
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
    ]);
  });
});
