import { useState, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkSource } from "../../../../api/admin";
import { ToastProvider } from "../../../../contexts/ToastContext";
import type { DashboardCommittedQuery } from "../dashboardQueryModel";
import { useDashboardFilteredSelection } from "../useDashboardFilteredSelection";
import {
  useDashboardSelection,
  type DashboardSelectionIntent,
} from "../useDashboardSelection";

const {
  getFilteredLetterSourcesMock,
  showToastMock,
} = vi.hoisted(() => ({
  getFilteredLetterSourcesMock: vi.fn(),
  showToastMock: vi.fn(),
}));

vi.mock("../../../../api/auth", () => ({
  isAuthenticated: () => true,
}));

vi.mock("../../../../contexts/ToastContext", async () => {
  const actual = await vi.importActual<typeof import("../../../../contexts/ToastContext")>(
    "../../../../contexts/ToastContext",
  );
  return {
    ...actual,
    useToast: () => ({ showToast: showToastMock }),
  };
});

vi.mock("../../../../api/letters", async () => {
  const actual = await vi.importActual<typeof import("../../../../api/letters")>("../../../../api/letters");
  return {
    ...actual,
    getFilteredLetterSources: getFilteredLetterSourcesMock,
  };
});

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

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

const DEFAULT_QUERY = makeQuery();

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function makeSources(...letterIds: string[]): BulkSource[] {
  return letterIds.map((letterId, index) => ({
    letterId,
    primarySourceRevision: index + 1,
  }));
}

function useFilteredSelectionHarness({
  query = DEFAULT_QUERY,
  initialSelectedIds = [],
  closeEditToolbar = vi.fn(),
}: {
  query?: DashboardCommittedQuery;
  initialSelectedIds?: string[];
  closeEditToolbar?: () => void;
} = {}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [selectionIntent, setSelectionIntent] = useState<DashboardSelectionIntent>(
    () => ({ id: Symbol("test-selection-intent") }),
  );

  const clearSelection = () => {
    setSelectedIds(new Set());
    setAllFilteredSelected(false);
    setSelectionIntent({ id: Symbol("test-selection-intent") });
  };

  const clearSelectionIfCurrent = (
    expectedIntent: DashboardSelectionIntent,
  ) => {
    if (selectionIntent === expectedIntent) clearSelection();
  };

  const reconcileSelection = (sources: readonly BulkSource[]) => {
    const validIds = new Set(sources.map(({ letterId }) => letterId));
    setSelectedIds((previous) => new Set(
      [...previous].filter((letterId) => validIds.has(letterId)),
    ));
    setAllFilteredSelected(false);
  };

  const selectAllFiltered = (
    sources: readonly BulkSource[],
    expectedIntent: DashboardSelectionIntent,
  ) => {
    if (selectionIntent !== expectedIntent) return;
    setSelectedIds(new Set(sources.map(({ letterId }) => letterId)));
    setAllFilteredSelected(true);
    setSelectionIntent({ id: Symbol("test-selection-intent") });
  };

  const filteredSelection = useDashboardFilteredSelection({
    query,
    selectedIds,
    selectionIntent,
    reconcileSelection,
    clearSelectionIfCurrent,
    closeEditToolbar,
    selectAllFiltered,
  });

  return {
    selectedIds,
    allFilteredSelected,
    ...filteredSelection,
  };
}

const composedRows = [
  { id: "letter-1", primarySourceRevision: 11 },
  { id: "letter-2", primarySourceRevision: 22 },
];

function useComposedFilteredSelectionHarness(
  query: DashboardCommittedQuery,
) {
  const selection = useDashboardSelection(composedRows, query);
  const filteredSelection = useDashboardFilteredSelection({
    query,
    selectedIds: selection.selectedIds,
    selectionIntent: selection.selectionIntent,
    reconcileSelection: selection.reconcileSelection,
    clearSelectionIfCurrent: selection.clearSelectionIfCurrent,
    closeEditToolbar: vi.fn(),
    selectAllFiltered: selection.selectAllFiltered,
  });

  return {
    ...selection,
    ...filteredSelection,
  };
}

describe("useDashboardFilteredSelection", () => {
  beforeEach(() => {
    getFilteredLetterSourcesMock.mockReset();
    showToastMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects every filtered id using the exact committed query", async () => {
    const query = makeQuery({
      collectionFilter: "003",
      visibilityFilter: "PUBLISHED",
      searchQuery: "alice",
      yearFilter: 1886,
      monthFilter: 3,
      dayFilter: 14,
      dateFromFilter: "18860301",
      dateToFilter: "18860331",
      transcriptStatusFilters: ["AI_DRAFT", "VERIFIED"],
      metadataStatusFilters: ["EDITED"],
      extraContentStatusFilters: ["EMPTY"],
      workflowFilters: ["METADATA_DRAFTED", "REVIEWED"],
      flaggedFilter: "UNFLAGGED",
      missingFilters: ["sender", "date"],
      contentShapeFilters: ["extras", "photos"],
      sortColumns: [
        { field: "sender", direction: "asc" },
        { field: "letterDate", direction: "desc" },
      ],
    });
    getFilteredLetterSourcesMock.mockResolvedValue(
      makeSources("letter-1", "letter-2", "letter-3"),
    );
    const { result } = renderHook(
      () => useFilteredSelectionHarness({ query }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleSelectAllFiltered();
    });

    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    expect(getFilteredLetterSourcesMock).toHaveBeenCalledWith({
      page: undefined,
      limit: undefined,
      collection: "003",
      visibility: "PUBLISHED",
      search: "alice",
      workflow: "METADATA_DRAFTED,REVIEWED",
      sort: "sender",
      sortOrder: "asc",
      sortRules: "sender:asc,letterDate:desc",
      year: 1886,
      month: 3,
      day: 14,
      dateFrom: "18860301",
      dateTo: "18860331",
      transcriptStatus: "AI_DRAFT,VERIFIED",
      metadataStatus: "EDITED",
      extraContentStatus: "EMPTY",
      flagged: "false",
      missing: "sender,date",
      contentShape: "extras,photos",
    });
    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
    ]);
    expect(result.current.allFilteredSelected).toBe(true);
  });

  it("prunes selected ids using the exact current committed query", async () => {
    const query = makeQuery({
      collectionFilter: "012",
      visibilityFilter: "HIDDEN",
      searchQuery: "molly",
      metadataStatusFilters: ["AI_DRAFT", "EDITED"],
      flaggedFilter: "FLAGGED",
      sortColumns: [{ field: "createdAt", direction: "asc" }],
    });
    getFilteredLetterSourcesMock.mockResolvedValue(makeSources("letter-1"));
    const closeEditToolbar = vi.fn();

    const { result } = renderHook(
      () => useFilteredSelectionHarness({
        query,
        initialSelectedIds: ["letter-1", "letter-2"],
        closeEditToolbar,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(Array.from(result.current.selectedIds)).toEqual(["letter-1"]);
    });

    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    expect(getFilteredLetterSourcesMock).toHaveBeenCalledWith({
      page: undefined,
      limit: undefined,
      collection: "012",
      visibility: "HIDDEN",
      search: "molly",
      workflow: undefined,
      sort: "createdAt",
      sortOrder: "asc",
      sortRules: "createdAt:asc",
      year: undefined,
      month: undefined,
      day: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      transcriptStatus: undefined,
      metadataStatus: "AI_DRAFT,EDITED",
      extraContentStatus: undefined,
      flagged: "true",
      missing: undefined,
      contentShape: undefined,
    });
    expect(closeEditToolbar).not.toHaveBeenCalled();
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("clears edit mode when pruning removes every selected id", async () => {
    getFilteredLetterSourcesMock.mockResolvedValue([]);
    const closeEditToolbar = vi.fn();

    const { result } = renderHook(
      () => useFilteredSelectionHarness({
        initialSelectedIds: ["letter-1"],
        closeEditToolbar,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedIds.size).toBe(0);
    });

    expect(closeEditToolbar).toHaveBeenCalled();
  });

  it("keeps stale prune success inert after the committed query changes", async () => {
    const staleQuery = makeQuery({ searchQuery: "alice" });
    const currentQuery = makeQuery({ searchQuery: "clara" });
    const staleRequest = createDeferred<BulkSource[]>();
    const currentRequest = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const closeEditToolbar = vi.fn();

    const { result, rerender } = renderHook(
      ({ query }: { query: DashboardCommittedQuery }) => useFilteredSelectionHarness({
        query,
        initialSelectedIds: ["letter-1", "letter-2"],
        closeEditToolbar,
      }),
      {
        wrapper,
        initialProps: { query: staleQuery },
      },
    );

    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    rerender({ query: currentQuery });
    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      currentRequest.resolve(makeSources("letter-2"));
      await currentRequest.promise;
    });
    expect(Array.from(result.current.selectedIds)).toEqual(["letter-2"]);

    await act(async () => {
      staleRequest.resolve(makeSources("letter-1"));
      await staleRequest.promise;
    });

    expect(Array.from(result.current.selectedIds)).toEqual(["letter-2"]);
    expect(result.current.allFilteredSelected).toBe(false);
    expect(closeEditToolbar).not.toHaveBeenCalled();
  });

  it("keeps stale prune failure inert after the committed query changes", async () => {
    const staleQuery = makeQuery({ searchQuery: "alice" });
    const currentQuery = makeQuery({ searchQuery: "clara" });
    const staleRequest = createDeferred<BulkSource[]>();
    const currentRequest = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const closeEditToolbar = vi.fn();

    const { result, rerender } = renderHook(
      ({ query }: { query: DashboardCommittedQuery }) => useFilteredSelectionHarness({
        query,
        initialSelectedIds: ["letter-1", "letter-2"],
        closeEditToolbar,
      }),
      {
        wrapper,
        initialProps: { query: staleQuery },
      },
    );

    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    rerender({ query: currentQuery });
    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      currentRequest.resolve(makeSources("letter-1", "letter-2"));
      await currentRequest.promise;
    });

    await act(async () => {
      staleRequest.reject(new Error("stale prune failed"));
      await Promise.resolve();
    });

    expect(Array.from(result.current.selectedIds)).toEqual(["letter-1", "letter-2"]);
    expect(result.current.allFilteredSelected).toBe(false);
    expect(closeEditToolbar).not.toHaveBeenCalled();
  });

  it("still clears selection when the current prune request fails", async () => {
    getFilteredLetterSourcesMock.mockRejectedValue(
      new Error("current prune failed"),
    );
    const closeEditToolbar = vi.fn();

    const { result } = renderHook(
      () => useFilteredSelectionHarness({
        initialSelectedIds: ["letter-1"],
        closeEditToolbar,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.selectedIds.size).toBe(0);
    });

    expect(result.current.allFilteredSelected).toBe(false);
    expect(closeEditToolbar).toHaveBeenCalledTimes(1);
  });

  it("keeps current pruning active when select-all fails", async () => {
    const initialQuery = makeQuery({ searchQuery: "alice" });
    const currentQuery = makeQuery({ searchQuery: "clara" });
    const currentPrune = createDeferred<BulkSource[]>();
    const failedSelectAll = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock
      .mockResolvedValueOnce(makeSources("letter-1", "letter-2"))
      .mockReturnValueOnce(currentPrune.promise)
      .mockReturnValueOnce(failedSelectAll.promise);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result, rerender } = renderHook(
      ({ query }: { query: DashboardCommittedQuery }) => useFilteredSelectionHarness({
        query,
        initialSelectedIds: ["letter-1", "letter-2"],
      }),
      {
        wrapper,
        initialProps: { query: initialQuery },
      },
    );
    await waitFor(() => {
      expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    });

    rerender({ query: currentQuery });
    await waitFor(() => {
      expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(2);
    });

    let selectAllAction!: Promise<void>;
    act(() => {
      selectAllAction = result.current.handleSelectAllFiltered();
    });
    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      failedSelectAll.reject(new Error("select all failed"));
      await selectAllAction;
    });
    await act(async () => {
      currentPrune.resolve(makeSources("letter-2"));
      await currentPrune.promise;
    });

    expect(Array.from(result.current.selectedIds)).toEqual(["letter-2"]);
    expect(result.current.allFilteredSelected).toBe(false);
    expect(showToastMock).toHaveBeenCalledWith("select all failed", "error");
  });

  it("supersedes a pending prune only after select-all succeeds", async () => {
    const pendingPrune = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock
      .mockReturnValueOnce(pendingPrune.promise)
      .mockResolvedValueOnce(
        makeSources("letter-1", "letter-2", "letter-3"),
      );
    const closeEditToolbar = vi.fn();

    const { result } = renderHook(
      () => useFilteredSelectionHarness({
        initialSelectedIds: ["letter-1"],
        closeEditToolbar,
      }),
      { wrapper },
    );
    await waitFor(() => {
      expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await result.current.handleSelectAllFiltered();
    });
    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
    ]);
    expect(result.current.allFilteredSelected).toBe(true);

    await act(async () => {
      pendingPrune.reject(new Error("superseded prune failed"));
      await Promise.resolve();
    });

    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
    ]);
    expect(result.current.allFilteredSelected).toBe(true);
    expect(closeEditToolbar).not.toHaveBeenCalled();
  });

  it("keeps stale select-all success inert and accepts the current completion", async () => {
    const staleQuery = makeQuery({ searchQuery: "alice" });
    const currentQuery = makeQuery({ searchQuery: "clara" });
    const staleRequest = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock.mockReturnValueOnce(staleRequest.promise);

    const { result, rerender } = renderHook(
      ({ query }: { query: DashboardCommittedQuery }) => useFilteredSelectionHarness({ query }),
      {
        wrapper,
        initialProps: { query: staleQuery },
      },
    );

    let staleAction: Promise<void> | undefined;
    act(() => {
      staleAction = result.current.handleSelectAllFiltered();
    });
    expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);

    rerender({ query: currentQuery });
    await act(async () => {
      staleRequest.resolve(makeSources("stale-letter"));
      await staleAction;
    });

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.allFilteredSelected).toBe(false);

    getFilteredLetterSourcesMock.mockResolvedValueOnce(
      makeSources("current-letter"),
    );
    await act(async () => {
      await result.current.handleSelectAllFiltered();
    });

    expect(Array.from(result.current.selectedIds)).toEqual(["current-letter"]);
    expect(result.current.allFilteredSelected).toBe(true);
  });

  it("keeps stale select-all failure inert and reports the current failure", async () => {
    const staleQuery = makeQuery({ searchQuery: "alice" });
    const currentQuery = makeQuery({ searchQuery: "clara" });
    const staleRequest = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock.mockReturnValueOnce(staleRequest.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result, rerender } = renderHook(
      ({ query }: { query: DashboardCommittedQuery }) => useFilteredSelectionHarness({ query }),
      {
        wrapper,
        initialProps: { query: staleQuery },
      },
    );

    let staleAction: Promise<void> | undefined;
    act(() => {
      staleAction = result.current.handleSelectAllFiltered();
    });
    rerender({ query: currentQuery });

    await act(async () => {
      staleRequest.reject(new Error("stale select-all failed"));
      await staleAction;
    });

    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.allFilteredSelected).toBe(false);
    expect(showToastMock).not.toHaveBeenCalled();

    getFilteredLetterSourcesMock.mockRejectedValueOnce(
      new Error("current select-all failed"),
    );
    await act(async () => {
      await result.current.handleSelectAllFiltered();
    });

    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith("current select-all failed", "error");
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("keeps a select-all failure inert after the selection owner unmounts", async () => {
    const request = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock.mockReturnValueOnce(request.promise);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(
      () => useFilteredSelectionHarness(),
      { wrapper },
    );

    let selectAllAction!: Promise<void>;
    act(() => {
      selectAllAction = result.current.handleSelectAllFiltered();
    });
    unmount();
    await act(async () => {
      request.reject(new Error("failed after navigation"));
      await selectAllAction;
    });

    expect(showToastMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("useDashboardFilteredSelection with the real selection owner", () => {
  beforeEach(() => {
    getFilteredLetterSourcesMock.mockReset();
    showToastMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a slow select-all response from overwriting newer manual intent", async () => {
    const selectAllRequest = createDeferred<BulkSource[]>();
    getFilteredLetterSourcesMock.mockReturnValueOnce(selectAllRequest.promise);
    const { result } = renderHook(
      () => useComposedFilteredSelectionHarness(DEFAULT_QUERY),
      { wrapper },
    );

    let selectAllAction!: Promise<void>;
    act(() => {
      selectAllAction = result.current.handleSelectAllFiltered();
    });
    act(() => {
      result.current.toggleSelection("letter-1");
    });

    await act(async () => {
      selectAllRequest.resolve(makeSources("letter-1", "letter-2"));
      await selectAllAction;
    });

    expect(Array.from(result.current.selectedIds)).toEqual(["letter-1"]);
    expect(result.current.selectedSources).toEqual([
      { letterId: "letter-1", primarySourceRevision: 11 },
    ]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("makes a successful select-all supersede an older real-owner prune", async () => {
    const firstQuery = makeQuery({ searchQuery: "first" });
    const secondQuery = makeQuery({ searchQuery: "second" });
    const pruneRequest = createDeferred<BulkSource[]>();
    const selectAllRequest = createDeferred<BulkSource[]>();
    const { result, rerender } = renderHook(
      ({ query }) => useComposedFilteredSelectionHarness(query),
      {
        wrapper,
        initialProps: { query: firstQuery },
      },
    );

    act(() => {
      result.current.toggleSelection("letter-1");
    });
    getFilteredLetterSourcesMock
      .mockReturnValueOnce(pruneRequest.promise)
      .mockReturnValueOnce(selectAllRequest.promise);
    rerender({ query: secondQuery });
    await waitFor(() => {
      expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    });

    let selectAllAction!: Promise<void>;
    act(() => {
      selectAllAction = result.current.handleSelectAllFiltered();
    });
    await act(async () => {
      selectAllRequest.resolve([
        { letterId: "letter-1", primarySourceRevision: 101 },
        { letterId: "letter-2", primarySourceRevision: 202 },
      ]);
      await selectAllAction;
    });
    await act(async () => {
      pruneRequest.resolve([
        { letterId: "letter-1", primarySourceRevision: 303 },
      ]);
      await pruneRequest.promise;
    });

    expect(result.current.selectedSources).toEqual([
      { letterId: "letter-1", primarySourceRevision: 101 },
      { letterId: "letter-2", primarySourceRevision: 202 },
    ]);
    expect(result.current.allFilteredSelected).toBe(true);
  });

  it("lets a real-owner prune retain the current observed revision after select-all fails", async () => {
    const firstQuery = makeQuery({ searchQuery: "first" });
    const secondQuery = makeQuery({ searchQuery: "second" });
    const pruneRequest = createDeferred<BulkSource[]>();
    const selectAllRequest = createDeferred<BulkSource[]>();
    const { result, rerender } = renderHook(
      ({ query }) => useComposedFilteredSelectionHarness(query),
      {
        wrapper,
        initialProps: { query: firstQuery },
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    act(() => {
      result.current.toggleSelection("letter-1");
    });
    getFilteredLetterSourcesMock
      .mockReturnValueOnce(pruneRequest.promise)
      .mockReturnValueOnce(selectAllRequest.promise);
    rerender({ query: secondQuery });
    await waitFor(() => {
      expect(getFilteredLetterSourcesMock).toHaveBeenCalledTimes(1);
    });

    let selectAllAction!: Promise<void>;
    act(() => {
      selectAllAction = result.current.handleSelectAllFiltered();
    });
    await act(async () => {
      selectAllRequest.reject(new Error("select all failed"));
      await selectAllAction;
    });
    await act(async () => {
      pruneRequest.resolve([
        { letterId: "letter-1", primarySourceRevision: 303 },
      ]);
      await pruneRequest.promise;
    });

    expect(result.current.selectedSources).toEqual([
      { letterId: "letter-1", primarySourceRevision: 303 },
    ]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("keeps a stale prune failure from clearing newer manual intent", async () => {
    const firstQuery = makeQuery({ searchQuery: "first" });
    const secondQuery = makeQuery({ searchQuery: "second" });
    const pruneRequest = createDeferred<BulkSource[]>();
    const { result, rerender } = renderHook(
      ({ query }) => useComposedFilteredSelectionHarness(query),
      {
        wrapper,
        initialProps: { query: firstQuery },
      },
    );

    act(() => {
      result.current.toggleSelection("letter-1");
    });
    getFilteredLetterSourcesMock.mockReturnValueOnce(pruneRequest.promise);
    rerender({ query: secondQuery });
    await waitFor(() => {
      expect(getFilteredLetterSourcesMock).toHaveBeenCalledOnce();
    });
    act(() => {
      result.current.toggleSelection("letter-2");
    });

    await act(async () => {
      pruneRequest.reject(new Error("stale prune failed"));
      await Promise.resolve();
    });

    expect(result.current.selectedSources).toEqual([
      { letterId: "letter-1", primarySourceRevision: 11 },
      { letterId: "letter-2", primarySourceRevision: 22 },
    ]);
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("reconciles newer manual intent when the current-query prune succeeds", async () => {
    const firstQuery = makeQuery({ searchQuery: "first" });
    const secondQuery = makeQuery({ searchQuery: "second" });
    const pruneRequest = createDeferred<BulkSource[]>();
    const { result, rerender } = renderHook(
      ({ query }) => useComposedFilteredSelectionHarness(query),
      {
        wrapper,
        initialProps: { query: firstQuery },
      },
    );

    act(() => {
      result.current.toggleSelection("letter-1");
    });
    getFilteredLetterSourcesMock.mockReturnValueOnce(pruneRequest.promise);
    rerender({ query: secondQuery });
    await waitFor(() => {
      expect(getFilteredLetterSourcesMock).toHaveBeenCalledOnce();
    });

    act(() => {
      result.current.toggleSelection("letter-2");
    });
    await act(async () => {
      pruneRequest.resolve([
        { letterId: "letter-2", primarySourceRevision: 202 },
      ]);
      await pruneRequest.promise;
    });

    expect(result.current.selectedSources).toEqual([
      { letterId: "letter-2", primarySourceRevision: 202 },
    ]);
    expect(result.current.allFilteredSelected).toBe(false);
  });
});
