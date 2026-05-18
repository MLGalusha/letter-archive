import { useMemo, useState, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../../contexts/ToastContext";
import { useDashboardFilteredSelection } from "../useDashboardFilteredSelection";
import type { DashboardFilterControls } from "../useDashboardFilters";

const getFilteredLetterIdsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../api/auth", () => ({
  isAuthenticated: () => true,
}));

vi.mock("../../../../api/letters", async () => {
  const actual = await vi.importActual<typeof import("../../../../api/letters")>("../../../../api/letters");
  return {
    ...actual,
    getFilteredLetterIds: getFilteredLetterIdsMock,
  };
});

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

function makeFilters(): DashboardFilterControls {
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
  } as unknown as DashboardFilterControls;
}

function useFilteredSelectionHarness({
  initialSelectedIds = [],
  closeEditToolbar = vi.fn(),
  fetchLetters = vi.fn().mockResolvedValue(undefined),
}: {
  initialSelectedIds?: string[];
  closeEditToolbar?: () => void;
  fetchLetters?: (showLoading?: boolean, page?: number) => Promise<void>;
} = {}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const filters = useMemo(() => makeFilters(), []);
  const sortColumns = useMemo(() => [], []);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setAllFilteredSelected(false);
  };

  const selectAllFiltered = (ids: string[]) => {
    setSelectedIds(new Set(ids));
    setAllFilteredSelected(true);
  };

  const filteredSelection = useDashboardFilteredSelection({
    filters,
    sortColumns,
    selectedIds,
    setSelectedIds,
    setAllFilteredSelected,
    clearSelection,
    closeEditToolbar,
    fetchLetters,
    selectAllFiltered,
  });

  return {
    selectedIds,
    allFilteredSelected,
    ...filteredSelection,
  };
}

describe("useDashboardFilteredSelection", () => {
  beforeEach(() => {
    getFilteredLetterIdsMock.mockReset();
  });

  it("selects every filtered id returned by the backend", async () => {
    getFilteredLetterIdsMock.mockResolvedValue(["letter-1", "letter-2", "letter-3"]);
    const { result } = renderHook(() => useFilteredSelectionHarness(), { wrapper });

    await act(async () => {
      await result.current.handleSelectAllFiltered();
    });

    expect(Array.from(result.current.selectedIds)).toEqual([
      "letter-1",
      "letter-2",
      "letter-3",
    ]);
    expect(result.current.allFilteredSelected).toBe(true);
  });

  it("prunes selected ids that no longer match the filtered query", async () => {
    getFilteredLetterIdsMock.mockResolvedValue(["letter-1"]);
    const closeEditToolbar = vi.fn();
    const fetchLetters = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(
      () => useFilteredSelectionHarness({
        initialSelectedIds: ["letter-1", "letter-2"],
        closeEditToolbar,
        fetchLetters,
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(Array.from(result.current.selectedIds)).toEqual(["letter-1"]);
    });

    expect(fetchLetters).toHaveBeenCalledWith(true, 1);
    expect(closeEditToolbar).not.toHaveBeenCalled();
    expect(result.current.allFilteredSelected).toBe(false);
  });

  it("clears edit mode when pruning removes every selected id", async () => {
    getFilteredLetterIdsMock.mockResolvedValue([]);
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
});
