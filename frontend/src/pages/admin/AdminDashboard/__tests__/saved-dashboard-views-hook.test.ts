import { StrictMode, createElement, type ReactNode } from "react";
import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COLUMN_ORDER,
  DEFAULT_DASHBOARD_SORT,
  SAVED_VIEWS_STORAGE_KEY,
} from "../constants";
import { decodeDashboardViewState } from "../dashboardStoredStateModel";
import type { DashboardViewState, SavedDashboardView } from "../types";
import { useSavedDashboardViews } from "../useSavedDashboardViews";

function makeState(overrides: Partial<DashboardViewState> = {}): DashboardViewState {
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
    visibleColumns: ["sender", "recipient"],
    columnOrder: [...DEFAULT_COLUMN_ORDER],
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

function strictModeWrapper({ children }: { children: ReactNode }) {
  return createElement(StrictMode, null, children);
}

function readStoredViews(): SavedDashboardView[] {
  return JSON.parse(
    localStorage.getItem(SAVED_VIEWS_STORAGE_KEY) ?? "[]",
  ) as SavedDashboardView[];
}

function mockSequentialUuids() {
  let sequence = 0;
  return vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}` as ReturnType<
      typeof globalThis.crypto.randomUUID
    >;
  });
}

describe("useSavedDashboardViews", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("commits exactly the saved view that it persists under React StrictMode", () => {
    const uuidSpy = mockSequentialUuids();
    const state = makeState({ searchQuery: "strict owner" });
    const getCurrentState = vi.fn(() => state);
    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState,
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }), { wrapper: strictModeWrapper });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    act(() => {
      result.current.saveView("Strict owner");
    });

    expect(uuidSpy).toHaveBeenCalledOnce();
    expect(getCurrentState).toHaveBeenCalledOnce();
    expect(setItemSpy).toHaveBeenCalledOnce();
    expect(result.current.savedViews).toEqual(readStoredViews());
    expect(result.current.savedViews[0]?.id).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("persists one committed deletion under React StrictMode", () => {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify([
      makeSavedView("view-1"),
      makeSavedView("view-2"),
    ]));
    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }), { wrapper: strictModeWrapper });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    act(() => {
      result.current.deleteView("view-1");
    });

    expect(setItemSpy).toHaveBeenCalledOnce();
    expect(result.current.savedViews).toEqual(readStoredViews());
    expect(result.current.savedViews.map((view) => view.id)).toEqual(["view-2"]);
  });

  it("owns the captured saved-view arrays independently of their source", () => {
    mockSequentialUuids();
    const state = makeState({
      sortColumns: [{ field: "sender", direction: "asc" }],
      transcriptStatusFilters: ["AI_DRAFT"],
      visibleColumns: ["sender", "date"],
      columnOrder: ["date", "sender"],
    });
    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => state,
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }));

    act(() => {
      result.current.saveView("Owned snapshot");
    });
    const storedState = structuredClone(readStoredViews()[0]?.state);

    state.sortColumns[0]!.direction = "desc";
    state.transcriptStatusFilters.push("VERIFIED");
    state.visibleColumns.push("visibility");
    state.columnOrder.push("visibility");

    expect(result.current.savedViews[0]?.state).toEqual(storedState);
    expect(readStoredViews()[0]?.state).toEqual(storedState);
  });

  it("applies an owned snapshot instead of exposing saved-view arrays", () => {
    const applyState = vi.fn();
    const view = makeSavedView("view-1", "Owned apply");
    view.state.sortColumns = [{ field: "sender", direction: "asc" }];
    view.state.transcriptStatusFilters = ["AI_DRAFT"];
    view.state.visibleColumns = ["sender", "date"];
    view.state.columnOrder = ["date", "sender"];
    const expectedAppliedState = decodeDashboardViewState(view.state);
    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState,
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }));

    act(() => {
      result.current.applyView(view);
    });
    const appliedState = applyState.mock.calls[0]?.[0] as DashboardViewState;

    view.state.sortColumns[0]!.direction = "desc";
    view.state.transcriptStatusFilters.push("VERIFIED");
    view.state.visibleColumns.push("visibility");
    view.state.columnOrder.push("visibility");

    expect(appliedState).toEqual(expectedAppliedState);
    expect(appliedState.sortColumns).not.toBe(view.state.sortColumns);
    expect(appliedState.transcriptStatusFilters).not.toBe(
      view.state.transcriptStatusFilters,
    );
    expect(appliedState.visibleColumns).not.toBe(view.state.visibleColumns);
    expect(appliedState.columnOrder).not.toBe(view.state.columnOrder);
  });

  it("rebases a sequential second owner and adopts later cross-tab storage events", () => {
    const uuidSpy = mockSequentialUuids();
    const firstOwner = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState({ searchQuery: "alpha" }),
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }));
    const secondOwner = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState({ searchQuery: "beta" }),
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }));

    act(() => {
      firstOwner.result.current.saveView("Alpha");
    });
    const alphaStorage = localStorage.getItem(SAVED_VIEWS_STORAGE_KEY);

    // Simulate a second tab saving before its delayed storage event arrives. Its
    // transition must rebase on the durable Alpha view rather than overwrite it.
    act(() => {
      secondOwner.result.current.saveView("Beta");
    });
    const combinedViews = readStoredViews();

    // Deliver the now-stale Alpha event after Beta has already rebased and
    // persisted Beta + Alpha. Both owners must adopt durable current storage,
    // not regress to the event's older payload.
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", {
        key: SAVED_VIEWS_STORAGE_KEY,
        oldValue: null,
        newValue: alphaStorage,
        storageArea: localStorage,
        url: window.location.href,
      }));
    });

    expect(uuidSpy).toHaveBeenCalledTimes(2);
    expect(combinedViews.map((view) => view.name)).toEqual(["Beta", "Alpha"]);
    expect(secondOwner.result.current.savedViews).toEqual(combinedViews);
    expect(firstOwner.result.current.savedViews).toEqual(combinedViews);
  });

  it("rebases deletion on the latest durable views", () => {
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

    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify([
      makeSavedView("remote-view"),
      ...readStoredViews(),
    ]));

    act(() => {
      result.current.deleteView("view-1");
    });

    expect(result.current.savedViews.map((view) => view.id)).toEqual([
      "remote-view",
      "view-2",
    ]);
    expect(readStoredViews().map((view) => view.id)).toEqual([
      "remote-view",
      "view-2",
    ]);
  });

  it("does not commit or report a save that storage rejected", () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState: vi.fn(),
      onSaved,
      onApplied: vi.fn(),
    }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    act(() => {
      result.current.saveView("Cannot persist");
    });

    expect(result.current.savedViews).toEqual([]);
    expect(readStoredViews()).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not commit a deletion that storage rejected", () => {
    localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify([
      makeSavedView("view-1"),
    ]));
    const { result } = renderHook(() => useSavedDashboardViews({
      getCurrentState: () => makeState(),
      applyState: vi.fn(),
      onSaved: vi.fn(),
      onApplied: vi.fn(),
    }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    act(() => {
      result.current.deleteView("view-1");
    });

    expect(result.current.savedViews.map((view) => view.id)).toEqual(["view-1"]);
    expect(readStoredViews().map((view) => view.id)).toEqual(["view-1"]);
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
