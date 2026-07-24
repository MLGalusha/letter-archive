import {
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { Dispatch, SetStateAction } from "react";
import { isAuthenticated } from "../../../api/auth";
import { getErrorMessage } from "../../../api/client";
import { getFilteredLetterIds } from "../../../api/letters";
import { useToast } from "../../../contexts/ToastContext";
import {
  buildDashboardLetterQuery,
  type DashboardCommittedQuery,
} from "./dashboardQueryModel";

interface UseDashboardFilteredSelectionOptions {
  query: DashboardCommittedQuery;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setAllFilteredSelected: (value: boolean) => void;
  clearSelection: () => void;
  closeEditToolbar: () => void;
  selectAllFiltered: (ids: string[]) => void;
}

export function useDashboardFilteredSelection({
  query,
  selectedIds,
  setSelectedIds,
  setAllFilteredSelected,
  clearSelection,
  closeEditToolbar,
  selectAllFiltered,
}: UseDashboardFilteredSelectionOptions) {
  const { showToast } = useToast();
  const currentQueryRef = useRef<DashboardCommittedQuery | null>(query);
  const currentPruneRef = useRef<object | null>(null);
  const currentSelectAllRef = useRef<object | null>(null);
  const actionsRef = useRef({
    selectedIds,
    setSelectedIds,
    setAllFilteredSelected,
    clearSelection,
    closeEditToolbar,
    selectAllFiltered,
  });

  useLayoutEffect(() => {
    actionsRef.current = {
      selectedIds,
      setSelectedIds,
      setAllFilteredSelected,
      clearSelection,
      closeEditToolbar,
      selectAllFiltered,
    };
  }, [
    clearSelection,
    closeEditToolbar,
    selectAllFiltered,
    selectedIds,
    setAllFilteredSelected,
    setSelectedIds,
  ]);

  useLayoutEffect(() => {
    currentQueryRef.current = query;
    currentPruneRef.current = null;
    currentSelectAllRef.current = null;

    return () => {
      currentQueryRef.current = null;
      currentPruneRef.current = null;
      currentSelectAllRef.current = null;
    };
  }, [query]);

  useEffect(() => {
    if (!isAuthenticated()) return;
    const request = {};
    currentPruneRef.current = request;
    actionsRef.current.setAllFilteredSelected(false);

    if (actionsRef.current.selectedIds.size === 0) {
      return;
    }

    void getFilteredLetterIds(buildDashboardLetterQuery(query))
      .then((validIds) => {
        if (
          currentQueryRef.current !== query
          || currentPruneRef.current !== request
        ) {
          return;
        }

        const validSet = new Set(validIds);
        actionsRef.current.setSelectedIds((previous) => {
          const pruned = new Set(
            [...previous].filter((id) => validSet.has(id)),
          );
          if (pruned.size === previous.size) return previous;
          if (pruned.size === 0) {
            actionsRef.current.closeEditToolbar();
          }
          return pruned;
        });
      })
      .catch(() => {
        if (
          currentQueryRef.current !== query
          || currentPruneRef.current !== request
        ) {
          return;
        }
        actionsRef.current.clearSelection();
        actionsRef.current.closeEditToolbar();
      });

    return () => {
      if (currentPruneRef.current === request) {
        currentPruneRef.current = null;
      }
    };
  }, [query]);

  const handleSelectAllFiltered = async () => {
    if (currentQueryRef.current !== query) return;

    const request = {};
    currentSelectAllRef.current = request;

    try {
      const allIds = await getFilteredLetterIds(buildDashboardLetterQuery(query));
      if (
        currentQueryRef.current !== query
        || currentSelectAllRef.current !== request
      ) {
        return;
      }
      currentPruneRef.current = null;
      actionsRef.current.selectAllFiltered(allIds);
    } catch (err) {
      if (
        currentQueryRef.current !== query
        || currentSelectAllRef.current !== request
      ) {
        return;
      }
      console.error("Failed to select all filtered:", err);
      showToast(getErrorMessage(err, "Failed to select all filtered letters"), "error");
    }
  };

  return {
    handleSelectAllFiltered,
  };
}
