import {
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { BulkSource } from "../../../api/admin";
import { isAuthenticated } from "../../../api/auth";
import { getErrorMessage } from "../../../api/client";
import { getFilteredLetterSources } from "../../../api/letters";
import { useToast } from "../../../contexts/ToastContext";
import {
  buildDashboardLetterQuery,
  type DashboardCommittedQuery,
} from "./dashboardQueryModel";
import type { DashboardSelectionIntent } from "./useDashboardSelection";

interface UseDashboardFilteredSelectionOptions {
  query: DashboardCommittedQuery;
  selectedIds: Set<string>;
  selectionIntent: DashboardSelectionIntent;
  reconcileSelection: (sources: readonly BulkSource[]) => void;
  clearSelectionIfCurrent: (
    expectedIntent: DashboardSelectionIntent,
  ) => void;
  closeEditToolbar: () => void;
  selectAllFiltered: (
    sources: readonly BulkSource[],
    expectedIntent: DashboardSelectionIntent,
  ) => void;
}

export function useDashboardFilteredSelection({
  query,
  selectedIds,
  selectionIntent,
  reconcileSelection,
  clearSelectionIfCurrent,
  closeEditToolbar,
  selectAllFiltered,
}: UseDashboardFilteredSelectionOptions) {
  const { showToast } = useToast();
  const currentQueryRef = useRef<DashboardCommittedQuery | null>(query);
  const currentPruneRef = useRef<object | null>(null);
  const currentSelectAllRef = useRef<object | null>(null);
  const actionsRef = useRef({
    selectedIds,
    selectionIntent,
    reconcileSelection,
    clearSelectionIfCurrent,
    closeEditToolbar,
    selectAllFiltered,
  });

  useLayoutEffect(() => {
    actionsRef.current = {
      selectedIds,
      selectionIntent,
      reconcileSelection,
      clearSelectionIfCurrent,
      closeEditToolbar,
      selectAllFiltered,
    };
  }, [
    clearSelectionIfCurrent,
    closeEditToolbar,
    reconcileSelection,
    selectAllFiltered,
    selectedIds,
    selectionIntent,
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
    const requestIntent = actionsRef.current.selectionIntent;
    currentPruneRef.current = request;

    if (actionsRef.current.selectedIds.size === 0) {
      return;
    }

    void getFilteredLetterSources(buildDashboardLetterQuery(query))
      .then((validSources) => {
        if (
          currentQueryRef.current !== query
          || currentPruneRef.current !== request
        ) {
          return;
        }

        const validIds = new Set(
          validSources.map(({ letterId }) => letterId),
        );
        const selectionWillBeEmpty = (
          actionsRef.current.selectedIds.size > 0
          && [...actionsRef.current.selectedIds].every(
            (letterId) => !validIds.has(letterId),
          )
        );
        actionsRef.current.reconcileSelection(validSources);
        if (selectionWillBeEmpty) {
          actionsRef.current.closeEditToolbar();
        }
      })
      .catch(() => {
        if (
          currentQueryRef.current !== query
          || currentPruneRef.current !== request
          || actionsRef.current.selectionIntent !== requestIntent
        ) {
          return;
        }
        actionsRef.current.clearSelectionIfCurrent(requestIntent);
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
    const requestIntent = actionsRef.current.selectionIntent;
    currentSelectAllRef.current = request;

    try {
      const allSources = await getFilteredLetterSources(
        buildDashboardLetterQuery(query),
      );
      if (
        currentQueryRef.current !== query
        || currentSelectAllRef.current !== request
        || actionsRef.current.selectionIntent !== requestIntent
      ) {
        return;
      }
      currentPruneRef.current = null;
      actionsRef.current.selectAllFiltered(allSources, requestIntent);
    } catch (err) {
      if (
        currentQueryRef.current !== query
        || currentSelectAllRef.current !== request
        || actionsRef.current.selectionIntent !== requestIntent
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
