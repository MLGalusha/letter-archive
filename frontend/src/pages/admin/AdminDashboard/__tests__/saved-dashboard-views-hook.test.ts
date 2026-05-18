import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_VIEWS_STORAGE_KEY } from "../constants";
import type { DashboardViewState, SavedDashboardView } from "../types";
import { useSavedDashboardViews } from "../useSavedDashboardViews";

function makeState(overrides: Partial<DashboardViewState> = {}): DashboardViewState {
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
    visibleColumns: ["sender", "recipient"],
    columnOrder: ["sender", "recipient"],
    ...overrides,
  };
}

function makeSavedView(id: string, name = id): SavedDashboardView {
  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    state: makeState({ searchQuery: name }),
  };
}

describe("useSavedDashboardViews", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves a trimmed dashboard view and persists it first", () => {
    const onSaved = vi.fn();
    const state = makeState({ searchQuery: "flagged" });

    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => state,
      applyState: vi.fn(),
      onSaved,
      onApplied: vi.fn(),
    }));

    act(() => {
      result.current.saveView("  Flagged cleanup  ");
    });

    expect(result.current.savedViews[0]).toMatchObject({
      name: "Flagged cleanup",
      state,
    });
    expect(onSaved).toHaveBeenCalledWith("Flagged cleanup");

    const persisted = JSON.parse(localStorage.getItem(SAVED_VIEWS_STORAGE_KEY) ?? "[]");
    expect(persisted[0]).toMatchObject({
      name: "Flagged cleanup",
      state,
    });
  });

  it("ignores blank saved-view names", () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState: vi.fn(),
      onSaved,
      onApplied: vi.fn(),
    }));

    act(() => {
      result.current.saveView("   ");
    });

    expect(result.current.savedViews).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("applies a saved view state and reports the applied name", () => {
    const applyState = vi.fn();
    const onApplied = vi.fn();
    const view = makeSavedView("view-1", "Needs review");

    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState,
      onSaved: vi.fn(),
      onApplied,
    }));

    act(() => {
      result.current.applyView(view);
    });

    expect(applyState).toHaveBeenCalledWith(view.state);
    expect(onApplied).toHaveBeenCalledWith("Needs review");
  });

  it("deletes a saved view and persists the remaining views", () => {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify([
      makeSavedView("view-1"),
      makeSavedView("view-2"),
    ]));

    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }));

    act(() => {
      result.current.deleteView("view-1");
    });

    expect(result.current.savedViews.map((view) => view.id)).toEqual(["view-2"]);
    const persisted = JSON.parse(localStorage.getItem(SAVED_VIEWS_STORAGE_KEY) ?? "[]");
    expect(persisted.map((view: SavedDashboardView) => view.id)).toEqual(["view-2"]);
  });

  it("keeps only the 12 most recent saved views", () => {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(
      Array.from({ length: 12 }, (_, index) => makeSavedView(`view-${index}`)),
    ));

    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }));

    act(() => {
      result.current.saveView("Newest");
    });

    expect(result.current.savedViews).toHaveLength(12);
    expect(result.current.savedViews[0].name).toBe("Newest");
    expect(result.current.savedViews.some((view) => view.id === "view-11")).toBe(false);
  });
});
