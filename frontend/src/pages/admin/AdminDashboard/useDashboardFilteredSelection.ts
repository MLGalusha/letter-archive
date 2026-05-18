import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { isAuthenticated } from "../../../api/auth";
import { getErrorMessage } from "../../../api/client";
import { getFilteredLetterIds } from "../../../api/letters";
import { useToast } from "../../../contexts/ToastContext";
import { DEFAULT_DASHBOARD_SORT } from "./constants";
import type { SortColumn } from "./types";
import {
  getDashboardFilterQueryFields,
  type DashboardFilterControls,
} from "./useDashboardFilters";
import { buildDashboardLetterQuery } from "./utils";

interface UseDashboardFilteredSelectionOptions {
  filters: DashboardFilterControls;
  sortColumns: SortColumn[];
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setAllFilteredSelected: (value: boolean) => void;
  clearSelection: () => void;
  closeEditToolbar: () => void;
  fetchLetters: (showLoading?: boolean, page?: number) => Promise<void>;
  selectAllFiltered: (ids: string[]) => void;
}

export function useDashboardFilteredSelection({
  filters,
  sortColumns,
  selectedIds,
  setSelectedIds,
  setAllFilteredSelected,
  clearSelection,
  closeEditToolbar,
  fetchLetters,
  selectAllFiltered,
}: UseDashboardFilteredSelectionOptions) {
  const { showToast } = useToast();
  const filterQueryFields = getDashboardFilterQueryFields(filters);

  const query = {
    ...filterQueryFields,
    sortColumns,
    defaultSort: DEFAULT_DASHBOARD_SORT,
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
    filterQueryFields.collectionFilter,
    filterQueryFields.visibilityFilter,
    filterQueryFields.searchQuery,
    sortColumns,
    filterQueryFields.yearFilter,
    filterQueryFields.monthFilter,
    filterQueryFields.dayFilter,
    filterQueryFields.dateFromFilter,
    filterQueryFields.dateToFilter,
    filterQueryFields.transcriptStatusFilters,
    filterQueryFields.metadataStatusFilters,
    filterQueryFields.extraContentStatusFilters,
    filterQueryFields.workflowFilters,
    filterQueryFields.flaggedFilter,
    filterQueryFields.missingFilters,
    filterQueryFields.contentShapeFilters,
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
