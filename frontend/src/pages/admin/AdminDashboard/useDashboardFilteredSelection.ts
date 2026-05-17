import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { isAuthenticated } from "../../../api/auth";
import { getErrorMessage } from "../../../api/client";
import { getFilteredLetterIds } from "../../../api/letters";
import { useToast } from "../../../contexts/ToastContext";
import type { ContentStatus } from "../../../types/Letter";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { SortColumn, VisibilityFilter } from "./types";
import { buildDashboardLetterQuery } from "./utils";

interface UseDashboardFilteredSelectionOptions {
  collectionFilter: string;
  visibilityFilter: VisibilityFilter;
  searchQuery: string;
  sortColumns: SortColumn[];
  yearFilter: number | null;
  monthFilter: number | null;
  dayFilter: number | null;
  dateFromFilter: string | null;
  dateToFilter: string | null;
  transcriptStatusFilters: ContentStatus[];
  metadataStatusFilters: ContentStatus[];
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setAllFilteredSelected: (value: boolean) => void;
  clearSelection: () => void;
  closeEditToolbar: () => void;
  fetchLetters: (showLoading?: boolean, page?: number) => Promise<void>;
  selectAllFiltered: (ids: string[]) => void;
}

export function useDashboardFilteredSelection({
  collectionFilter,
  visibilityFilter,
  searchQuery,
  sortColumns,
  yearFilter,
  monthFilter,
  dayFilter,
  dateFromFilter,
  dateToFilter,
  transcriptStatusFilters,
  metadataStatusFilters,
  selectedIds,
  setSelectedIds,
  setAllFilteredSelected,
  clearSelection,
  closeEditToolbar,
  fetchLetters,
  selectAllFiltered,
}: UseDashboardFilteredSelectionOptions) {
  const { showToast } = useToast();

  const query = {
    collectionFilter,
    visibilityFilter,
    searchQuery,
    sortColumns,
    defaultSort: DEFAULT_DASHBOARD_SORT,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
  };

  useEffect(() => {
    if (!isAuthenticated()) return;
    fetchLetters(true, 1);

    if (selectedIds.size > 0) {
      getFilteredLetterIds(buildDashboardLetterQuery(query)).then(validIds => {
        const validSet = new Set(validIds);
        setSelectedIds(prev => {
          const pruned = new Set([...prev].filter(id => validSet.has(id)));
          if (pruned.size === prev.size) return prev;
          if (pruned.size === 0) closeEditToolbar();
          return pruned;
        });
        setAllFilteredSelected(false);
      }).catch(() => {
        clearSelection();
        closeEditToolbar();
      });
    }
  // The dashboard intentionally refetches only when filter/sort inputs change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    collectionFilter,
    visibilityFilter,
    searchQuery,
    sortColumns,
    yearFilter,
    monthFilter,
    dayFilter,
    dateFromFilter,
    dateToFilter,
    transcriptStatusFilters,
    metadataStatusFilters,
  ]);

  const handleSelectAllFiltered = async () => {
    try {
      const allIds = await getFilteredLetterIds(buildDashboardLetterQuery(query));
      selectAllFiltered(allIds);
    } catch (err) {
      console.error("Failed to select all filtered:", err);
      showToast(getErrorMessage(err, "Failed to select all filtered letters"), "error");
    }
  };

  return {
    handleSelectAllFiltered,
  };
}
